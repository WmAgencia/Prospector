import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/prospector-weekend-window-');
process.env.PROSPECTOR_DATA_DIR=dir;
delete process.env.PROSPECTOR_APPROACH_START_DATE;
const db=await import('../dashboard/db.mjs');
const {insideApproachWindow,saoPauloOutreachDay,isOutboundBusinessDay,prospectingWindowLabel}=await import('../dashboard/outreach-window.mjs');
const {canSendInitial}=await import('../dashboard/radar.mjs');
const {preloadApproachQueue,enrollAutonomousApproaches,enqueueApprovedApproaches,tickApproachQueue}=await import('../dashboard/prospecting-queue.mjs');
db.setSetting('paused',false);
db.setSetting('autonomous_outreach_enabled',true);
const time=s=>new Date(s);
test('weekday remains 08:00-17:30 in Sao Paulo',()=>{
 assert.equal(insideApproachWindow(time('2026-11-06T10:59:59Z')),false);
 assert.equal(insideApproachWindow(time('2026-11-06T11:00:00Z')),true);
 assert.equal(insideApproachWindow(time('2026-11-06T20:29:59Z')),true);
 assert.equal(insideApproachWindow(time('2026-11-06T20:30:00Z')),false);
 assert.equal(insideApproachWindow(time('2026-11-09T11:00:00Z')),true);
});
test('Saturday 08:00-17:00, end exclusive',()=>{
 assert.equal(saoPauloOutreachDay(time('2026-11-07T11:00:00Z')),'saturday');
 assert.equal(insideApproachWindow(time('2026-11-07T10:59:59Z')),false);
 assert.equal(insideApproachWindow(time('2026-11-07T11:00:00Z')),true);
 assert.equal(insideApproachWindow(time('2026-11-07T19:59:59Z')),true);
 assert.equal(insideApproachWindow(time('2026-11-07T20:00:00Z')),false);
 assert.match(prospectingWindowLabel(),/Sáb 08:00–17:00/);
});
test('Sunday completely forbids first approaches even around timezone midnight',()=>{
 assert.equal(saoPauloOutreachDay(time('2026-11-08T11:00:00Z')),'sunday');
 for(const dt of ['2026-11-08T03:00:00Z','2026-11-08T10:59:59Z','2026-11-08T11:00:00Z','2026-11-08T19:30:00Z','2026-11-09T02:59:59Z']){
  assert.equal(isOutboundBusinessDay(time(dt)),false,dt);
  assert.equal(insideApproachWindow(time(dt)),false,dt);
 }
 assert.equal(insideApproachWindow(time('2026-11-09T11:00:00Z')),true);
});
test('account-specific hours may restrict, never extend the Saturday 17:00 cutoff',()=>{
 try{
  db.setSetting('client_outreach_hours',{start:'09:00',end:'17:30'});
  assert.equal(insideApproachWindow(time('2026-11-07T11:00:00Z')),false);
  assert.equal(insideApproachWindow(time('2026-11-07T12:00:00Z')),true);
  assert.equal(insideApproachWindow(time('2026-11-07T20:00:00Z')),false);
  assert.equal(insideApproachWindow(time('2026-11-06T20:15:00Z')),true);
  db.setSetting('client_outreach_hours',{start:'17:15',end:'17:30'});
  assert.equal(insideApproachWindow(time('2026-11-07T19:50:00Z')),false);
 }finally{db.setSetting('client_outreach_hours',null);}
});
test('start-date gate still takes priority over weekend schedule',()=>{
 process.env.PROSPECTOR_APPROACH_START_DATE='2026-11-09';
 assert.equal(insideApproachWindow(time('2026-11-07T15:00:00Z')),false);
 assert.equal(insideApproachWindow(time('2026-11-09T11:00:00Z')),true);
 delete process.env.PROSPECTOR_APPROACH_START_DATE;
});
test('old campaign initial worker also obeys no Sunday and shorter Saturday',()=>{
 const config={limit:150,start:8,end:18,intervalSeconds:90};
 assert.equal(canSendInitial(time('2026-11-07T19:59:00Z'),[],config),true);
 assert.equal(canSendInitial(time('2026-11-07T20:00:00Z'),[],config),false);
 assert.equal(canSendInitial(time('2026-11-08T15:00:00Z'),[],config),false);
});
test('Sunday does not preload, enroll or send a queued first contact',async()=>{
 const sunday=time('2026-11-08T12:00:00Z');
 assert.equal(preloadApproachQueue({at:sunday}).status,'OUTSIDE_WINDOW');
 assert.equal(enrollAutonomousApproaches({at:sunday}).status,'OUTSIDE_WINDOW');
 const lead=db.addLead({business:'Loja fictícia com autorização documentada',phone:'5515999123412',city:'Sorocaba',source:'TEST',contact_permission:true}).lead;
 db.audit('CONSENT_UPDATED',lead.id,{permitted:true,evidence:'Opt-in de cenário fictício'});
 const queue=enqueueApprovedApproaches({leadIds:[lead.id],approve:true,operatorApproved:true,offerType:'portfolio'});
 assert.equal(queue.status,202);
 // Model a queue created on Sunday to isolate the day gate; old batches can
 // independently expire before the window check, also without sending.
 db.run('UPDATE prospecting_batches SET created_at=?,updated_at=? WHERE id=?',sunday.toISOString(),sunday.toISOString(),queue.body.batchId);
 let called=0;
 const result=await tickApproachQueue({
  currentTime:()=>sunday.getTime(),getWaStatus:async()=>({connected:true,sessionId:'test'}),
  getSession:()=> 'test',send:async()=>{called++;return {status:true};}
 });
 assert.equal(result.status,'OUTSIDE_WINDOW');
 assert.equal(called,0);
});
test.after(()=>{db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
