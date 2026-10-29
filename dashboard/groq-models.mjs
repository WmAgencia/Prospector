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
 const payload={model,messages,temperature:task==='actions'?0.15:0.45,max_completion_tokens:maxTokens};
 if(task==='voice'&&model.startsWith('openai/gpt-oss-'))payload.reasoning_effort='low';
 if(Array.isArray(tools)&&tools.length){payload.tools=tools;payload.tool_choice='auto';payload.parallel_tool_calls=false;}
 const response=await fetch(BASE+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+process.env.GROQ_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw Error('GROQ_HTTP_'+response.status);
 const json=await response.json();
 return {model,choice:json.choices?.[0]?.message||null,usage:json.usage||null};
}
export async function groqCatalog(){
 const result=await availableGroqModels();
 return {provider:'GroqCloud',configured:groqConfigured(),models:result.ids,selection:Object.fromEntries(Object.keys(tasks).map(k=>[k,tasks[k].find(m=>result.ids.includes(m))||null])),lastError:result.error,automaticFallback:true};
}
