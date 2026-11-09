import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'voice-demo-once-'));
process.env.PROSPECTOR_PITCH_AUDIO_ENABLED='true';
process.env.PROSPECTOR_OWNER_VOICE_DEMO_ENABLED='true';
const {db}=await import('../dashboard/db.mjs');
const {runOwnerVoiceDemo}=await import('../dashboard/owner-voice-demo.mjs');
const {sendVoiceWithRecording}=await import('../dashboard/waakg-voice-presence.mjs');
const from='5515981817336',to='5515981732994';
const sourceSession='sender-7336-test';
const matchingSession=()=>({items:[
 {session_id:sourceSession,connected:true,number:from,numberSuffix:'7336'},
 {session_id:'not-sender-2994',connected:true,number:to,numberSuffix:'2994'}
]});
test('voice note emits recording presence, then the media, then paused',async()=>{
 const events=[];
 const result=await sendVoiceWithRecording({
  jid:to+'@s.whatsapp.net',session:sourceSession,bytes:Buffer.alloc(422018,50),
  sendPresence:async(_,request)=>{events.push(request.data.presence);return {status:true};},
  sleep:async(ms)=>{assert.equal(ms,4200);events.push('hold');},
  sendAudio:async options=>{events.push('voice-media');assert.equal(options.jid,to+'@s.whatsapp.net');return {accepted:true};}
 });
 assert.equal(result.accepted,true);
 assert.equal(result.recordingPresenceAccepted,true);
 assert.deepEqual(events,['recording','hold','voice-media','paused']);
});
test('voice test requires source full identity, no wrong-account fallback',async()=>{
 let sends=0;
 const result=await runOwnerVoiceDemo({from,to},{sessions:async()=>({items:[
  {session_id:'only-2994',connected:true,number:to,numberSuffix:'2994'},
  {session_id:'old-7336',connected:false,number:from,numberSuffix:'7336'}
 ]}),sendAudio:async()=>{sends++;return {accepted:true}}});
 assert.equal(result.state,'SENDER_NOT_CONNECTED');
 assert.equal(result.attempted,false);
 assert.equal(sends,0);
});
test('exact identity sends one voice note and records once across repeated launches',async()=>{
 let sends=0,history=0;
 const deps={
  sessions:async()=>matchingSession(),
  loadAudio:async()=>({bytes:Buffer.alloc(422018,42)}),
  sendAudio:async({jid,session,bytes})=>{
   sends++;assert.equal(jid,to+'@s.whatsapp.net');
   assert.equal(session,sourceSession);
   assert.equal(bytes.length,422018);
   return {accepted:true,recordingPresenceAccepted:true};
  },
  wait:async()=>{},
  queryHistory:async()=>{history++;return {data:[{fromMe:true,messageType:'audioMessage'}]}}
 };
 const first=await runOwnerVoiceDemo({from,to},deps);
 assert.equal(first.state,'GATEWAY_ACCEPTED',JSON.stringify(first));
 assert.equal(first.recordingPresenceAccepted,true);
 assert.equal(first.historyAudioFound,true);
 assert.equal(first.recipientPlaybackVerified,false);
 assert.equal(sends,1);
 assert.equal(history,1);
 const second=await runOwnerVoiceDemo({from,to},deps);
 assert.equal(second.state,'ALREADY_ATTEMPTED');
 assert.equal(sends,1);
});
test.after(()=>{db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true})});
