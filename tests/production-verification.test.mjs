import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {runProductionVerification} from '../dashboard/production-verification.mjs';
const id='a3758296-e93c-4cb5-bcc4-a1c2b2fa72c2';
function fixture(){
 const database=new DatabaseSync(':memory:');
 const calls=[];
 const deps={database,env:{PROSPECTOR_PRODUCTION_VERIFY_ENABLED:'true',PROSPECTOR_PRODUCTION_VERIFY_ID:id},
  selected:()=> 'principal',status:async()=>({connected:true,sessionId:'principal'}),
  request:async(path,options)=>{if(!options)return {data:{sessionId:'principal',me:{id:'5511999999999:1@s.whatsapp.net'}}};calls.push('TEXT');return {status:true,data:{key:{id:'text-1'}}};},
  suppressed:()=>false,synthesize:async()=>({bytes:Buffer.alloc(300)}),
  sendVoice:async()=>{calls.push('VOICE');return {accepted:true};}};
 return {deps,calls,database};
}
test('disabled and malformed IDs perform no transport work',async()=>{
 for(const env of [{},{PROSPECTOR_PRODUCTION_VERIFY_ENABLED:'true',PROSPECTOR_PRODUCTION_VERIFY_ID:'bad'}]){
  const {deps,calls}=fixture();deps.env=env;deps.status=()=>assert.fail('must not inspect transport');
  assert.match((await runProductionVerification(deps)).state,/DISABLED|INVALID_ID/);assert.deepEqual(calls,[]);
 }
});
test('disconnected, wrong session, missing identity, self sender and suppression fail closed',async()=>{
 for(const override of [
  {status:async()=>({connected:false,sessionId:'principal'})},
  {status:async()=>({connected:true,sessionId:'other'})},
  {request:async()=>({data:{me:{}}})},
  {request:async()=>({data:{sessionId:'other',me:{id:'5511999999999@s.whatsapp.net'}}})},
  {request:async()=>({data:{me:{id:'5515981817336@s.whatsapp.net'}}})},
  {suppressed:()=>true}
 ]){const {deps,calls}=fixture();Object.assign(deps,override);assert.equal((await runProductionVerification(deps)).state,'BLOCKED');assert.deepEqual(calls,[]);}
});
test('accepted text and voice reserve before sending and do not repeat after restart',async()=>{
 const {deps,calls,database}=fixture();
 deps.sendVoice=async()=>{assert.equal(database.prepare("SELECT state FROM production_verification_parts WHERE part='VOICE'").get().state,'UNKNOWN');calls.push('VOICE');return {accepted:true};};
 const result=await runProductionVerification(deps);
 assert.equal(result.state,'PROVIDER_ACCEPTED');assert.equal(result.delivery,'UNVERIFIED_ON_PHONE');assert.equal(result.recipientSuffix,'7336');
 assert.equal(result.parts[0].providerMessageId,'text-1');assert.deepEqual(calls,['TEXT','VOICE']);
 assert.equal((await runProductionVerification({...deps})).state,'ALREADY_RESERVED');assert.deepEqual(calls,['TEXT','VOICE']);
 assert.equal(JSON.stringify(result).includes('5515981817336'),false);
});
test('ambiguous text stops voice and never replays either part',async()=>{
 const {deps,calls}=fixture();const request=deps.request;deps.request=async(p,o)=>{if(o){calls.push('TEXT');throw Error('timeout secret');}return request(p,o);};
 assert.equal((await runProductionVerification(deps)).state,'UNKNOWN');
 assert.equal((await runProductionVerification({...deps})).state,'ALREADY_RESERVED');assert.deepEqual(calls,['TEXT']);
});
test('voice failure preserves accepted text and unknown voice',async()=>{
 const {deps,database}=fixture();deps.sendVoice=async()=>{throw Error('voice timeout');};
 const result=await runProductionVerification(deps);assert.equal(result.state,'UNKNOWN');
 assert.deepEqual(database.prepare('SELECT part,state FROM production_verification_parts ORDER BY part').all().map(x=>({...x})),[{part:'TEXT',state:'ACCEPTED'},{part:'VOICE',state:'UNKNOWN'}]);
});
test('definite synthesis failure does not reserve or send',async()=>{
 const {deps,calls,database}=fixture();deps.synthesize=async()=>{throw Error('tts secret');};
 assert.equal((await runProductionVerification(deps)).state,'VOICE_UNAVAILABLE');assert.deepEqual(calls,[]);
 assert.equal(database.prepare('SELECT count(*) AS n FROM production_verifications').get().n,0);
});
test('UUID capitalization cannot replay the one-time test',async()=>{
 const {deps,calls}=fixture();await runProductionVerification(deps);
 deps.env.PROSPECTOR_PRODUCTION_VERIFY_ID=id.toUpperCase();
 assert.equal((await runProductionVerification(deps)).state,'ALREADY_RESERVED');assert.deepEqual(calls,['TEXT','VOICE']);
});
test('blocked diagnostics are safe enumerated reasons',async()=>{
 const {deps}=fixture();deps.status=async()=>{throw Error('secret fullnumber');};
 const result=await runProductionVerification(deps);assert.equal(result.blockedReason,'STATUS_ERROR');assert.equal(JSON.stringify(result).includes('secret'),false);
 deps.status=async()=>({connected:false,sessionId:'principal'});
 assert.equal((await runProductionVerification(deps)).blockedReason,'OFFLINE');
 deps.suppressed=()=>true;assert.equal((await runProductionVerification(deps)).blockedReason,'SUPPRESSED');
});
