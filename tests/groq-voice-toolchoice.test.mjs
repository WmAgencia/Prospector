import test from 'node:test';
import assert from 'node:assert/strict';
const originalFetch=globalThis.fetch;
const originalKey=process.env.GROQ_API_KEY;
const {groqChat}=await import('../dashboard/groq-models.mjs');
test('Tool-free Groq voice calls omit tool_choice and can recover on alternate provider',async()=>{
 process.env.GROQ_API_KEY='test-only-credential';
 const captured=[];
 globalThis.fetch=async(url,options={})=>{
  if(String(url).endsWith('/models'))return new Response(JSON.stringify({data:[
   {id:'openai/gpt-oss-20b',active:true},
   {id:'llama-3.3-70b-versatile',active:true}
  ]}),{status:200,headers:{'content-type':'application/json'}});
  const body=JSON.parse(options.body);
  captured.push(body);
  assert.equal(Object.hasOwn(body,'tool_choice'),false);
  if(body.model==='openai/gpt-oss-20b')return new Response(JSON.stringify({error:{message:'Invalid parameter',type:'invalid_request_error',param:'tool_choice'}}),{status:400});
  return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'Consultei a situação com cautela.'}}]}),{status:200});
 };
 try{
  const response=await groqChat({task:'voice',messages:[{role:'system',content:'Você é Francisca'},{role:'user',content:'Como está?'}],tools:[],maxTokens:500});
  assert.equal(response.recovered,true);
  assert.equal(response.choice.content,'Consultei a situação com cautela.');
  assert.equal(captured.length,2);
  assert.equal(captured[1].model,'llama-3.3-70b-versatile');
 }finally{
  globalThis.fetch=originalFetch;
  if(originalKey===undefined)delete process.env.GROQ_API_KEY;else process.env.GROQ_API_KEY=originalKey;
 }
});
