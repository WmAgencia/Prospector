import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/prospector-kanban-');
const db=await import('../dashboard/db.mjs');
await import('../dashboard/prospecting-queue.mjs');
const {kanbanSnapshot}=await import('../dashboard/kanban.mjs');
const {threeMonthsAfter,recontactDecision}=await import('../dashboard/prospecting-recontact.mjs');
const {prospectingList}=await import('../dashboard/prospecting-search.mjs');
const {listUnseenCompanies}=await import('../dashboard/prospecting-visibility.mjs');
function lead(name,number){
 return db.addLead({business:name,phone:number,city:'Sorocaba',segment:'oficina mecânica',source:'MANUAL'}).lead;
}
function contacted(x,at='2025-04-01T12:00:00.000Z'){
 db.run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',x.id,x.phone,'SENT',db.id(),at);
}
test('Three calendar months clamp month-end; no arbitrary 90-day approximation',()=>{
 assert.equal(threeMonthsAfter('2026-01-31T10:00:00.000Z'),'2026-04-30T10:00:00.000Z');
 assert.equal(threeMonthsAfter('2026-08-30T10:00:00.000Z'),'2026-11-30T10:00:00.000Z');
 assert.equal(threeMonthsAfter('bad'),null);
});
test('Kanban has four stages, one card per company and manual replies imply Conversando',()=>{
 const a=lead('Oficina Abordando','15933330001');contacted(a);
 const n=lead('Oficina Sem Interesse','15933330002');contacted(n);db.stage(n.id,'NO_INTEREST','SOFT_DECLINE');
 const h=lead('Oficina Interessada','15933330003');contacted(h);db.stage(h.id,'INTERESTED','GROQ_CONFIRMED');db.run("INSERT INTO owner_notices(id,unique_key,kind,lead_id,message,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",db.id(),'qa-hot:'+h.id,'GROQ_HOT_LEAD',h.id,'Proposta','SENT',db.now(),db.now());
 const c=lead('Oficina Conversando','15933330004');contacted(c);
 const thread=db.getThread(c.id,c.phone+'@s.whatsapp.net');db.addMessage({threadId:thread.id,providerId:'remote-operator:'+db.id(),direction:'out',body:'Vamos conversar?'});db.stage(c.id,'CONVERSING','OPERATOR');
 const board=kanbanSnapshot();
 assert.equal(board.counts.approaching,1);
 assert.equal(board.counts.no_interest,1);
 assert.equal(board.counts.interested,1);
 assert.equal(board.counts.conversing,1);
 assert.equal(board.total,4);
 const ids=Object.values(board.columns).flat().map(x=>x.id);
 assert.equal(new Set(ids).size,4);
 assert.equal(board.columns.interested[0].business,'Oficina Interessada');
 assert.equal(board.columns.conversing[0].business,'Oficina Conversando');
});
test('Before the three-month boundary a non-replier remains excluded; then becomes recontact-eligible',()=>{
 const x=lead('Oficina sem resposta','15933330005');
 contacted(x,'2026-07-31T10:00:00.000Z');
 assert.equal(recontactDecision(x,Date.parse('2026-10-30T10:00:00Z')).eligible,false);
 assert.equal(recontactDecision(x,Date.parse('2026-10-31T10:00:00Z')).eligible,true);
});
test('Soft decline is eligible after three months but explicit opt-out never is',()=>{
 const a=lead('Não interessado leve','15933330006');
 contacted(a,'2024-01-01T00:00:00Z');
 db.stage(a.id,'NO_INTEREST','SOFT_DECLINE');
 // Move stage audit into the past to validate policy deterministically.
 db.run("UPDATE audit SET at='2025-01-01T00:00:00.000Z' WHERE lead_id=? AND action='STAGE'",a.id);
 const refreshed=db.one('SELECT * FROM leads WHERE id=?',a.id);
 assert.equal(recontactDecision(refreshed,Date.parse('2025-03-31T23:59:00Z')).eligible,false);
 assert.equal(recontactDecision(refreshed,Date.parse('2025-04-01T00:00:00Z')).eligible,true);
 db.run('INSERT INTO suppressions(phone,reason,created_at) VALUES(?,?,?)',a.phone,'OPTOUT',db.now());
 assert.equal(recontactDecision(refreshed,Date.parse('2030-01-01T00:00:00Z')).reason,'OPT_OUT');
});
test('Visibility follows actual contact cooldown, not prior page views',()=>{
 const a=lead('Oficina Vista','15933330007');
 const first='11111111-1111-4111-8111-111111111111';
 const second='22222222-2222-4222-8222-222222222222';
 assert.equal(listUnseenCompanies({session:first,niche:'oficina mecânica',city:'Sorocaba'}).results.filter(x=>x.id===a.id).length,1);
 assert.equal(listUnseenCompanies({session:second,niche:'oficina mecânica',city:'Sorocaba'}).results.filter(x=>x.id===a.id).length,1,'viewing alone does not consume a prospect');
 contacted(a,'2024-01-01T00:00:00Z');
 db.run("UPDATE prospecting_viewed_keys SET shown_at='2025-01-01T00:00:00Z' WHERE lead_id=?",a.id);
 const returned=listUnseenCompanies({session:second,niche:'oficina mecânica',city:'Sorocaba'});
 assert.equal(returned.results.filter(x=>x.id===a.id).length,1);
 const third='33333333-3333-4333-8333-333333333333';
 assert.equal(listUnseenCompanies({session:third,niche:'oficina mecânica',city:'Sorocaba'}).results.filter(x=>x.id===a.id).length,1,'viewing does not reset contact cooldown');
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
