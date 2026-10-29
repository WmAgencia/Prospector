import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/prospector-live7336-');
const db=await import('../dashboard/db.mjs');
const {runLive7336Greeting,LIVE_TEST_ID}=await import('../dashboard/groq-live-test-send.mjs');
const old=Object.fromEntries(['RUN_7336_APPROACH_ONCE','RUN_TEST_7336_QUALITY_PASSED','PROSPECTOR_LIVE_TEST_ENABLED','PROSPECTOR_LIVE_TEST_PHONE','PROSPECTOR_HOT_LEAD_PHONE','AI_CONVERSATION_AUTOSEND'].map(k=>[k,process.env[k]]));
const allow=()=>Object.assign(process.env,{RUN_7336_APPROACH_ONCE:'true',RUN_TEST_7336_QUALITY_PASSED:'true',PROSPECTOR_LIVE_TEST_ENABLED:'true',PROSPECTOR_LIVE_TEST_PHONE:'5515981817336',PROSPECTOR_HOT_LEAD_PHONE:'5515981817336',AI_CONVERSATION_AUTOSEND:'false'});
const calls=[];
const deps={
 getStatus:async()=>({connected:true,sessionId:'consecom-principal'}),
 getIdentity:async()=>({connected:true,numberSuffix:'2994'}),
 transport:async(route,params)=>{
  if(route.includes('/api/webhooks/'))return {data:[{url:'https://prospector-operacional-production.up.railway.app/api/wa-akg/webhook',isActive:true,events:['message.received']}]};
  calls.push({route,params});return {status:true};
 }
};
test('No live message is sent without independent preflight and explicit QA flags',async()=>{
 assert.equal((await runLive7336Greeting(deps)).state,'DISABLED');
 assert.equal(calls.length,0);
});
test('Same sender and recipient or missing webhook block the approach',async()=>{
 allow();
 assert.equal((await runLive7336Greeting({...deps,getIdentity:async()=>({connected:true,numberSuffix:'7336'})})).state,'NO_SAFE_CONNECTION');
 assert.equal((await runLive7336Greeting({...deps,transport:async()=>({data:[]})})).state,'WEBHOOK_MISSING');
 assert.equal(calls.length,0);
});
test('One owner-authorized 7336 greeting is sent once and stored durably',async()=>{
 const response=await runLive7336Greeting(deps);
 assert.equal(response.state,'ACCEPTED');
 assert.equal(response.displayVerified,false);
 assert.equal(calls.length,1);
 assert.match(calls[0].route,/5515981817336%40s\.whatsapp\.net\/send$/);
 assert.match(calls[0].params.data.message.text,/^Olá, (bom dia|boa tarde|boa noite), como vai\?$/);
 assert.equal(db.one('SELECT state FROM controlled_qa_sends WHERE id=?',LIVE_TEST_ID).state,'ACCEPTED');
 assert.equal(db.one('SELECT COUNT(*) n FROM messages WHERE direction=\'out\'').n,1);
 const retry=await runLive7336Greeting(deps);
 assert.equal(retry.state,'ALREADY_ATTEMPTED');
 assert.equal(calls.length,1);
});
test.after(()=>{
 for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{force:true,recursive:true});
});
