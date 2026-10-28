// xAI Grok owner-only WhatsApp assistant. Inactive without XAI_API_KEY.
import {all,one,run,id,now,getSetting} from './db.mjs';
import {waRequest,selectedWaSession} from './waakg-control.mjs';
export function grokOwnerStatus(){
 const number=String(process.env.GROK_OWNER_WHATSAPP||'').replace(/\D/g,'');
 return {provider:'xAI Grok',configured:!!process.env.XAI_API_KEY,ownerConfigured:number.length>=12,ownerSuffix:number.slice(-4),enabled:!!process.env.XAI_API_KEY&&number.length>=12,model:process.env.XAI_MODEL||'grok-4.7'};
}
let running=false;
export function ownerReceived({jid,sessionId,text,providerId}){
 const status=grokOwnerStatus(),owner=String(process.env.GROK_OWNER_WHATSAPP||'').replace(/\D/g,'');
 if(!status.enabled||running||sessionId!==selectedWaSession()||jid!==owner+'@s.whatsapp.net'||!text||!providerId)return false;
 running=true;
 setImmediate(async()=>{
  try{
   const context={leads:one('SELECT COUNT(*) AS n FROM leads')?.n||0,paused:getSetting('paused',true)};
   const answer=await fetch('https://api.x.ai/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+process.env.XAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:status.model,input:[{role:'system',content:'Você é um assistente pessoal em português brasileiro. Converse sobre temas gerais e responda sobre o Prospector usando apenas os dados fornecidos. Não invente ações. Não envie mensagens para terceiros. Estado atual: '+JSON.stringify(context)},{role:'user',content:String(text).slice(0,2500)}],store:false,max_output_tokens:800}),signal:AbortSignal.timeout(65000)});
   if(!answer.ok)throw Error('xAI HTTP '+answer.status);
   const response=await answer.json();
   const reply=(response.output_text||(response.output||[]).flatMap(x=>x.content||[]).map(x=>x.text||'').join('')).trim().slice(0,2500);
   if(reply)await waRequest('/api/messages/'+encodeURIComponent(sessionId)+'/'+encodeURIComponent(jid)+'/send',{method:'POST',data:{message:{text:reply}}});
  }catch(e){console.warn('[grok-owner]',e?.name||'request_failed');}
  finally{running=false;}
 });
 return true;
}
