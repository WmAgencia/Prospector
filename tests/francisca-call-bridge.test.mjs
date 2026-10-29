import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/francisca-voice-bridge-');
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.PROSPECTOR_OWNER_PHONE='5515981817336';
process.env.WA_AKG_CALL_LAB_ENABLED='true';
process.env.PROSPECTOR_LIVE_TEST_ENABLED='false';
process.env.WA_CALL_BRIDGE_SECRET='f'.repeat(64);
const {authorizeCallBridge,processCallBridge,callBridgeStatus}=await import('../dashboard/francisca-call-bridge.mjs');
test('Voice gateway requires a full server-to-server token',()=>{
 assert.equal(authorizeCallBridge('f'.repeat(64)),true);
 assert.equal(authorizeCallBridge('f'.repeat(63)),false);
 assert.equal(authorizeCallBridge('x'.repeat(64)),false);
 assert.equal(authorizeCallBridge(''),false);
 assert.equal(callBridgeStatus().bridgeConfigured,true);
});
test('Only complete verified WhatsApp identity can open a voice call',async()=>{
 const base={callId:'AACC1122334455',event:'end',jid:'5515981817336@s.whatsapp.net',sessionId:'consecom-principal'};
 await assert.rejects(processCallBridge({...base,jid:'5511999988877@s.whatsapp.net'}),/UNVERIFIED/);
 await assert.rejects(processCallBridge({...base,sessionId:'wrong'}),/UNVERIFIED/);
 assert.deepEqual(await processCallBridge(base),{ok:true,ended:true});
});
test('Oversized audio and malformed events fail closed',async()=>{
 const b={callId:'AACC1122334455',jid:'5515981817336@s.whatsapp.net',sessionId:'consecom-principal'};
 await assert.rejects(processCallBridge({...b,event:'turn',pcm16k:'A'.repeat(16000*2*15*2)}),/TOO_LARGE/);
 await assert.rejects(processCallBridge({...b,event:'unknown'}),/EVENT_INVALID/);
});
test.after(async()=>{
 const {db}=await import('../dashboard/db.mjs');
 db.close();fs.rmSync(dir,{recursive:true,force:true});
});
