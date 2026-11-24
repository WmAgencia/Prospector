import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-legacy-proof-'));
process.env.PROSPECTOR_DATA_DIR=dir;
const db=await import('../dashboard/db.mjs');
await import('../dashboard/prospecting-queue.mjs');
const {WESLEY_INTRO}=await import('../dashboard/prospecting-introduction.mjs');
const {CAMPAIGN_VIDEO_CAPTION}=await import('../dashboard/consecom-flow.mjs');
const {registerSession,bindLeadSession}=await import('../dashboard/waakg-session-registry.mjs');
const {reconcileLegacyProspectingReceipts}=await import('../dashboard/prospecting-legacy-receipt-recovery.mjs');
const sid='legacy-sender-test';
registerSession(sid,'Sender history recovery');
const old=new Date(Date.now()-6*60000).toISOString();
const lead='legacy-proof-lead',phone='5515999912121',jid=phone+'@s.whatsapp.net',greeting='legacy-queue-greeting';
db.run('INSERT INTO leads(id,business,phone,stage,contact_permission,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?)',
 lead,'Legacy proof company',phone,'CONVERSING',1,old,old);
bindLeadSession(lead,sid);
const thread=db.getThread(lead,jid);
db.run("INSERT INTO prospecting_batches(id,status,created_at,updated_at,origin) VALUES(?,?,?,?,?)",
 'legacy-batch','COMPLETED',old,old,'AUTONOMOUS');
db.run("INSERT INTO prospecting_batch_items(id,batch_id,lead_id,phone,status,attempt_at,created_at) VALUES(?,?,?,?,?,?,?)",
 greeting,'legacy-batch',lead,phone,'SENT',old,old);
db.run(`INSERT INTO prospecting_introductions(lead_id,phone,session_id,greeting_id,
 stage,reason,sent_at,followup_status,followup_sent_at,created_at,updated_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?)`,lead,phone,sid,greeting,'VOICE_SENT','PITCH_AUDIO_550',
 old,'SENT',old,old,old);
function local(id,body,type='text'){
 db.addMessage({threadId:thread.id,providerId:id,direction:'out',type,body,status:'sent'});
 db.run('UPDATE messages SET at=? WHERE provider_id=?',old,id);
}
local('prospect-queue:'+greeting,'Olá, empresa!');
local('intro:'+greeting,WESLEY_INTRO);
local('intro-video:'+greeting,CAMPAIGN_VIDEO_CAPTION,'video');
const messages=[
 {fromMe:true,type:'TEXT',keyId:'LEGACY_GREETING_12345',content:'Olá, empresa!',
  status:'READ',timestamp:old,remoteJid:jid},
 {fromMe:true,type:'TEXT',keyId:'LEGACY_INTRO_12345',content:WESLEY_INTRO,
  status:'DELIVERED',timestamp:old,remoteJid:jid},
 {fromMe:true,type:'VIDEO',keyId:'LEGACY_VIDEO_12345',content:CAMPAIGN_VIDEO_CAPTION,
  status:'READ',timestamp:old,remoteJid:jid}
];
test('offline gateway leaves legacy messages untouched, without retries',async()=>{
 let reads=0;
 const r=await reconcileLegacyProspectingReceipts({checkGateway:async()=>({connected:false}),
  fetchChat:async()=>{reads++;return {status:true,data:messages};}});
 assert.equal(r.state,'GATEWAY_OFFLINE');assert.equal(reads,0);
 assert.equal(db.one("SELECT COUNT(*) AS n FROM prospecting_text_receipts").n,0);
});
test('unique WhatsApp history backfills each old text/video receipt without sending',async()=>{
 let reads=0;
 const r=await reconcileLegacyProspectingReceipts({checkGateway:async()=>({connected:true}),
  fetchChat:async()=>{reads++;return {status:true,data:messages};},limit:8});
 assert.equal(r.state,'OK',JSON.stringify(r));
 assert.equal(r.verified,3,JSON.stringify(r));
 assert.equal(reads,3);
 assert.equal(db.one("SELECT status FROM prospecting_text_receipts WHERE lead_id=? AND kind='GREETING'",lead).status,'READ');
 assert.equal(db.one("SELECT status FROM prospecting_text_receipts WHERE lead_id=? AND kind='INTRO'",lead).status,'DELIVERED');
 assert.equal(db.one("SELECT status FROM pitch_delivery_receipts WHERE lead_id=? AND kind='VIDEO'",lead).status,'READ');
 assert.equal(db.one("SELECT COUNT(*) n FROM prospecting_legacy_proof_checks").n,3);
});
test('after verification no new network check or sending is needed',async()=>{
 let reads=0;
 const r=await reconcileLegacyProspectingReceipts({checkGateway:async()=>({connected:true}),
  fetchChat:async()=>{reads++;throw Error('SHOULD_NOT_RECHECK');},limit:8});
 assert.equal(r.checked,0);
 assert.equal(reads,0);
});
test.after(()=>{db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
