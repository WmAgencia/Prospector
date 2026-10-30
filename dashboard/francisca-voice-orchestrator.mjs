// Bounded and read-only multistep diagnostics. Never executes an LLM's
// arbitrary tool list as write permissions; these calls are fixed server-side.
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const PLANS=[
 {pattern:/\b(?:relatorio geral|diagnostico completo|auditoria operacional|visao geral do sistema|status completo)\b/,names:['system_status','system_diagnostics','read_outreach_queue']},
 {pattern:/\b(?:funil de leads|resumo de prospectos|analise dos leads|analise de prospeccao)\b/,names:['system_status','list_prospects','read_outreach_queue']},
 {pattern:/\b(?:status do whatsapp|diagnostico do whatsapp|problema no whatsapp)\b/,names:['system_status','system_diagnostics']},
];
export function chooseVoiceWorkflow(text,available=[]){
 const plan=PLANS.find(p=>p.pattern.test(norm(text)));
 if(!plan)return [];
 const allowed=new Set(available.map(t=>t.function?.name));
 return plan.names.filter(name=>allowed.has(name)).slice(0,3);
}
export async function runVoiceReadWorkflow(names,{actor,execute,timeoutMs=6500}={}){
 if(!Array.isArray(names)||names.length>3)throw Error('VOICE_WORKFLOW_LIMIT');
 const allow=new Set(['system_status','system_diagnostics','read_outreach_queue','list_prospects']);
 const steps=[];
 for(const name of names){
  if(!allow.has(name))throw Error('VOICE_WORKFLOW_WRITE_FORBIDDEN');
  try{
   const result=await Promise.race([
    execute(name,{},actor),
    new Promise((_,reject)=>setTimeout(()=>reject(Error('TOOL_TIMEOUT')),timeoutMs))
   ]);
   // Never pass whole customer conversations or huge datasets into the prompt.
   const preview=JSON.stringify(result);
   steps.push({name,ok:true,preview:preview.slice(0,1100),truncated:preview.length>1100});
  }catch(e){steps.push({name,ok:false,code:String(e.message||e).slice(0,45)});}
 }
 return {steps,complete:steps.length===names.length&&steps.every(x=>x.ok)};
}
