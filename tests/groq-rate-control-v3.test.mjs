import test from 'node:test';
import assert from 'node:assert/strict';
process.env.GROQ_API_KEY='mock-key-never-sent';
delete process.env.GROQ_MODEL;
const {groqChat,groqHealth}=await import('../dashboard/groq-models.mjs');
const catalogOverride={ids:['openai/gpt-oss-120b','openai/gpt-oss-20b']};
const messages=[{role:'user',content:'oi'}];
const success=(text='Oi, tudo certo?')=>({ok:true,json:async()=>({choices:[{message:{role:'assistant',content:text}}],usage:{completion_tokens:14}})});
test('successful call uses one model and does not leak message content into health',async()=>{
 const calls=[];
 const out=await groqChat({task:'conversation',messages,catalogOverride,
  fetchFn:async(url,opts)=>{calls.push(JSON.parse(opts.body).model);return success();}});
 assert.equal(calls.length,1);
 assert.equal(out.model,'openai/gpt-oss-120b');
 assert.equal(groqHealth().completed>=1,true);
 assert.equal(JSON.stringify(groqHealth()).includes('oi'),false);
});
test('400 model compatibility may retry one alternate but never more than two',async()=>{
 const calls=[];
 const out=await groqChat({task:'conversation',messages,catalogOverride,
  fetchFn:async(url,opts)=>{calls.push(JSON.parse(opts.body).model);return calls.length===1?{ok:false,status:400}:success('Entendi, vou explicar de outro jeito.');}});
 assert.equal(calls.length,2);
 assert.equal(out.model,'openai/gpt-oss-20b');
 assert.equal(groqHealth().inFlight,0);
});
test('process-local concurrency limit rejects surplus without starting a provider request',async()=>{
 process.env.GROQ_MAX_IN_FLIGHT='1';
 let release;const gate=new Promise(resolve=>{release=resolve;});
 let started;
 const first=groqChat({task:'conversation',messages,catalogOverride,
  fetchFn:async()=>{started=true;await gate;return success();}});
 // The first asynchronous call reaches the network stub before this next turn.
 await Promise.resolve();await Promise.resolve();
 await assert.rejects(()=>groqChat({task:'conversation',messages,catalogOverride,fetchFn:async()=>{throw Error('should never run');}}),/GROQ_BUSY/);
 assert.equal(started,true);
 release();
 await first;
 assert.equal(groqHealth().inFlight,0);
 delete process.env.GROQ_MAX_IN_FLIGHT;
});
test('a 429 stops all model fallback, applies cooldown and prevents a new burst',async()=>{
 let calls=0;
 const request=()=>groqChat({task:'conversation',messages,catalogOverride,
  fetchFn:async()=>{calls++;return {ok:false,status:429,headers:{get:(k)=>k==='retry-after'?'30':null}};}});
 await assert.rejects(request,/GROQ_RATE_LIMITED/);
 assert.equal(calls,1);
 assert.ok(groqHealth().cooldownSeconds>=20);
 assert.ok(groqHealth().rateLimited>=1);
 await assert.rejects(request,/GROQ_RATE_LIMITED/);
 assert.equal(calls,1);
 assert.equal(groqHealth().inFlight,0);
});
