import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auto-outreach-window-'));
process.env.PROSPECTOR_DATA_DIR=dir;
const d=await import('../dashboard/db.mjs');
const q=await import('../dashboard/prospecting-queue.mjs');
const {insideApproachWindow}=await import('../dashboard/outreach-window.mjs');
const {operatorSelected,conversationAuthorized}=await import('../dashboard/operator-outreach.mjs');
const at=new Date('2026-11-04T14:00:00Z'); // 11am Sao Paulo
d.setSetting('autonomous_outreach_enabled',true);
d.setSetting('paused',false);
function lead(name,phone){
 return d.addLead({business:name,phone,city:'Sorocaba',source:'MANUAL'}).lead;
}
function oldContact(l,when){
 d.run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',
 l.id,l.phone,'SENT',d.id(),when);
 d.run("UPDATE leads SET stage='NO_INTEREST' WHERE id=?",l.id);
}
test('São Paulo window is inclusive at 08:00 and exclusive at 17:30',()=>{
 assert.equal(insideApproachWindow(new Date('2026-11-04T10:59:59Z')),false);
 assert.equal(insideApproachWindow(new Date('2026-11-04T11:00:00Z')),true);
 assert.equal(insideApproachWindow(new Date('2026-11-04T20:29:59Z')),true);
 assert.equal(insideApproachWindow(new Date('2026-11-04T20:30:00Z')),false);
});
test('automatic queue excludes recent approaches, duplicates, opt-outs, and queues due recontacts',()=>{
 const first=lead('Oficina Alfa','5515999890001');
 const sister=lead('OFICINA ÁLFA','5515999890002');
 const another=lead('Festas Ponto','5515999890003');
 const due=lead('Auto Centro Retorno','5515999890004');oldContact(due,'2026-08-04T12:00:00.000Z');
 const recent=lead('Auto Centro Recente','5515999890005');oldContact(recent,'2026-10-04T12:00:00.000Z');
 const refused=lead('Não Contatar','5515999890006');
 d.run('INSERT INTO suppressions(phone,reason,created_at) VALUES(?,?,?)',refused.phone,'opt_out',d.now());
 const before=q.enrollAutonomousApproaches({at:new Date('2026-11-04T10:59:59Z')});
 assert.equal(before.status,'OUTSIDE_WINDOW');
 const result=q.enrollAutonomousApproaches({at});
 assert.equal(result.status,'QUEUED');
 assert.equal(result.queued,3);
 const ids=d.all("SELECT lead_id FROM prospecting_batch_items WHERE batch_id=?",result.batchId).map(x=>x.lead_id);
 assert.equal(ids.includes(recent.id),false);
 assert.equal(ids.includes(refused.id),false);
 assert.equal(Number(ids.includes(first.id))+Number(ids.includes(sister.id)),1);
 assert.equal(ids.includes(another.id),true);
 assert.equal(ids.includes(due.id),true);
 assert.equal(q.approachQueueStatus().origin,'AUTONOMOUS');
 assert.equal(d.one('SELECT COUNT(*) n FROM leads WHERE contact_permission=1').n,0);
});
test('one attempt every 90 seconds, even when the queue is checked every second',async()=>{
 let time=at.getTime();
 const sent=[];
 const send=async(_path,options)=>{sent.push({time,body:options.data.message.text});return {status:true};};
 const deps={currentTime:()=>time,getWaStatus:async()=>({connected:true,sessionId:'test-session'}),getSession:()=> 'test-session',send};
 assert.equal((await q.tickApproachQueue(deps)).status,'SENT');
 assert.equal(sent.length,1);
 time+=89_999;
 assert.equal((await q.tickApproachQueue(deps)).status,'WAITING');
 assert.equal(sent.length,1);
 time+=1;
 assert.equal((await q.tickApproachQueue(deps)).status,'SENT');
 assert.equal(sent.length,2);
 assert.equal(sent[1].time-sent[0].time,90_000);
 const contacted=d.one("SELECT lead_id FROM prospecting_batch_items WHERE status='SENT' ORDER BY attempt_at LIMIT 1").lead_id;
 assert.equal(operatorSelected(contacted),true);
 const thread=d.getThread(contacted);
 d.addMessage({threadId:thread.id,direction:'in',body:'Tudo bem, e com vocês?'});
 assert.equal(conversationAuthorized(contacted),true);
 time=Date.parse('2026-11-04T20:30:00Z'); // 17:30 São Paulo
 assert.equal((await q.tickApproachQueue(deps)).status,'OUTSIDE_WINDOW');
 assert.equal(sent.length,2);
 d.setSetting('paused',true);
 assert.equal((await q.tickApproachQueue(deps)).status,'PAUSED');
});
test.after(()=>{d.db.close();fs.rmSync(dir,{recursive:true,force:true});});
