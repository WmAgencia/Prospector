// Optional OpenCode Console inference. OFF until a fresh, private key and explicit
// data-processing/cost approvals have been configured by the operator.
// Free-tier models are intentionally excluded: API access from a SaaS is HTTP 403.
const ENDPOINT='https://opencode.ai/inference/openai/v1/chat/completions';
const PAID_MODELS=new Set([
 'glm-5.3-flash','deepseek-v4.1-flash','mistral-large-4',
 'minimax-m3','minimax-m2.7','minimax-m2.5','glm-5.3','deepseek-v4-pro'
]);
const codeFor=status=>status===401?'UNAUTHORIZED':status===403?'ACCESS_DENIED':status===429?'RATE_LIMITED':status>=500?'UPSTREAM_UNAVAILABLE':'PROVIDER_ERROR';
export function opencodeStatus(){
 const model=String(process.env.OPENCODE_MODEL||'glm-5.3-flash');
 const keyConfigured=Boolean(process.env.OPENCODE_API_KEY);
 const operatorEnabled=process.env.OPENCODE_FALLBACK_ENABLED==='true';
 const dataApproved=process.env.OPENCODE_CUSTOMER_DATA_APPROVED==='true';
 const paidModel=PAID_MODELS.has(model);
 return {
  provider:'OpenCode Console',configured:keyConfigured,
  enabled:keyConfigured&&operatorEnabled&&dataApproved&&paidModel,
  operatorEnabled,dataApproved,paidModel,model,
  policy:'PAID_API_ONLY; EXPLICIT_OPT_IN; NO_FREE_MODELS',
  models:[...PAID_MODELS]
 };
}
export function opencodeAllowed(){
 return opencodeStatus().enabled;
}
export async function opencodeChat({task='conversation',messages,maxTokens=600,request=fetch}={}){
 if(!opencodeAllowed())return {ok:false,code:'OPENCODE_DISABLED'};
 if(!['conversation','quick','summarization'].includes(task))return {ok:false,code:'TASK_NOT_APPROVED'};
 if(!Array.isArray(messages)||!messages.length||messages.length>30||
  !messages.every(x=>x&&['system','user','assistant'].includes(x.role)&&typeof x.content==='string'&&
    x.content.length<=12000&&!x.tool_calls))return {ok:false,code:'INVALID_MESSAGES'};
 const model=opencodeStatus().model;
 const maxOutput=Math.min(1200,Math.max(100,Number(maxTokens)||600));
 const payload={model,messages:messages.map(({role,content})=>({role,content})),
  max_tokens:maxOutput,temperature:0.25,stream:false};
 try{
  const response=await request(ENDPOINT,{
   method:'POST',headers:{Authorization:'Bearer '+process.env.OPENCODE_API_KEY,'Content-Type':'application/json'},
   body:JSON.stringify(payload),signal:AbortSignal.timeout(16000)
  });
  if(!response.ok)return {ok:false,code:codeFor(response.status),httpStatus:response.status};
  const data=await response.json();
  const choice=data?.choices?.[0]?.message;
  if(!choice||typeof choice.content!=='string'||!choice.content.trim())return {ok:false,code:'EMPTY_RESPONSE'};
  return {ok:true,provider:'opencode',model,choice:{role:'assistant',content:choice.content.slice(0,6000)},
   // Cost is reported by OpenCode for paid API calls; do not log prompts or output.
   usage:data.usage||null,costUsd:Number.isFinite(Number(data?.usage?.cost))?Number(data.usage.cost):null};
 }catch(error){
  return {ok:false,code:error?.name==='TimeoutError'||error?.name==='AbortError'?'TIMEOUT':'NETWORK_ERROR'};
 }
}
