import test from 'node:test';
import assert from 'node:assert/strict';
import {groqChat} from '../dashboard/groq-models.mjs';

test('Groq HTTP 400 voice response retries on another model without tools or secrets',async()=>{
 const before=globalThis.fetch;
 const key=process.env.GROQ_API_KEY;
 process.env.GROQ_API_KEY='unit-test-placeholder';
 let calls=[];
 try{
  globalThis.fetch=async(url,options={})=>{
   if(String(url).endsWith('/models'))
    return {ok:true,json:async()=>({data:[
     {id:'openai/gpt-oss-20b',active:true},
     {id:'llama-3.3-70b-versatile',active:true}
    ]})};
   const p=JSON.parse(options.body);calls.push(p);
   if(calls.length===1)return {ok:false,status:400};
   return {ok:true,json:async()=>({choices:[{message:{role:'assistant',content:'Ainda não consigo verificar esses dados atuais.'}}]})};
  };
  const out=await groqChat({task:'voice',messages:[
   {role:'user',content:'O que falta implementar no Prospector?'}
  ],tools:[{type:'function',function:{
   name:'system_status',description:'Read status',
   parameters:{type:'object',properties:{}}
  }}],maxTokens:150});
  assert.equal(calls.length,2);
  assert.equal(calls[0].model,'openai/gpt-oss-20b');
  assert.equal(calls[1].model,'llama-3.3-70b-versatile');
  assert.equal(calls[1].tool_choice,'none');
  assert(!('tools' in calls[1]));
  assert.equal(out.recovered,true);
  assert.match(out.choice.content,/não consigo verificar/);
 }finally{
  globalThis.fetch=before;
  if(key===undefined)delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY=key;
 }
});