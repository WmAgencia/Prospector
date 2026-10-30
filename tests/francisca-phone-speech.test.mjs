import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/francisca-phone-stt-');
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.PROSPECTOR_OWNER_PHONE='5515981817336';
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.WA_AKG_CALL_LAB_ENABLED='true';
process.env.PROSPECTOR_LIVE_TEST_ENABLED='false';
const owner={jid:'5515981817336@s.whatsapp.net',sessionId:'consecom-principal'};
const {parseSpokenBrazilPhone,readBackPhoneDigits}=await import('../dashboard/francisca-phone-speech.mjs');
const {newVoiceDirectMessageFlow,interpretVoiceSend}=await import('../dashboard/francisca-owner-voice-messages.mjs');
const {newFranciscaCallSession}=await import('../dashboard/francisca-call-lab.mjs');

test('Faithfully parses the exact ten-digit grouped number supplied by owner without adding digits',()=>{
 for(const text of [
  '15 98 114 25 7',
  '15, 98, 114, 25, 7',
  'quinze, noventa e oito, cento e quatorze, vinte e cinco, sete',
  '15 noventa e oito cento e quatorze vinte e cinco sete',
  'Envie uma mensagem para o número 15, 98, 114, 25, 7 dizendo olá'
 ]){
  const parsed=parseSpokenBrazilPhone(text);
  assert.equal(parsed.digits,'551598114257',text);
  assert.equal(parsed.invalid,true,text);
  assert.equal(parsed.likelyTruncated,true,text);
 }
});
test('Valid phone spoken as grouped hundreds, tens, singles, or raw digits resolves identically',()=>{
 const cases=[
  '15 99999 2244',
  '15, 99999, 2244',
  'quinze, noventa e nove, noventa e nove, nove, dois, dois, quatro, quatro',
  'um cinco nove nove nove nove nove dois dois quatro quatro',
  'Manda uma mensagem para o número 15 99999 2244 falando que olá, tudo bem?'
 ];
 for(const raw of cases){
  const p=parseSpokenBrazilPhone(raw);
  assert.equal(p.number,'5515999992244',raw);
  assert.equal(p.invalid,false,raw);
 }
});
test('Dictated number is read back digit-by-digit without hidden digit completion',()=>{
 const spoken=readBackPhoneDigits('5515999992244');
 assert.match(spoken,/DDD um, cinco/);
 assert.match(spoken,/número nove, nove, nove, nove, nove, dois, dois, quatro, quatro/);
});
test('Phone number inside message command is removed without damaging the intended text',()=>{
 const req=interpretVoiceSend('Envie uma mensagem para o número quinze, noventa e nove, noventa e nove, nove, dois, dois, quatro, quatro falando que Olá, tudo bem?');
 assert.equal(req.phone,'5515999992244');
 assert.equal(req.text,'Olá, tudo bem?');
});
test('Truncated mobile spoken in grouped numerals cannot prepare or send',async()=>{
 let sends=0;const flow=newVoiceDirectMessageFlow({send:async()=>{sends++;return true;}});
 const first=await flow.turn('Envia mensagem para o número quinze, noventa e oito, cento e quatorze, vinte e cinco, sete',owner);
 assert.match(first,/incompleto|DDD/);
 assert.equal(flow.state.stage,'phone');
 const second=await flow.turn('quinze noventa e oito cento e quatorze vinte e cinco sete',owner);
 assert.match(second,/faltar um dígito/);
 assert.equal(sends,0);
 flow.end();
});
test('Model disagreement on phone digits stops the action before any send',async()=>{
 let sends=0;
 const session=newFranciscaCallSession(owner,{
  transcribe:async()=>({text:'Manda mensagem para o número 15 99999 2244 falando olá'}),
  verifyPhoneTranscription:async()=>({text:'Manda mensagem para o número 15 99999 2245 falando olá'}),
  sendDirectMessage:async()=>{sends++;return true;},
  chat:async()=>{throw Error('NO_GROQ_FOR_RECIPIENT');},
  synthesize:async()=>({bytes:Buffer.alloc(512),voice:'test'}),
  convert:async()=>Buffer.alloc(640)
 });
 try{
  const response=await session.reply(Buffer.alloc(32000));
  assert.match(response.spoken,/duas transcrições não concordaram/);
  assert.equal(sends,0);
 }finally{session.end();}
});
test('Matching double transcription still requires a separate spoken send approval',async()=>{
 let sends=0;const calls=['Envia mensagem para o número 15 99999 2244 falando que olá','pode enviar'];
 const session=newFranciscaCallSession(owner,{
  transcribe:async()=>({text:calls.shift()}),
  verifyPhoneTranscription:async()=>({text:'Envia mensagem para o número quinze, noventa e nove, noventa e nove, nove, dois, dois, quatro, quatro falando que olá'}),
  sendDirectMessage:async()=>{sends++;return {state:'DELIVERED'};},
  chat:async()=>{throw Error('NO_GROQ_FOR_RECIPIENT');},
  synthesize:async()=>({bytes:Buffer.alloc(512),voice:'test'}),
  convert:async()=>Buffer.alloc(640)
 });
 try{
  const first=await session.reply(Buffer.alloc(32000));
  assert.match(first.spoken,/Confirma o telefone/);
  assert.match(first.spoken,/Posso enviar/);
  assert.equal(sends,0);
  const second=await session.reply(Buffer.alloc(32000));
  assert.match(second.spoken,/confirmou a entrega/);
  assert.equal(sends,1);
 }finally{session.end();}
});
test.after(async()=>{
 const {db}=await import('../dashboard/db.mjs');db.close();
 fs.rmSync(dir,{recursive:true,force:true});
});
