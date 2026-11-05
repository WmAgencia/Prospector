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
 assert.equal(SALES_FEW_SHOTS.length,12);
 assert.match(txt,/JEITO DE FALAR/);
 assert.match(txt,/não siga links/);
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

test('model-specific quota uses exactly one active compatible fallback without sending messages',async()=>{
 const original=globalThis.fetch,oldKey=process.env.GROQ_API_KEY,oldModel=process.env.GROQ_MODEL,oldBase=process.env.GROQ_API_BASE_URL;
 process.env.GROQ_API_KEY='mock';process.env.GROQ_MODEL='openai/gpt-oss-120b';delete process.env.GROQ_API_BASE_URL;
 const models=[];
 globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/models'))return Response.json({data:[{id:'llama-3.3-70b-versatile',active:true},{id:'unavailable-model',active:false}]});
  const payload=JSON.parse(options.body);models.push(payload.model);
  if(models.length===1)return Response.json({error:{message:'rate limit'}},{status:429});
  assert.equal(payload.reasoning_effort,undefined);
  return Response.json({choices:[{message:{content:'Pode mandar as fotos reais por aqui. A equipe usa na prévia de vocês.'}}]});
 };
 try{
  const result=await aiDraft({text:'Que material precisa?'});
  assert.equal(result.ok,true);assert.equal(result.model,'llama-3.3-70b-versatile');
  assert.equal(result.autoSend,false);
  assert.deepEqual(models,['openai/gpt-oss-120b','llama-3.3-70b-versatile']);
 }finally{
  globalThis.fetch=original;
  for(const [key,value] of Object.entries({GROQ_API_KEY:oldKey,GROQ_MODEL:oldModel,GROQ_API_BASE_URL:oldBase}))if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
