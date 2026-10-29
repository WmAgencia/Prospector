import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/francisca-qa-reply-');
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.GROQ_API_KEY='unit-test-only';
const vars=['PROSPECTOR_LIVE_TEST_ENABLED','PROSPECTOR_LIVE_TEST_PHONE','AUDIO_RESPONSE_ENABLED','AI_CONVERSATION_AUTOSEND','PROSPECTOR_INBOUND_AUTOREPLY_ENABLED'];
const original=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
Object.assign(process.env,{PROSPECTOR_LIVE_TEST_ENABLED:'true',PROSPECTOR_LIVE_TEST_PHONE:'5515981817336',
 AUDIO_RESPONSE_ENABLED:'true',AI_CONVERSATION_AUTOSEND:'false',PROSPECTOR_INBOUND_AUTOREPLY_ENABLED:'false'});
const db=await import('../dashboard/db.mjs');
const inbound=await import('../dashboard/waakg-audio-inbound.mjs');
const bridge=await import('../dashboard/waakg-bridge.mjs');
const bot=await import('../dashboard/groq-sales-automation.mjs');
const owner=await import('../dashboard/groq-owner.mjs');
test('Incoming audio from 7336 is transcribed to the CRM and answered with a single Francisca voice',async()=>{
 const pid='consecom-principal:TESTAUDIO0001',jid='5515981817336@s.whatsapp.net';
 assert.equal(owner.ownerReceived({jid,sessionId:'consecom-principal',text:'Oi, faz site?',providerId:pid}),false);
 assert.equal(inbound.queueInboundAudio({providerId:pid,jid,sessionId:'consecom-principal',
  fileUrl:'/api/media/consecom-principal-TESTAUDIO0001.ogg'}).queued,true);
 const speech=await inbound.processAudioJobs({
  download:async()=>({buffer:Buffer.alloc(1200),filename:'audio.ogg'}),
  transcribe:async()=>({text:'Olá, vocês fazem sites profissionais?',model:'test-whisper'}),
  deliver:bridge.recordInboundTranscript
 });
 assert.equal(speech.status,'DONE');
 assert.equal(db.one('SELECT state FROM inbound_audio_jobs WHERE provider_id=?',pid).state,'DONE');
 let voices=0,texts=0;
 const result=await bot.tickSalesAgent({
  status:async()=>({connected:true,sessionId:'consecom-principal'}),
  qualify:async()=>({confirmed:false}),
  draft:async()=>({ok:true,draft:'Olá! Criamos sites profissionais. Você quer me contar sobre o seu negócio?'}),
  voice:async()=>({bytes:Buffer.alloc(1500)}),
  sendVoice:async({jid:to,bytes})=>{assert.equal(to,jid);assert.equal(bytes.length,1500);voices++;return {accepted:true};},
  send:async()=>{texts++;return {status:true};}
 });
 assert.ok(result.states.includes('SENT'));
 assert.equal(voices,1);
 assert.equal(texts,0);
 assert.match(db.one("SELECT body FROM messages WHERE provider_id=?", 'groq:'+pid).body,/Áudio Francisca/);
 const repeat=await bot.tickSalesAgent({});
 assert.equal(repeat.processed,0);
 assert.equal(voices,1);
});
test('Other customers cannot receive automatic audio or text during the 7336 trial',async()=>{
 const pid='consecom-principal:OTHER0002',jid='5515999888877@s.whatsapp.net';
 const incoming=bridge.recordInboundTranscript({sessionId:'consecom-principal',jid,unique:pid,content:'Olá, como funciona?'});
 assert.equal(incoming.body.processed,true);
 assert.equal(db.one('SELECT provider_id FROM groq_auto_events WHERE provider_id=?',pid),null);
});
test.after(()=>{
 for(const [k,v] of Object.entries(original)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{force:true,recursive:true});
});
