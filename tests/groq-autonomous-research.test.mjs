import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'groq-autonomous-supply-'));
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.PROSPECTOR_AUTO_MAPS_DISCOVERY_ENABLED='true';
process.env.PROSPECTOR_MAPS_BASE_URL='http://prospector-maps.railway.internal:10000';
process.env.PROSPECTOR_MAPS_KEY='a-test-key-not-a-secret';
const db=await import('../dashboard/db.mjs');
const ai=await import('../dashboard/autonomous-prospecting.mjs');
const maps=await import('../dashboard/gosom-maps.mjs');
const {threeMonthsAfter,recontactDecision}=await import('../dashboard/prospecting-recontact.mjs');
const originalFetch=globalThis.fetch;
const morning=new Date('2026-11-04T08:10:00Z'); // 05h10 São Paulo
db.setSetting('discovery_auto_enabled',true);
db.setSetting('cities','Sorocaba,Votorantim,Campinas');
db.setSetting('research_ready_stock_target',60);
db.setSetting('paused',true);
db.setSetting('auto_initial',false);
test('Owner examples are priors, NOT fabricated CRM wins; early plan favors mechanics & events',()=>{
 const signals=ai.commercialNicheSignals();
 assert.equal(signals.automotive.closedWon,0);
 assert.equal(signals.events.closedWon,0);
 const candidates=ai.researchCandidates({at:morning});
 assert.equal(candidates[0].theme,'automotive');
 assert(candidates.some(x=>x.theme==='events'));
 assert.equal(ai.researchCities().length,3);
});
test('Confirmed wins and conversation reply counts drive Groq strategy; raw messages and phone never leave backend',async()=>{
 const won=db.addLead({business:'Oficina QA Privada',city:'Sorocaba',segment:'oficinas mecânicas',phone:'5515999991111',source:'MANUAL'}).lead;
 const thread=db.getThread(won.id);
 db.addMessage({threadId:thread.id,direction:'out',body:'Olá, tudo bem?'});
 db.addMessage({threadId:thread.id,direction:'in',body:'CONVERSA_PRIVADA_QUE_NAO_PODE_SAIR'});
 db.stage(won.id,'CLOSED_WON','confirmed_by_operator');
 assert.equal(ai.commercialNicheSignals().automotive.closedWon,1);
 assert.equal(ai.commercialNicheSignals().automotive.responded,1);
 process.env.GROQ_API_KEY='synthetic-test-model-key';
 let called=0;
 const result=await ai.chooseResearchTarget({at:morning,groq:async({messages,task})=>{
  called++;assert.equal(task,'quick');
  const sent=JSON.stringify(messages);
  assert(!sent.includes('5515999991111'));
  assert(!sent.includes('CONVERSA_PRIVADA_QUE_NAO_PODE_SAIR'));
  assert(!sent.includes('Oficina QA Privada'));
  assert(sent.includes('closedWon'));
  return {model:'synthetic-groq',choice:{content:'{"choice":0,"reason":"prioridade por conversões"}'}};
 }});
 assert.equal(called,1);
 assert.equal(result.source,'groq');
 assert.equal(result.target.theme,'automotive');
 assert.equal(ai.recordResearchPlan(result,{at:morning}).source,'groq');
 const previous=await ai.chooseResearchTarget({at:new Date(morning.getTime()+3600_000),groq:async()=>{
  throw Error('Should use cooldown before another Groq call');
 }});
 assert.equal(previous.source,'local');
 assert.equal(ai.researchIntelligenceStatus({at:morning}).lastPlan.niche,result.target.niche);
 delete process.env.GROQ_API_KEY;
});
test('Three complete calendar months protect already approached contacts, no opt-out recontact',()=>{
 const l=db.addLead({business:'Empresa Retorno QA',city:'Sorocaba',segment:'buffet infantil',phone:'5515999992222',source:'MANUAL'}).lead;
 const initial='2026-08-04T14:00:00.000Z';
 db.run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',
  l.id,l.phone,'SENT',db.id(),initial);
 db.run("UPDATE leads SET stage='NO_INTEREST' WHERE id=?",l.id);
 const before=recontactDecision({id:l.id,phone:l.phone,stage:'NO_INTEREST'},Date.parse('2026-11-04T13:59:59Z'));
 assert.equal(before.eligible,false);
 assert.equal(before.reason,'THREE_MONTH_COOLDOWN');
 assert.equal(threeMonthsAfter(initial),'2026-11-04T14:00:00.000Z');
 const due=recontactDecision({id:l.id,phone:l.phone,stage:'NO_INTEREST'},Date.parse('2026-11-04T14:00:01Z'));
 assert.equal(due.eligible,true);
 db.run('INSERT INTO suppressions(phone,reason,created_at) VALUES(?,?,?)',l.phone,'INBOUND_OPTOUT',initial);
 assert.equal(recontactDecision({id:l.id,phone:l.phone,stage:'NO_INTEREST'},Date.parse('2027-09-05T14:00:00Z')).reason,'OPT_OUT');
});
test('Research starts at 5am São Paulo, replenishes lead stock, respects manual send gate and dedupes same business',async()=>{
 let createCalls=0,files=0;
 const providerId='11111111-1111-4111-8111-111111111111';
 globalThis.fetch=async(url,opts={})=>{
  const u=new URL(String(url));
  assert.equal(u.hostname,'prospector-maps.railway.internal');
  if(u.pathname==='/api/v1/jobs'&&opts.method==='POST'){
   createCalls++;return Response.json({id:providerId});
  }
  if(u.pathname==='/api/v1/jobs/'+providerId)return Response.json({Status:'ok'});
  if(u.pathname==='/api/v1/jobs/'+providerId+'/download'){
   files++;
   return new Response(['link,title,phone,city',
    '"https://www.google.com/maps/place/Mecanica-QA","Mecânica Alfa QA","+55 15 99999-3333","Sorocaba"',
    '"https://www.google.com/maps/place/Mecanica-QA-2","Mecanica Alfa QA","+55 15 99999-3333","Sorocaba"',
   ].join('\n'));
  }
  throw Error('Unknown mock URL '+u.pathname);
 };
 const tooEarly=await maps.automaticMapsDiscovery({at:new Date('2026-11-04T07:59:00Z')});
 assert.equal(tooEarly.status,'BEFORE_START');
 const first=await maps.automaticMapsDiscovery({at:new Date('2026-11-04T08:15:00Z')});
 assert.equal(first.status,'PENDING');
 assert.equal(first.created,true);
 assert.equal(createCalls,1);
 const second=await maps.automaticMapsDiscovery({at:new Date('2026-11-04T08:16:00Z')});
 assert.equal(second.status,'IMPORTED');
 assert.equal(second.added,1);
 assert.equal(files,1);
 assert.equal(db.one("SELECT COUNT(*) n FROM leads WHERE business='Mecânica Alfa QA'").n,1);
 const present=ai.actionableLeadInventory();
 assert(present.ready>=1);
 assert.equal(db.one('SELECT COUNT(*) n FROM initial_contacts').n,1);
 assert.equal(db.getSetting('paused',true),true);
 const next=await maps.automaticMapsDiscovery({at:new Date('2026-11-04T08:17:00Z')});
 assert.equal(next.status,'COOLDOWN');
 assert.equal(createCalls,1);
});
test.after(()=>{globalThis.fetch=originalFetch;delete process.env.GROQ_API_KEY;db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
