import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-voice-presence-'));
process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE='false';
const {sendVoiceWithRecording,OWNER_RECORDING_MIN_MS,PRESENCE_REFRESH_MS,ownerRecordingDurationMs}=await import('../dashboard/waakg-voice-presence.mjs');
const {OWNER_PREVIEW_DELAY_MS,OWNER_PREVIEW_FOLLOWUP}=await import('../dashboard/owner-approved-pitch.mjs');
const sample=Buffer.alloc(1200,42);
const jid='5515999999999@s.whatsapp.net',session='consecom-principal';
test('71s original note records presence throughout and sends only afterward',async()=>{
 const events=[];let elapsed=0;
 const sendPresence=async(_url,payload)=>{events.push([payload.data.presence,elapsed]);return {status:true};};
 const sendAudio=async()=>{events.push(['audio',elapsed]);return {accepted:true};};
 const sleep=async ms=>{elapsed+=ms;};
 const result=await sendVoiceWithRecording({jid,session,bytes:sample,originalOwnerAudio:true,
  sendPresence,sendAudio,sleep,ownerDuration:()=>OWNER_RECORDING_MIN_MS});
 assert.equal(elapsed,71000);
 assert.equal(result.accepted,true);
 assert.equal(result.recordingWaitMs,71000);
 assert.equal(events.at(-2)[0],'audio');
 assert.equal(events.at(-2)[1],71000);
 assert.equal(events.at(-1)[0],'paused');
 assert.equal(events.filter(x=>x[0]==='recording').length,Math.ceil(71000/PRESENCE_REFRESH_MS));
 assert.equal(events.filter(x=>x[0]==='audio').length,1);
});
test('owner voice never sends when presence fails or the emergency stop is triggered',async()=>{
 let sendCount=0;
 await assert.rejects(sendVoiceWithRecording({jid,session,bytes:sample,originalOwnerAudio:true,
  ownerDuration:()=>71000,sleep:async()=>{},
  sendPresence:async()=>({status:false}),sendAudio:async()=>{sendCount++;return {accepted:true};}}),/PRESENCE_UNAVAILABLE/);
 assert.equal(sendCount,0);
 let elapsed=0;
 await assert.rejects(sendVoiceWithRecording({jid,session,bytes:sample,originalOwnerAudio:true,
  ownerDuration:()=>71000,sleep:async ms=>{elapsed+=ms;if(elapsed>=14000)process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE='true';},
  sendPresence:async()=>({status:true}),sendAudio:async()=>{sendCount++;return {accepted:true};}}),/EMERGENCY/);
 assert.equal(sendCount,0);
 process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE='false';
});
test('subsequent site-preview text is scheduled 10 seconds after audio ACK',()=>{
 assert.equal(OWNER_PREVIEW_DELAY_MS,10000);
 assert.match(OWNER_PREVIEW_FOLLOWUP,/prévia de como ficaria o site/);
 assert.match(OWNER_PREVIEW_FOLLOWUP,/O que você acha\?/);
});
test('duration uses actual audio length with a hard minimum of 71s',()=>{
 const probe=(_bin,_args,_opts)=>({stdout:Buffer.from('74.25\n'),status:0});
 assert.equal(ownerRecordingDurationMs(sample,{probe}),74250);
 const shorter=()=>({stdout:Buffer.from('63\n'),status:0});
 assert.equal(ownerRecordingDurationMs(sample,{probe:shorter}),71000);
});
test.after(()=>fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true}));
