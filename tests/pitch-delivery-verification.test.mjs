import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// No WhatsApp transport or production database is used by this suite.
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-receipts-'));
const {db,run,now}=await import('../dashboard/db.mjs');
const {registerSession,bindLeadSession}=await import('../dashboard/waakg-session-registry.mjs');
const {
 beginPitchDelivery,acknowledgePitchDelivery,receivePitchDeliveryStatus,
 pitchDeliveryReceipt,unknownPitchDelivery,matchPitchHistory,reconcilePitchDeliveries
}=await import('../dashboard/pitch-delivery-verification.mjs');
const {CAMPAIGN_VIDEO_CAPTION}=await import('../dashboard/consecom-flow.mjs');
db.exec(`CREATE TABLE IF NOT EXISTS prospecting_introductions(
 lead_id TEXT PRIMARY KEY, greeting_id TEXT NOT NULL, stage TEXT NOT NULL, followup_status TEXT)`);
const leadId='test-pitch-receipt';
const jid='5515999994444@s.whatsapp.net';
const sessionId='prospector-test-session';
registerSession(sessionId,'Test session');
const timestamp=now();
run('INSERT INTO leads(id,business,phone,stage,contact_permission,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?)',
 leadId,'Empresa Teste','5515999994444','CONVERSING',1,timestamp,timestamp);
bindLeadSession(leadId,sessionId);
run('INSERT INTO prospecting_introductions(lead_id,greeting_id,stage,followup_status) VALUES(?,?,?,?)',
 leadId,'greeting-001','SENDING',null);

test('one reservation per client, greeting and media kind even after timeout',()=>{
 const args={leadId,greetingId:'greeting-001',kind:'AUDIO',sessionId,jid};
 assert.equal(beginPitchDelivery(args),true);
 assert.throws(()=>beginPitchDelivery(args),/PITCH_DUPLICATE_BLOCKED/);
 unknownPitchDelivery({...args,reason:'HTTP_TIMEOUT'});
 assert.equal(pitchDeliveryReceipt(leadId,'greeting-001','AUDIO').status,'UNKNOWN');
 assert.throws(()=>beginPitchDelivery(args),/PITCH_DUPLICATE_BLOCKED/);
});

test('only matching WhatsApp message ID can confirm delivery',()=>{
 acknowledgePitchDelivery({leadId,greetingId:'greeting-001',kind:'AUDIO',providerId:'TEST_AUDIO_123456'});
 assert.equal(receivePitchDeliveryStatus({event:'message.status',sessionId,data:{keyId:'OTHER_ID',remoteJid:jid,status:'DELIVERED'}}),false);
 assert.equal(pitchDeliveryReceipt(leadId,'greeting-001','AUDIO').status,'ACCEPTED');
 assert.equal(receivePitchDeliveryStatus({event:'message.status',sessionId,data:{keyId:'TEST_AUDIO_123456',remoteJid:jid,status:'DELIVERED'}}),true);
 assert.equal(pitchDeliveryReceipt(leadId,'greeting-001','AUDIO').status,'DELIVERED');
 assert.equal(receivePitchDeliveryStatus({event:'message.status',sessionId,data:{keyId:'TEST_AUDIO_123456',remoteJid:jid,status:'SENT'}}),true);
 assert.equal(pitchDeliveryReceipt(leadId,'greeting-001','AUDIO').status,'DELIVERED');
 assert.equal(receivePitchDeliveryStatus({event:'message.status',sessionId,data:{keyId:'TEST_AUDIO_123456',remoteJid:jid,status:'READ'}}),true);
 assert.equal(pitchDeliveryReceipt(leadId,'greeting-001','AUDIO').status,'READ');
});

test('remote history with message ID matches only the exact outgoing media',()=>{
 const stamp=now();
 const record={kind:'VIDEO',provider_id:'VIDEO_ID_ABC',attempted_at:stamp};
 const matching={fromMe:true,type:'VIDEO',keyId:'VIDEO_ID_ABC',timestamp:stamp,status:'DELIVERED'};
 const decoy={...matching,keyId:'OTHER_VIDEO_ID'};
 assert.equal(matchPitchHistory(record,[decoy,matching]).state,'EXACT');
 assert.equal(matchPitchHistory(record,[decoy]).state,'NOT_FOUND');
});

test('without ID, a matching media is only a possible receipt and never proof',()=>{
 const stamp=now();
 const record={kind:'AUDIO',provider_id:null,attempted_at:stamp};
 const voice={fromMe:true,type:'AUDIO',keyId:'VOICE_ONE',timestamp:stamp,status:'SENT'};
 assert.equal(matchPitchHistory(record,[voice]).state,'POSSIBLE');
 assert.equal(matchPitchHistory(record,[voice,{...voice,keyId:'VOICE_TWO'}]).state,'AMBIGUOUS');
 assert.equal(matchPitchHistory(record,[]).state,'NOT_FOUND');
});


test('a unique exact video caption in WhatsApp history restores a lost send ID',async()=>{
 run("UPDATE prospecting_introductions SET stage='VOICE_SENT',followup_status='SENDING' WHERE lead_id=?",leadId);
 assert.equal(beginPitchDelivery({leadId,greetingId:'greeting-001',kind:'VIDEO',sessionId,jid}),true);
 unknownPitchDelivery({leadId,greetingId:'greeting-001',kind:'VIDEO',reason:'TIMEOUT_AFTER_SEND'});
 const attempted=pitchDeliveryReceipt(leadId,'greeting-001','VIDEO');
 const found={fromMe:true,type:'VIDEO',keyId:'VIDEO_FROM_HISTORY_11',
  content:CAMPAIGN_VIDEO_CAPTION,timestamp:attempted.attempted_at,status:'DELIVERED'};
 assert.equal(matchPitchHistory(attempted,[found]).state,'EXACT_CAPTION');
 const result=await reconcilePitchDeliveries({fetchChat:async()=>({status:true,data:[found]}),limit:4});
 assert.equal(result.checked>=1,true);
 const repaired=pitchDeliveryReceipt(leadId,'greeting-001','VIDEO');
 assert.equal(repaired.provider_id,'VIDEO_FROM_HISTORY_11');
 assert.equal(repaired.status,'DELIVERED');
 assert.throws(()=>beginPitchDelivery({leadId,greetingId:'greeting-001',kind:'VIDEO',sessionId,jid}),/PITCH_RECEIPT_DUPLICATE_BLOCKED|PITCH_RECEIPT_NOT_RESERVED|PITCH_DUPLICATE_BLOCKED/);
});

test('sender session is bound to each lead',()=>{
 assert.throws(()=>beginPitchDelivery({
  leadId,greetingId:'greeting-001',kind:'VIDEO',sessionId:'wrong-sender',jid
 }),/PITCH_RECEIPT_INVALID_ROUTE/);
});
