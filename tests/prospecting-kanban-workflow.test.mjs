import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-workflow-board-'));
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.WA_AKG_SESSION_ID='test-wa-sender';
process.env.PROSPECTOR_COLD_FIRST_APPROACH='true';
const d=await import('../dashboard/db.mjs');
const q=await import('../dashboard/prospecting-queue.mjs');
const {kanbanSnapshot}=await import('../dashboard/kanban.mjs');
const {textReceipt,receiveTextReceiptStatus}=await import('../dashboard/prospecting-text-receipts.mjs');
const {routeIntroductionReply}=await import('../dashboard/prospecting-introduction.mjs');
const {workflowChecklist}=await import('../dashboard/prospecting-workflow-view.mjs');
const at=new Date('2026-11-24T14:00:00Z'); // Tuesday 11:00 SP
d.setSetting('daily_limit',80);
d.setSetting('paused',false);
d.setSetting('autonomous_outreach_enabled',true);
for(let i=0;i<85;i++)d.addLead({business:'Empresa do lote '+i,phone:'55159877'+String(10000+i),city:'Sorocaba',source:'TEST'});
let batchId=null;
test('80 leads are scheduled before any transport, visible in a new leftmost queue',()=>{
 const batch=q.enrollAutonomousApproaches({at});
 assert.equal(batch.status,'QUEUED');
 assert.equal(batch.queued,80);
 batchId=batch.batchId;
 const snap=kanbanSnapshot({limit:120});
 assert.equal(snap.counts.queued,80);
 assert.equal(snap.counts.approaching,0);
 assert.equal(snap.columns.queued.length,80);
 assert.deepEqual(snap.columns.queued[0].workflow.checklist.map(x=>x.key),
  ['GREETING','REPLY','INTRO','PERMISSION','AUDIO','VIDEO']);
 assert.equal(snap.columns.queued[0].workflow.checklist[0].status,'QUEUED');
 assert.equal(d.one("SELECT COUNT(*) n FROM initial_contacts").n,0);
});
test('gateway acceptance is not confirmation: lead remains queued until exact WhatsApp receipt',async()=>{
 const send=async()=>({status:true,data:{key:{id:'WA_TEST_GREETING_0001'}}});
 const result=await q.tickApproachQueue({
  currentTime:()=>at.getTime(),
  getWaStatus:async()=>({connected:true,sessionId:'test-wa-sender'}),
  getSession:()=> 'test-wa-sender',send
 });
 assert.equal(result.status,'SENT');
 const item=d.one("SELECT lead_id,id,phone FROM prospecting_batch_items WHERE status='SENT' LIMIT 1");
 const receipt=textReceipt(item.lead_id,item.id,'GREETING');
 assert.equal(receipt.status,'ACCEPTED');
 assert.equal(receipt.provider_id,'WA_TEST_GREETING_0001');
 assert.equal(kanbanSnapshot({limit:120}).counts.queued,80);
 assert.equal(receiveTextReceiptStatus({event:'message.status',sessionId:'test-wa-sender',data:{keyId:'INVALID_OTHER_MESSAGE',status:'DELIVERED',remoteJid:item.phone+'@s.whatsapp.net'}}),false);
 assert.equal(kanbanSnapshot({limit:120}).counts.approaching,0);
 assert.equal(receiveTextReceiptStatus({event:'message.status',sessionId:'test-wa-sender',data:{keyId:receipt.provider_id,status:'DELIVERED',remoteJid:item.phone+'@s.whatsapp.net'}}),true);
 assert.equal(kanbanSnapshot({limit:120}).counts.queued,79);
 assert.equal(kanbanSnapshot({limit:120}).counts.approaching,1);
 assert.equal(textReceipt(item.lead_id,item.id,'GREETING').status,'DELIVERED');
 assert.equal(receiveTextReceiptStatus({event:'message.sent',sessionId:'test-wa-sender',data:{key:{id:receipt.provider_id,remoteJid:item.phone+'@s.whatsapp.net'}}}),true);
 assert.equal(textReceipt(item.lead_id,item.id,'GREETING').status,'DELIVERED');
 assert.equal(q.approachQueueStatus().waiting,79);
});
test('real inbound reply is separately confirmed and does not duplicate the greeting',()=>{
 const item=d.one("SELECT lead_id,id,phone FROM prospecting_batch_items WHERE status='SENT' LIMIT 1");
 const response=routeIntroductionReply({leadId:item.lead_id,providerId:'test-session:INBOUND_0001',body:'Oi, tudo bem',inboxState:'REVIEW',receivedAt:new Date(at.getTime()+60_000)});
 assert.equal(response.state,'WAITING');
 const progress=workflowChecklist({leadId:item.lead_id,greetingId:item.id});
 assert.equal(progress.checklist[0].status,'DELIVERED');
 assert.equal(progress.checklist[1].status,'RECEIVED');
 assert.equal(progress.checklist[2].status,'WAITING');
 assert.equal(q.approachQueueStatus().waiting,79);
});
test('actual WhatsApp history prevents a duplicate first greeting before any transport',async()=>{
 const time=new Date(at.getTime()+200_000);
 const next=d.one("SELECT q.*,l.business,l.name FROM prospecting_batch_items q JOIN leads l ON l.id=q.lead_id WHERE q.status='QUEUED' ORDER BY q.created_at,q.id LIMIT 1");
 const {greetingForProspect}=await import('../dashboard/prospecting-introduction.mjs');
 const outgoing=greetingForProspect(next,time);
 let sent=0;
 const result=await q.tickApproachQueue({currentTime:()=>time.getTime(),
  getWaStatus:async()=>({connected:true,sessionId:'test-wa-sender'}),getSession:()=> 'test-wa-sender',
  fetchHistory:async()=>({status:true,data:[{fromMe:true,type:'TEXT',keyId:'ALREADY_EXISTING_001',content:outgoing,
   timestamp:time.toISOString(),status:'DELIVERED'}]}),
  send:async()=>{sent++;throw Error('DUPLICATE MUST NOT SEND');}});
 assert.equal(result.status,'HISTORY_CONFLICT');
 assert.equal(sent,0);
 assert.equal(d.one("SELECT status FROM prospecting_batch_items WHERE id=?",next.id).status,'SKIPPED');
 assert.equal(textReceipt(next.lead_id,next.id,'GREETING'),null);
});

test.after(()=>{d.db.close();fs.rmSync(dir,{recursive:true,force:true});});
