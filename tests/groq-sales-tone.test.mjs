import test from 'node:test';
import assert from 'node:assert/strict';
import {salesTonePrompt,SALES_TONE_VERSION,SALES_FEW_SHOTS} from '../dashboard/sales-tone-playbook.mjs';
import {aiDraft,aiStatus} from '../dashboard/ai-groq.mjs';

test('Sales playbook is anonymized and covers consultative commercial behavior',()=>{
 const txt=salesTonePrompt();
 assert.match(txt,/Maravilha/);
 assert.match(txt,/portfólio verificado/);
 assert.match(txt,/não improvise/);
 assert.match(txt,/sem parecer robô/);
 assert.match(txt,/nunca publique detalhes privados/);
 assert.equal(SALES_FEW_SHOTS.length,8);
 assert.match(SALES_TONE_VERSION,/consecom-sales-/);
});

test('Groq draft receives the playbook and treats customer context as data, not system instructions',async()=>{
 const oldFetch=globalThis.fetch,oldKey=process.env.GROQ_API_KEY,oldBase=process.env.GROQ_API_BASE_URL;
 process.env.GROQ_API_KEY='mock-test-api-key';
 delete process.env.GROQ_API_BASE_URL;
 let called=0,payload;
 globalThis.fetch=async(url,opts)=>{
  called++;
  assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
  payload=JSON.parse(opts.body);
  return Response.json({choices:[{message:{content:'Claro! Posso te explicar rapidinho como funciona?'}}]});
 };
 try{
  const result=await aiDraft({text:'Pode me explicar o serviço?',context:'Cliente: Quero entender.\nConsecom: Claro.'});
  assert.equal(result.ok,true);
  assert.equal(result.autoSend,false);
  assert.equal(result.requiresApproval,true);
  assert.equal(result.toneVersion,SALES_TONE_VERSION);
  assert.equal(called,1);
  assert.match(payload.messages[0].content,/PERSONALIDADE COMERCIAL/);
  assert.match(payload.messages[0].content,/não crie números de vendas/i);
  assert.match(payload.messages.at(-1).content,/Pode me explicar o serviço/);
  assert.equal(payload.messages.find(x=>x.content.startsWith('HISTÓRICO\/CONTEXTO')).role,'user');
  assert.equal(aiStatus().integration,'draft_only');
 }finally{
  globalThis.fetch=oldFetch;
  if(oldKey===undefined)delete process.env.GROQ_API_KEY;else process.env.GROQ_API_KEY=oldKey;
  if(oldBase===undefined)delete process.env.GROQ_API_BASE_URL;else process.env.GROQ_API_BASE_URL=oldBase;
 }
});

test('Groq draft rejects missing API key rather than inventing a response',async()=>{
 const oldKey=process.env.GROQ_API_KEY;
 delete process.env.GROQ_API_KEY;
 try{
  const result=await aiDraft({text:'Qual o preço?'});
  assert.equal(result.ok,false);
  assert.equal(result.code,'NOT_CONFIGURED');
 }finally{if(oldKey!==undefined)process.env.GROQ_API_KEY=oldKey;}
});
