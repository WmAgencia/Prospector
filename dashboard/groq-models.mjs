// Dynamic Groq model selection: only models returned active by this account.
const BASE='https://api.groq.com/openai/v1';
const tasks={
 conversation:['openai/gpt-oss-120b','llama-3.3-70b-versatile','openai/gpt-oss-20b'],
 voice:['openai/gpt-oss-20b','llama-3.3-70b-versatile','llama-3.1-8b-instant','openai/gpt-oss-120b'],
 actions:['openai/gpt-oss-120b','openai/gpt-oss-20b','llama-3.3-70b-versatile'],
 quick:['llama-3.1-8b-instant','openai/gpt-oss-20b','openai/gpt-oss-120b'],
 summarization:['openai/gpt-oss-20b','llama-3.1-8b-instant','openai/gpt-oss-120b'],
 complex:['openai/gpt-oss-120b','openai/gpt-oss-20b'],
 transcription:['whisper-large-v3-turbo','whisper-large-v3']
};
let cache={ids:new Set(),until:0,lastError:null};
export function groqConfigured(){return Boolean(process.env.GROQ_API_KEY);}
export async function availableGroqModels(force=false){
 if(!groqConfigured())return {ids:[],error:'NOT_CONFIGURED'};
 if(!force&&cache.until>Date.now())return {ids:[...cache.ids],error:cache.lastError};
 try{
  const response=await fetch(BASE+'/models',{headers:{Authorization:'Bearer '+process.env.GROQ_API_KEY},signal:AbortSignal.timeout(9000)});
  if(!response.ok)throw Error('HTTP_'+response.status);
  const json=await response.json();
  const ids=new Set((json.data||[]).filter(x=>x.active!==false).map(x=>x.id).filter(x=>typeof x==='string'));
  if(!ids.size)throw Error('EMPTY_MODELS');
  cache={ids,until:Date.now()+1800000,lastError:null};
 }catch(e){cache.lastError=e.message;cache.until=Date.now()+60000;}
 return {ids:[...cache.ids],error:cache.lastError};
}
export async function selectGroq(task='conversation'){
 const available=await availableGroqModels();
 const profile=tasks[task]||tasks.conversation;
 const model=profile.find(id=>available.ids.includes(id));
 if(!model)throw Error('Nenhum modelo compatível ativo para '+task+(available.error?': '+available.error:''));
 return model;
}
export async function groqChat({task='conversation',messages,tools,maxTokens=700}){
 const model=await selectGroq(task);
 const payload={model,messages,temperature:task==='actions'?0.15:task==='voice'?0.57:0.45,max_completion_tokens:maxTokens};
 if(task==='voice'&&model.startsWith('openai/gpt-oss-'))payload.reasoning_effort='low';
 if(Array.isArray(tools)&&tools.length){payload.tools=tools;payload.tool_choice='auto';payload.parallel_tool_calls=false;}
 // Omit tool_choice entirely when no tools are supplied: some Groq models reject it with HTTP 400.
 const send=async(body,timeoutMs=20000)=>fetch(BASE+'/chat/completions',{
  method:'POST',headers:{Authorization:'Bearer '+process.env.GROQ_API_KEY,'Content-Type':'application/json'},
  body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)
 });
 const response=await send(payload,task==='voice'?14000:45000);
 if(!response.ok){
  if(task==='actions'&&response.status===400&&Array.isArray(payload.tools)&&payload.tools.length){
   // Retry once with an active alternative model and reduced compatibility
   // parameters. No tool execution occurs in this adapter; caller still
   // validates every suggested function against server-side authorization.
   const catalog=await availableGroqModels();
   const alt=['llama-3.3-70b-versatile','openai/gpt-oss-20b','openai/gpt-oss-120b']
    .find(id=>id!==model&&catalog.ids.includes(id));
   if(alt){
    const revised={...payload,model:alt};
    delete revised.parallel_tool_calls;
    delete revised.reasoning_effort;
    try{
     const rerun=await send(revised,25000);
     if(rerun.ok){const data=await rerun.json();return {model:alt,
      choice:data.choices?.[0]?.message||null,usage:data.usage||null,recovered:true};}
     console.warn('[groq-actions-recovery]',JSON.stringify({status:rerun.status,model:alt}));
    }catch(error){console.warn('[groq-actions-recovery]',JSON.stringify({error:error?.name||'ERROR'}));}
   }
  }
  if(task==='voice'&&response.status===400){
   // Log only provider error category/parameter, never messages or user speech.
   let errorDetail={};
   try{const e=(await response.json())?.error||{};
    errorDetail={code:String(e.code||'').slice(0,65),type:String(e.type||'').slice(0,65),param:String(e.param||'').slice(0,65)};}catch{}
   // Groq may reject malformed model-generated tool calls as HTTP 400.
   // Retry once on a different active model WITHOUT any tools, never writing data.
   // Do not log user transcripts, tool arguments or the raw provider response.
   const available=await availableGroqModels();
   const alternative=['llama-3.3-70b-versatile','llama-3.1-8b-instant','openai/gpt-oss-120b']
     .find(id=>id!==model&&available.ids.includes(id));
   console.warn('[groq-voice-recovery]',JSON.stringify({status:400,primary:model,
    alternative:alternative||'none',toolsEnabled:Boolean(payload.tools?.length),errorDetail}));
   if(alternative){
    // The recovery request MUST exclude tool-call-role messages if the
    // preceding model turn contained tool calls; otherwise a second 400 occurs.
    const safeMessages=messages.filter(m=>['system','user','assistant'].includes(m?.role)&&
     typeof m?.content==='string'&&m.content.trim()&&!m?.tool_calls).slice(-20);
    const retry={model:alternative,
     messages:[{role:'system',content:'Você está respondendo por voz. Se uma informação atual não estiver comprovada pelos dados disponíveis, diga claramente que não conseguiu verificar. Não invente status, tarefas pendentes, ações ou resultados.'},...safeMessages],
     temperature:0.2,max_completion_tokens:Math.max(500,maxTokens)};
    try{
     const recovered=await send(retry,12000);
     if(recovered.ok){const data=await recovered.json();
      return {model:alternative,choice:data.choices?.[0]?.message||null,usage:data.usage||null,recovered:true};}
     console.warn('[groq-voice-recovery]',JSON.stringify({status:recovered.status,stage:'fallback'}));
    }catch(e){console.warn('[groq-voice-recovery]',JSON.stringify({stage:'fallback',error:e?.name||'ERROR'}));}
   }
  }
  throw Error('GROQ_HTTP_'+response.status);
 }
 const json=await response.json();
 return {model,choice:json.choices?.[0]?.message||null,usage:json.usage||null};
}
export async function groqCatalog(){
 const result=await availableGroqModels();
 return {provider:'GroqCloud',configured:groqConfigured(),models:result.ids,selection:Object.fromEntries(Object.keys(tasks).map(k=>[k,tasks[k].find(m=>result.ids.includes(m))||null])),lastError:result.error,automaticFallback:true};
}
