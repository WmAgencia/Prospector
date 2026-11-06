// Account-aware Groq model failover. No second WhatsApp send occurs in this adapter.
// The model catalogue is refreshed regularly; deprecated IDs are not used.
const BASE='https://api.groq.com/openai/v1';
const TASKS=Object.freeze({
 conversation:['openai/gpt-oss-120b','qwen/qwen3.8-27b','openai/gpt-oss-20b'],
 voice:['openai/gpt-oss-20b','openai/gpt-oss-120b','qwen/qwen3.8-27b'],
 actions:['openai/gpt-oss-120b','qwen/qwen3.8-27b','openai/gpt-oss-20b'],
 quick:['openai/gpt-oss-20b','openai/gpt-oss-120b','qwen/qwen3.8-27b'],
 summarization:['openai/gpt-oss-20b','qwen/qwen3.8-27b','openai/gpt-oss-120b'],
 complex:['openai/gpt-oss-120b','qwen/qwen3.8-27b','openai/gpt-oss-20b'],
 transcription:['whisper-large-v3-turbo','whisper-large-v3']
});
const TIMEOUTS={voice:9500,quick:11000,summarization:13000,conversation:16000,actions:16000,complex:21000};
let cache={ids:new Set(),until:0,lastError:null};
export function groqConfigured(){return Boolean(process.env.GROQ_API_KEY);}
export async function availableGroqModels(force=false){
 if(!groqConfigured())return {ids:[],error:'NOT_CONFIGURED'};
 if(!force&&cache.until>Date.now())return {ids:[...cache.ids],error:cache.lastError};
 try{
  const response=await fetch(BASE+'/models',{headers:{Authorization:'Bearer '+process.env.GROQ_API_KEY},signal:AbortSignal.timeout(7000)});
  if(!response.ok)throw Error('HTTP_'+response.status);
  const json=await response.json();
  const ids=new Set((json.data||[]).filter(x=>x.active!==false).map(x=>x.id).filter(x=>typeof x==='string'));
  if(!ids.size)throw Error('EMPTY_MODELS');
  cache={ids,until:Date.now()+900000,lastError:null};
 }catch(e){cache.lastError=String(e.message||e).slice(0,50);cache.until=Date.now()+45000;}
 return {ids:[...cache.ids],error:cache.lastError};
}
export async function selectGroq(task='conversation'){
 const a=await availableGroqModels();
 const candidates=TASKS[task]||TASKS.conversation;
 const model=candidates.find(id=>a.ids.includes(id));
 if(!model)throw Error('GROQ_NO_COMPATIBLE_MODELS'+(a.error?'_'+a.error:''));
 return model;
}
export async function groqChat({task='conversation',messages,tools,maxTokens=700,fetchFn=fetch}={}){
 if(!groqConfigured())throw Error('GROQ_NOT_CONFIGURED');
 if(!Array.isArray(messages)||!messages.length)throw Error('GROQ_MESSAGES_REQUIRED');
 const preferred=TASKS[task]||TASKS.conversation;
 const catalog=await availableGroqModels();
 // When the /models endpoint fails transiently, try documented production
 // models anyway. Model IDs rejected by the provider are failed over safely.
 const active=catalog.ids.length?preferred.filter(x=>catalog.ids.includes(x)):preferred;
 const selected=process.env.GROQ_MODEL;
 const order=(selected&&active.includes(selected)?[selected,...active.filter(x=>x!==selected)]:active).slice(0,3);
 if(!order.length)throw Error('GROQ_NO_COMPATIBLE_MODELS');
 const timeLimit=TIMEOUTS[task]||TIMEOUTS.conversation,allowedTools=Array.isArray(tools)&&tools.length?tools:undefined;
 const attempts=[];
 for(const model of order){
  const payload={model,messages,temperature:task==='actions'?0.12:task==='voice'?0.45:0.48,
   max_completion_tokens:Math.max(100,Math.min(4500,Number(maxTokens)||700))};
  if(model.startsWith('openai/gpt-oss-'))payload.reasoning_effort='low';
  if(allowedTools){payload.tools=allowedTools;payload.tool_choice='auto';}
  let response;
  try{
   response=await fetchFn(BASE+'/chat/completions',{method:'POST',headers:{
    Authorization:'Bearer '+process.env.GROQ_API_KEY,'Content-Type':'application/json'
   },body:JSON.stringify(payload),signal:AbortSignal.timeout(timeLimit)});
   if(!response.ok){
    attempts.push({model,http:response.status});
    // Account/key errors and unsafe content rejection must never be masked by failover.
    if([401,403,422].includes(response.status))throw Error('GROQ_HTTP_'+response.status);
    // Fail over on rate limiting, missing/deprecated model, transient server errors
    // and 400 compatibility issues. We do not retry the same model.
    if([400,404,408,409,429,500,502,503,504].includes(response.status))continue;
    throw Error('GROQ_HTTP_'+response.status);
   }
   const data=await response.json();
   const choice=data.choices?.[0]?.message;
   if(!choice||(typeof choice.content!=='string'||!choice.content.trim())&&!choice.tool_calls?.length){
    attempts.push({model,error:'EMPTY'});continue;
   }
   if(attempts.length)console.info('[groq-model-recovered]',JSON.stringify({task,model,attempted:attempts.map(a=>a.model)}));
   return {model,choice,usage:data.usage||null,recovered:attempts.length>0,attempts:attempts.length+1};
  }catch(e){
   if(/^GROQ_HTTP_(401|403|422)$/.test(String(e.message)))throw e;
   attempts.push({model,error:e?.name==='TimeoutError'||e?.name==='AbortError'?'TIMEOUT':'NETWORK_OR_INVALID_JSON'});
  }
 }
 console.warn('[groq-failover-exhausted]',JSON.stringify({task,attempts:attempts.map(x=>({model:x.model,http:x.http,error:x.error}))}));
 throw Error('GROQ_ALL_MODELS_UNAVAILABLE');
}
export async function groqCatalog(){
 const catalog=await availableGroqModels();
 return {provider:'GroqCloud',configured:groqConfigured(),models:catalog.ids,
  selection:Object.fromEntries(Object.entries(TASKS).map(([task,list])=>[task,list.find(m=>catalog.ids.includes(m))||null])),
  fallback:Object.fromEntries(Object.entries(TASKS).map(([task,list])=>[task,list.filter(m=>catalog.ids.includes(m))])),
  automaticFallback:true,lastError:catalog.error};
}
