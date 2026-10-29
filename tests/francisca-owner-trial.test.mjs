import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/francisca-7336-');
const db=await import('../dashboard/db.mjs');
const {sendOneTimeFranciscaTrial,FRANCISCA_TRIAL_MESSAGE}=await import('../dashboard/francisca-owner-trial.mjs');
const vars=['RUN_FRANCISCA_7336_SEND_ONCE','PROSPECTOR_LIVE_TEST_ENABLED','PROSPECTOR_LIVE_TEST_PHONE','FRANCISCA_TTS_ENABLED','AI_CONVERSATION_AUTOSEND','PROSPECTOR_INBOUND_AUTOREPLY_ENABLED'];
const original=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
let sends=0,tts=0;
const mock={status:async()=>({connected:true,sessionId:'consecom-principal'}),
 identity:async()=>({connected:true,numberSuffix:'2994'}),
 request:async()=>({data:[{isActive:true,url:'https://prospector-operacional-production.up.railway.app/api/wa-akg/webhook',events:['message.received']}]}),
 synthesize:async text=>{tts++;assert.equal(text,FRANCISCA_TRIAL_MESSAGE);return {bytes:Buffer.alloc(1800)};},
 send:async args=>{sends++;assert.equal(args.jid,'5515981817336@s.whatsapp.net');assert.equal(args.session,'consecom-principal');return {accepted:true};}
};
test('No audio sent without matching complete phone and isolated test flags',async()=>{
 assert.equal((await sendOneTimeFranciscaTrial(mock)).state,'DISABLED');
 assert.equal(sends,0);
 Object.assign(process.env,{RUN_FRANCISCA_7336_SEND_ONCE:'true',PROSPECTOR_LIVE_TEST_ENABLED:'true',
  PROSPECTOR_LIVE_TEST_PHONE:'5515981817337',FRANCISCA_TTS_ENABLED:'true',
  AI_CONVERSATION_AUTOSEND:'false',PROSPECTOR_INBOUND_AUTOREPLY_ENABLED:'false'});
 assert.equal((await sendOneTimeFranciscaTrial(mock)).state,'DISABLED');
 assert.equal(sends,0);
 process.env.PROSPECTOR_LIVE_TEST_PHONE='5515981817336';
});
test('Sender must be 2994 and webhook subscribed to inbound messages',async()=>{
 assert.equal((await sendOneTimeFranciscaTrial({...mock,identity:async()=>({connected:true,numberSuffix:'7336'})})).state,'UNSAFE_SESSION');
 assert.equal((await sendOneTimeFranciscaTrial({...mock,request:async()=>({data:[]})})).state,'WEBHOOK_MISSING');
 assert.equal(sends,0);
});
test('Sends exactly one Francisca voice message with no retry',async()=>{
 const ack=await sendOneTimeFranciscaTrial(mock);
 assert.equal(ack.state,'ACCEPTED');
 assert.equal(ack.accepted,true);
 assert.equal(ack.deliveredOnPhoneVerified,false);
 assert.equal(sends,1);assert.equal(tts,1);
 assert.equal(db.one("SELECT state FROM francisca_qa_once WHERE recipient='5515981817336'").state,'ACCEPTED');
 assert.equal((await sendOneTimeFranciscaTrial(mock)).state,'ALREADY_ATTEMPTED');
 assert.equal(sends,1);
});
test.after(()=>{
 for(const [k,v] of Object.entries(original)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{force:true,recursive:true});
});
