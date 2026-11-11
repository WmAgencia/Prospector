import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-overview-period-'));
const db=await import('../dashboard/db.mjs');
await import('../dashboard/prospecting-queue.mjs');
const {approachPeriodRange,summarizeFirstApproaches,firstApproachHistory}=await import('../dashboard/overview-approaches.mjs');
const at=new Date('2026-11-11T15:20:00.000Z');
const fixtures=[
 {lead_id:'a',at:'2026-11-11T03:02:00Z'}, // Nov 11 00:02 in Sao Paulo
 {lead_id:'a',at:'2026-11-11T11:00:00Z'}, // duplicate reply/ledger evidence
 {lead_id:'b',at:'2026-11-11T02:59:00Z'}, // Nov 10 23:59 in Sao Paulo
 {lead_id:'c',at:'2026-11-10T13:00:00Z'},
 {lead_id:'d',at:'2026-11-01T13:00:00Z'},
 {lead_id:'e',at:'2026-10-31T13:00:00Z'},
 {lead_id:'future',at:'2026-11-12T13:00:00Z'}
];
test('Today counts only first approaches on the Sao Paulo day',()=>{
 const x=summarizeFirstApproaches(fixtures,{at,period:'today'});
 assert.equal(x.from,'2026-11-11');assert.equal(x.to,'2026-11-11');
 assert.equal(x.total,1);assert.deepEqual(x.daily,[{date:'2026-11-11',approached:1}]);
 assert.equal(x.unit,'unique_first_approached_leads');
});
test('The last seven days include today and each company once',()=>{
 const x=summarizeFirstApproaches(fixtures,{at,period:'7d'});
 assert.equal(x.from,'2026-11-05');assert.equal(x.to,'2026-11-11');
 assert.equal(x.daily.length,7);assert.equal(x.total,3);
 assert.equal(x.daily.at(-1).approached,1);
});
test('The month is calendar month-to-date, not last 30 days',()=>{
 const x=summarizeFirstApproaches(fixtures,{at,period:'month'});
 assert.equal(x.from,'2026-11-01');assert.equal(x.to,'2026-11-11');assert.equal(x.total,4);
});
test('Custom single day works for older days; invalid/future dates rejected',()=>{
 assert.equal(summarizeFirstApproaches(fixtures,{at,period:'day',date:'2026-11-10'}).total,2);
 assert.equal(summarizeFirstApproaches(fixtures,{at,period:'day',date:'2026-10-31'}).total,1);
 assert.throws(()=>approachPeriodRange({period:'day',date:'2026-02-30',at}),/data válida/);
 assert.throws(()=>approachPeriodRange({period:'day',date:'2026-11-12',at}),/data válida/);
 assert.throws(()=>approachPeriodRange({period:'all',at}),/Período inválido/);
});
test('Persisted evidence counts sent greetings but not queued, unknown or replies',()=>{
 const mkLead=(suffix)=>db.addLead({business:'Empresa '+suffix,phone:'1598888'+suffix,source:'MANUAL'}).lead;
 const a=mkLead('1101'),b=mkLead('1102'),c=mkLead('1103'),d=mkLead('1104');
 // One confirmed batch send, duplicated by the initial-contact ledger and a
 // confirmed greeting message, must count as one company.
 const bid=db.id(),itemId=db.id();
 db.run("INSERT INTO prospecting_batches(id,status,created_at,updated_at) VALUES(?,?,?,?)",bid,'ACTIVE',db.now(),db.now());
 db.run("INSERT INTO prospecting_batch_items(id,batch_id,lead_id,phone,status,attempt_at,created_at) VALUES(?,?,?,?,?,?,?)",
  itemId,bid,a.id,a.phone,'SENT','2026-11-11T13:00:00.000Z',db.now());
 db.run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',
  a.id,a.phone,'SENT',itemId,'2026-11-11T13:00:00.000Z');
 const threadA=db.getThread(a.id,a.phone+'@s.whatsapp.net');
 db.addMessage({threadId:threadA.id,providerId:'prospect-queue:'+itemId,direction:'out',body:'Olá!',status:'sent'});
 db.addMessage({threadId:threadA.id,providerId:'intro:'+itemId,direction:'out',body:'Meu nome é Wesley',status:'sent'});
 // A confirmed first step in the legacy workflow also counts.
 db.run("INSERT INTO jobs(id,lead_id,execution_id,step_index,type,text,key,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
  db.id(),b.id,'execution-123',0,'message','Olá','first-contact-b','SENT','2026-11-10T13:00:00.000Z','2026-11-10T13:01:00.000Z');
 // UNKNOWN delivery and a manual reply cannot count as initial outreach.
 const unknownId=db.id();
 db.run("INSERT INTO prospecting_batch_items(id,batch_id,lead_id,phone,status,attempt_at,created_at) VALUES(?,?,?,?,?,?,?)",
  unknownId,bid,c.id,c.phone,'UNKNOWN','2026-11-11T13:00:00.000Z',db.now());
 const threadC=db.getThread(c.id,c.phone+'@s.whatsapp.net');
 db.addMessage({threadId:threadC.id,providerId:'intro:'+unknownId,direction:'out',body:'Apresentação',status:'sent'});
 // Historical initial-contact ledger is also supported.
 db.run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',
  d.id,d.phone,'SENT',db.id(),'2026-11-01T13:00:00.000Z');
 assert.equal(firstApproachHistory({period:'today',at}).total,1);
 assert.equal(firstApproachHistory({period:'7d',at}).total,2);
 assert.equal(firstApproachHistory({period:'month',at}).total,3);
 assert.equal(firstApproachHistory({period:'day',date:'2026-11-10',at}).total,1);
});
test('Overview server and browser UI are syntactically valid and include custom date control',()=>{
 const files=['dashboard/server.mjs','dashboard/overview-approaches.mjs','dashboard/public/simple-app.js'];
 for(const filename of files){
  const browser=filename.endsWith('.js');
  const r=browser?spawnSync(process.execPath,['--input-type=module','--check'],{input:fs.readFileSync(filename,'utf8'),encoding:'utf8'}):
   spawnSync(process.execPath,['--check',filename],{encoding:'utf8'});
  assert.equal(r.status,0,filename+': '+r.stderr);
 }
 const ui=fs.readFileSync('dashboard/public/simple-app.js','utf8');
 assert.match(ui,/Hoje/);assert.match(ui,/Últimos 7 dias/);
 assert.match(ui,/Este mês/);assert.match(ui,/Personalizado/);
 assert.match(ui,/overview-approach-day/);
 assert.match(ui,/overviewApproachesSection\(\)\+/);
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
