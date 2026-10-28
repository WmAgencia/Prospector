import {db,one,all,run,id,now,audit} from './db.mjs';
import {groqChat,groqCatalog} from './groq-models.mjs';
import {agentTools,runAgentTool,claimApproval,markApproval} from './groq-owner-tools.mjs';
import {selectedWaSession,waRequest} from './waakg-control.mjs';
db.exec("CREATE TABLE IF NOT EXISTS groq_owner_history(id TEXT PRIMARY KEY,event_id TEXT UNIQUE NOT NULL,role TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL)");
let running=false;
function owner(){return String(process.env.GROQ_OWNER_WHATSAPP||'').replace(/\D/g,'');}
export function ownerStatus(){return {provider:'GroqCloud',active:!!process.env.GROQ_API_KEY&&owner().length>=12,ownerConfigured:owner().length>=12,ownerSuffix:owner().slice(-4),autoReplyOnlyOwner:true,allowsBulk:false};}
export async function ownerModels(){return groqCatalog();}
async function send(session,jid,text){
 const r=await waRequest('/api/messages/'+encodeURIComponent(session)+'/'+encodeURIComponent(jid)+'/send',{method:'POST',data:{message:{text:String(text).slice(0,2600)}}});
 return r.status===true;
}
async function respondToOwner(e){
 const {sessionId,jid,text,providerId}=e;
 if(running)return;
 running=true;
 try{
  const confirmation=String(text||'').trim().match(/^CONFIRMAR\s+(\d{6})$/i);
  if(confirmation){
   const pending=claimApproval(confirmation[1]);
   const message=pending?await send(sessionId,pending.jid,pending.body)?'Mensagem aceita pelo WhatsApp; confira a conversa.':'Envio não confirmado. Confira o WhatsApp antes de repetir.':'Código inválido, expirado ou destinatário não autorizado.';
   if(pending&&message.startsWith('Mensagem aceita'))markApproval(confirmation[1]);
   await send(sessionId,jid,message);return;
  }
  const history=all("SELECT role,body FROM groq_owner_history ORDER BY created_at DESC LIMIT 12").reverse().map(r=>({role:r.role,content:r.body}));
  const prompt='Você é um assistente pessoal no WhatsApp, powered by GroqCloud, para o proprietário do Prospector/Consecom. Responda em português brasileiro a perguntas gerais e comerciais. Para informações e alterações no Prospector, use ferramentas e reporte somente resultados confirmados. Nunca invente dados de clientes. Nunca inicie disparos em massa ou converse com terceiros sem solicitação e confirmação. Ferramentas são limitadas por segurança; explique quando algo não for permitido.';
  const messages=[{role:'system',content:prompt},...history,{role:'user',content:String(text).slice(0,3500)}];
  const hasAction=/\b(altere|modifique|edite|paus|atualiz|envie|mande|cadastre|status|leads|prospect|empresa|sistema|conversa)\b/i.test(text);
  let response=await groqChat({task:hasAction?'actions':'conversation',messages,tools:agentTools,maxTokens:800});
  for(let i=0;i<3&&response.choice?.tool_calls?.length;i++){
   const calls=response.choice.tool_calls.slice(0,3);
   messages.push(response.choice);
   for(const call of calls){
    let result;try{result=await runAgentTool(call.function?.name,JSON.parse(call.function?.arguments||'{}'));}
    catch(err){result={error:String(err.message).slice(0,220)};}
    messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result).slice(0,9000)});
   }
   response=await groqChat({task:'actions',messages,tools:agentTools,maxTokens:900});
  }
  const reply=String(response.choice?.content||'Não consegui concluir agora.').trim().slice(0,2500);
  if(!reply)return;
  const confirmed=await send(sessionId,jid,reply);
  if(confirmed){
   run('INSERT INTO groq_owner_history VALUES(?,?,?,?,?)',id(),'u:'+providerId,'user',String(text).slice(0,3500),now());
   run('INSERT INTO groq_owner_history VALUES(?,?,?,?,?)',id(),'a:'+providerId,'assistant',reply,now());
   audit('GROQ_OWNER_REPLY',null,{provider:'groq',model:response.model});
  }
 }catch(err){console.warn('[groq-owner]',err?.message?.slice(0,120)||'REQUEST_FAILED');}
 finally{running=false;}
}
export function ownerReceived({jid,sessionId,text,providerId}={}){
 if(!ownerStatus().active||sessionId!==selectedWaSession()||jid!==owner()+'@s.whatsapp.net'||typeof text!=='string'||!text.trim()||!providerId)return false;
 if(one('SELECT id FROM groq_owner_history WHERE event_id=?','u:'+providerId))return false;
 setImmediate(()=>respondToOwner({jid,sessionId,text,providerId}));
 return true;
}
