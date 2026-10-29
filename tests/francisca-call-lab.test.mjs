import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/francisca-call-lab-');
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.PROSPECTOR_OWNER_PHONE='5515981817336';
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.PROSPECTOR_LIVE_TEST_ENABLED='false';
process.env.WA_AKG_CALL_LAB_ENABLED='true';
const {wavFromPcm16,verifyVoiceOwner,newFranciscaCallSession,callLabStatus}=await import('../dashboard/francisca-call-lab.mjs');
const OWNER={jid:'5515981817336@s.whatsapp.net',sessionId:'consecom-principal'};
const pcm=Buffer.alloc(16000*2);
test('PCM input is encapsulated in a valid 16-bit mono 16k WAV',()=>{
 const wav=wavFromPcm16(pcm);
 assert.equal(wav.subarray(0,4).toString(),'RIFF');
 assert.equal(wav.subarray(8,12).toString(),'WAVE');
 assert.equal(wav.readUInt16LE(22),1);
 assert.equal(wav.readUInt32LE(24),16000);
 assert.equal(wav.readUInt16LE(34),16);
 assert.equal(wav.readUInt32LE(40),pcm.length);
 assert.equal(wav.length,pcm.length+44);
});
test('Unknown or incorrect caller, session, and disabled setting fail closed',()=>{
 assert.throws(()=>verifyVoiceOwner({jid:'5511981817336@s.whatsapp.net',sessionId:OWNER.sessionId}),/UNVERIFIED/);
 assert.throws(()=>verifyVoiceOwner({...OWNER,sessionId:'other'}),/UNVERIFIED/);
 assert.throws(()=>verifyVoiceOwner({...OWNER,jid:'5515981817336@lid'}),/UNVERIFIED/);
 process.env.WA_AKG_CALL_LAB_ENABLED='false';
 assert.throws(()=>verifyVoiceOwner(OWNER),/DISABLED/);
 process.env.WA_AKG_CALL_LAB_ENABLED='true';
});
test('Read-only Francisca audio turn and lifecycle work without live external calls',async()=>{
 let requests=0;
 const session=newFranciscaCallSession(OWNER,{
  transcribe:async({buffer,filename})=>{assert.equal(filename,'live-turn.wav');assert.equal(buffer.readUInt32LE(24),16000);return{text:'Francisca, bom dia'};},
  chat:async({tools})=>{requests++;assert(!tools.some(t=>t.function.name==='request_start_outreach'));return{choice:{content:'Bom dia! Estou pronta para ajudar.'}};},
  synthesize:async(text)=>{assert.match(text,/Bom dia/);return {bytes:Buffer.alloc(512),voice:'pt-BR-FranciscaNeural'};},
  convert:async()=>Buffer.alloc(640)
 });
 assert.equal(session.state,'READY');
 const reply=await session.reply(pcm);
 assert.equal(reply.heard,'Francisca, bom dia');
 assert.equal(reply.rate,16000);
 assert.equal(reply.pcm16k.length,640);
 assert.equal(requests,1);
 session.end();
 assert.equal(session.state,'ENDED');
 await assert.rejects(session.reply(pcm),/CALL_ENDED/);
});
test('Mutation tool requests from a model are rejected before invoking a tool',async()=>{
 let actualCalls=0,rounds=0;
 const session=newFranciscaCallSession(OWNER,{
  transcribe:async()=>({text:'Criar campanha'}),synthesize:async()=>({bytes:Buffer.alloc(500)}),
  convert:async()=>Buffer.alloc(200),
  readTool:async()=>{actualCalls++;throw Error('MUST_NOT_RUN');},
  chat:async()=>{rounds++;return rounds===1?{choice:{role:'assistant',content:null,tool_calls:[{id:'call_1',type:'function',function:{name:'request_start_outreach',arguments:'{}'}}]}}:{choice:{content:'Para mudar campanhas, confirme por texto.'}};}
 });
 const result=await session.reply(pcm);
 assert.equal(actualCalls,0);
 assert.match(result.spoken,/confirme por texto/);
});
test('Malformed, oversized and extremely short audio segments are refused',()=>{
 assert.throws(()=>wavFromPcm16(Buffer.alloc(9)),/INVALID_DURATION/);
 assert.throws(()=>wavFromPcm16(Buffer.alloc(16_000*2*15)),/INVALID_DURATION/);
 assert.equal(callLabStatus().answeringCalls,false);
 assert.equal(callLabStatus().mediaTransportConnected,false);
});
test.after(async()=>{const {db}=await import('../dashboard/db.mjs');db.close();fs.rmSync(dir,{recursive:true,force:true});});
