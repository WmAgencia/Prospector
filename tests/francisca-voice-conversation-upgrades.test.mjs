import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/francisca-conversation-');
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.PROSPECTOR_OWNER_PHONE='5515981817336';
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.WA_AKG_CALL_LAB_ENABLED='true';
process.env.PROSPECTOR_LIVE_TEST_ENABLED='false';
const owner={jid:'5515981817336@s.whatsapp.net',sessionId:'consecom-principal'};
const stranger={jid:'5515999990000@s.whatsapp.net',sessionId:'consecom-principal'};
const {newVoiceListeningFlow}=await import('../dashboard/francisca-voice-listening.mjs');
const {interpretVoicePreferences,voicePrefsForOwner,applyVoicePreferences,voiceRateForPreferences}=await import('../dashboard/francisca-voice-preferences.mjs');
const {newFranciscaCallSession}=await import('../dashboard/francisca-call-lab.mjs');
const {voiceReplyPlan}=await import('../dashboard/francisca-dialogue-style.mjs');
const pcm=Buffer.alloc(32000);
const synthesizePcm=async()=>({pcm16k:Buffer.alloc(640),voice:'test'});

test('Owner can ask to think aloud and release a unified multi-turn question',()=>{
 const l=newVoiceListeningFlow();
 assert.equal(l.turn('espera, deixa eu terminar').handled,true);
 assert.equal(l.state.active,true);
 assert.match(l.turn('Quero analisar os relatórios do Prospector').spoken,/continuar/i);
 assert.match(l.turn('e entender quais leads precisam de uma resposta').spoken,/ouvindo/i);
 const result=l.turn('pode responder');
 assert.equal(result.handled,true);
 assert.match(result.answerText,/relatórios do Prospector e entender quais leads/);
 assert.equal(l.state.active,false);
});
test('Waiting mode can be cancelled or expired without triggering an action',()=>{
 const l=newVoiceListeningFlow({maxChars:40,expiresMs:20000});
 l.turn('não responde ainda');
 l.turn('Anote o que eu disser');
 assert.match(l.turn('Uma frase muito grande que ultrapassa o limite de quarenta caracteres').spoken,/anotei bastante coisa/i);
 assert.equal(l.state.parts,1);
 assert.match(l.turn('cancela').spoken,/deixei esse assunto de lado/);
 assert.equal(l.state.active,false);
 assert.equal(l.turn('pode responder').handled,false);
});
test('Speech rate and answer preference commands persist for verified owner only',()=>{
 assert.equal(interpretVoicePreferences('fala mais devagar').speed,'slow');
 assert.equal(interpretVoicePreferences('fala mais rápido').speed,'fast');
 assert.equal(interpretVoicePreferences('responde mais detalhado').detail,'detailed');
 assert.equal(interpretVoicePreferences('fala mais curto').detail,'brief');
 assert.equal(applyVoicePreferences('fala mais devagar',stranger),null);
 assert.equal(voicePrefsForOwner(owner).speed,'normal');
 assert.match(applyVoicePreferences('fala mais devagar',owner).spoken,/devagar/);
 assert.equal(voicePrefsForOwner(owner).speed,'slow');
 assert.equal(voiceRateForPreferences(voicePrefsForOwner(owner)),'-13%');
 applyVoicePreferences('responde mais detalhado',owner);
 assert.equal(voiceReplyPlan('me diz',[],voicePrefsForOwner(owner)).detailed,true);
 applyVoicePreferences('fala mais curto',owner);
 assert.equal(voiceReplyPlan('me diz',[],voicePrefsForOwner(owner)).maxChars,260);
 assert.equal(voicePrefsForOwner(stranger).speed,'normal');
 applyVoicePreferences('volta ao normal',owner);
 assert.deepEqual(voicePrefsForOwner(owner),{speed:'normal',detail:'auto'});
});
test('Francisca waits across multiple STT turns before consulting Groq, then uses only read tools',async()=>{
 const phrases=['espera, deixa eu terminar','Preciso de um relatório sobre todos os leads','e ver os clientes que responderam','pode responder'];
 let calls=0,toolNames=[],texts=[];
 const c=newFranciscaCallSession(owner,{
  transcribe:async()=>({text:phrases.shift()}),
  chat:async({messages,tools})=>{
   calls++;toolNames=tools.map(t=>t.function.name);texts=messages.filter(m=>m.role==='user').map(m=>m.content);
   return {choice:{content:'Encontrei alguns dados, vou resumir.'}};
  },
  synthesizePcm
 });
 try{
  assert.match((await c.reply(pcm)).spoken,/Estou ouvindo/);
  assert.match((await c.reply(pcm)).spoken,/continuar/i);
  assert.match((await c.reply(pcm)).spoken,/ouvindo/i);
  assert.equal(calls,0);
  const done=await c.reply(pcm);
  assert.match(done.spoken,/Encontrei alguns dados/);
  assert.equal(calls,1);
  assert(texts.some(t=>/relatório sobre todos os leads e ver os clientes que responderam/.test(t)));
  assert(toolNames.every(t=>!/^(?:request_|cancel_|create_)/.test(t)));
 }finally{c.end();}
});
test('Slow speech command changes the actual next TTS generation rate',async()=>{
 const heard=['fala mais devagar','Bom dia, me explica sobre os leads'];
 const rates=[];
 const c=newFranciscaCallSession(owner,{
  transcribe:async()=>({text:heard.shift()}),
  chat:async()=>({choice:{content:'Os leads estão cadastrados no sistema.'}}),
  synthesizePcm:async(_,options)=>{rates.push(options.rate);return {pcm16k:Buffer.alloc(640),voice:'test'};}
 });
 try{
  assert.match((await c.reply(pcm)).spoken,/devagar/);
  assert.match((await c.reply(pcm)).spoken,/leads/);
  assert.deepEqual(rates,['-13%','-13%']);
 }finally{c.end();}
});
test('Repeating an answer is read only: never calls LLM or a side-effect tool again',async()=>{
 const heard=['Conta alguma coisa sobre o sistema','repete a última resposta'];
 let calls=0,sends=0;
 const c=newFranciscaCallSession(owner,{
  transcribe:async()=>({text:heard.shift()}),
  chat:async()=>{calls++;return {choice:{content:'Os relatórios estão disponíveis no painel.'}};},
  sendDirectMessage:async()=>{sends++;throw Error('NO_SEND');},
  synthesizePcm
 });
 try{
  const first=await c.reply(pcm);
  const second=await c.reply(pcm);
  assert.equal(second.spoken,first.spoken);
  assert.equal(calls,1);
  assert.equal(sends,0);
 }finally{c.end();}
});
test.after(async()=>{const {db}=await import('../dashboard/db.mjs');db.close();fs.rmSync(dir,{recursive:true,force:true});});
