import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/francisca-natural-');
process.env.PROSPECTOR_OWNER_PHONE='5515981817336';
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.PROSPECTOR_LIVE_TEST_ENABLED='false';
process.env.WA_AKG_CALL_LAB_ENABLED='true';
const {voiceReplyPlan,voiceStyleInstruction,polishVoiceReply}=await import('../dashboard/francisca-dialogue-style.mjs');
const {newFranciscaCallSession}=await import('../dashboard/francisca-call-lab.mjs');
const pcm=Buffer.alloc(32000),owner={jid:'5515981817336@s.whatsapp.net',sessionId:'consecom-principal'};

test('Short turns stay concise; detailed requests get a larger spoken answer budget',()=>{
 const a=voiceReplyPlan('Sim',[]);
 const b=voiceReplyPlan('Me explica em detalhe como funciona a automação e o que podemos melhorar nela',[]);
 assert.equal(a.detailed,false);
 assert.equal(b.detailed,true);
 assert(b.maxTokens>a.maxTokens);
 assert(b.maxChars>a.maxChars);
 const text=voiceStyleInstruction({heard:'Me explica as possibilidades',history:[{role:'assistant',content:'Claro! Vamos analisar isso.'}]});
 assert.match(text,/NÃO comece cada turno com oi/);
 assert.match(text,/NÃO comece cada turno/);
 assert.match(text,/pergunta pede explicação/);
 assert.match(text,/Aberturas usadas recentemente/);
});
test('A repeat greeting is removed from subsequent answers, preserving the information',()=>{
 const history=[{role:'user',content:'Como está?'},{role:'assistant',content:'Olá, Wesley! Está tudo certo.'}];
 assert.equal(polishVoiceReply('Olá, Wesley! Vou explicar as opções.',{history,heard:'Pode explicar?'}),'Wesley! Vou explicar as opções.');
 assert.equal(polishVoiceReply('Bom dia! Você pode ver o fluxo no painel.',{history,heard:'Onde vejo?'}),'Você pode ver o fluxo no painel.');
 assert.equal(polishVoiceReply('Olá, Francisca!',{history:[],heard:'Olá'}),'Olá, Francisca!');
 assert.equal(polishVoiceReply('Olá, senhora, tudo bem?',{history,heard:'Me sugira uma mensagem inicial'}),'Olá, senhora, tudo bem?');
});
test('Repeated formulaic opener is stripped only if previous reply uses that exact opener',()=>{
 const history=[{role:'assistant',content:'Claro! Posso te explicar.'}];
 assert.equal(polishVoiceReply('Claro, o próximo passo é verificar o teste.',{history,heard:'Qual o próximo passo?'}),'o próximo passo é verificar o teste.');
 assert.equal(polishVoiceReply('Perfeito, o teste passou.',{history,heard:'Qual foi o resultado?'}),'Perfeito, o teste passou.');
});
test('Long spoken replies are cut at a usable boundary without exceeding voice TTS input',()=>{
 const speech='Essa etapa é importante. '.repeat(30);
 const result=polishVoiceReply(speech,{heard:'Explique detalhadamente todas as etapas do processo'});
 assert(result.length<=610);
 assert(/[.!?]$/.test(result));
});
test('The real call-turn pipeline remembers context and stops repetitive greetings on later turns',async()=>{
 const heard=['Francisca, me explica como melhorar o atendimento.','E como você faria isso na prática?'];
 const prompts=[],maxTokens=[],spoken=[];
 const replies=[
  'Claro, eu começaria ouvindo a necessidade real de quem ligou e faria uma pergunta por vez.',
  'Olá! A ideia seria usar o histórico da conversa para adaptar a próxima pergunta, sem repetir a apresentação.'
 ];
 const session=newFranciscaCallSession(owner,{
  transcribe:async()=>({text:heard.shift()}),
  chat:async({messages,maxTokens:tokens})=>{
   prompts.push(messages);
   maxTokens.push(tokens);
   return {choice:{content:replies.shift()}};
  },
  synthesize:async text=>{spoken.push(text);return {bytes:Buffer.alloc(512),voice:'fake'};},
  convert:async()=>Buffer.alloc(32000)
 });
 try{
  const first=await session.reply(pcm);
  const second=await session.reply(pcm);
  assert.match(first.spoken,/ouvindo a necessidade real/);
  assert.equal(second.spoken,'A ideia seria usar o histórico da conversa para adaptar a próxima pergunta, sem repetir a apresentação.');
  assert.equal(spoken[1],second.spoken);
  assert(maxTokens[0]>175);
  assert(prompts[1].some(x=>x.role==='assistant'&&/ouvindo a necessidade/.test(x.content)));
  assert(prompts[1].some(x=>x.role==='system'&&/continuação/i.test(x.content)));
  assert(!second.spoken.startsWith('Olá'));
 }finally{session.end();}
});
test.after(async()=>{(await import('../dashboard/db.mjs')).db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
