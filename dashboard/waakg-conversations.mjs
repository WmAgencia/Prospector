// Remote WA-AKG chat synchronization and manual replies.
import {waRequest,selectedWaSession,waControlStatus} from "./waakg-control.mjs";
import {db,one,run,now,phone,addLead,getThread,addMessage,audit} from "./db.mjs";
db.exec("CREATE TABLE IF NOT EXISTS waakg_remote_outbox(id TEXT PRIMARY KEY,jid TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL)");
const jidAllowed=j=>/^\d{10,15}@s\.whatsapp\.net$/.test(j);
function currentId(){const s=selectedWaSession();if(!s)throw Error("Conecte seu WhatsApp em Conexões");return encodeURIComponent(s);}
export async function remoteChats(){
 const s=await waControlStatus();
 if(!s.connected)return {connected:false,items:[]};
 const result=await waRequest("/api/chat/"+currentId());
 const items=(Array.isArray(result.data)?result.data:[]).slice(0,80).map(x=>({
  id:"wa:"+String(x.jid||""),jid:String(x.jid||""),name:String(x.name||x.notify||x.jid||"Contato").slice(0,80),business:String(x.name||x.notify||x.jid||"Contato").slice(0,80),
  phone:String(x.jid||"").split("@")[0],last_message_at:x.lastMessage?.timestamp||null,preview:String(x.lastMessage?.content||"").slice(0,180)
 })).filter(x=>/^[0-9]{10,15}@(s\.whatsapp\.net|lid|g\.us)$/.test(x.jid));
 return {connected:true,items};
}
export async function remoteMessages(jid){
 const s=await waControlStatus();if(!s.connected)throw Error("WhatsApp não conectado");
 if(!/^[0-9]{10,15}@(s\.whatsapp\.net|lid|g\.us)$/.test(jid))throw Error("Conversa inválida");
 const result=await waRequest("/api/chat/"+currentId()+"/"+encodeURIComponent(jid));
 const arr=Array.isArray(result.data)?result.data:[];
 return arr.slice(-100).map(x=>({id:x.id||x.keyId,direction:x.fromMe?"out":"in",body:typeof x.content==="string"?x.content:String(x.caption||"["+String(x.type||"Mídia")+"]"),at:x.timestamp||x.createdAt||null}));
}
export async function sendRemoteReply(input={}){
 const jid=String(input.jid||""),text=String(input.text||"").trim(),requestId=String(input.requestId||"");
 if(!jidAllowed(jid)||!text||text.length>1500||!/^[a-f0-9-]{36}$/i.test(requestId))return {status:400,body:{error:"Mensagem ou destinatário inválido"}};
 if(one("SELECT id FROM waakg_remote_outbox WHERE id=?",requestId))return {status:409,body:{error:"Mensagem já processada; confira a conversa antes de reenviar"}};
 const normalized=phone(jid.split("@")[0]);
 if(!normalized||one("SELECT phone FROM suppressions WHERE phone=?",normalized))return {status:403,body:{error:"Contato bloqueado ou sem número válido"}};
 const remote=await remoteMessages(jid);
 if(!remote.some(m=>m.direction==="in"))return {status:403,body:{error:"Envio permitido apenas como resposta a conversa iniciada pelo contato"}};
 const recent=remote.filter(m=>m.direction==="in").slice(-1)[0]?.body||"";
 if(/^\s*(parar|pare|stop|remover|não me contate|nao me contate)\b/i.test(recent))return {status:403,body:{error:"O contato solicitou não receber mensagens"}};
 run("INSERT INTO waakg_remote_outbox(id,jid,state,created_at) VALUES(?,?,?,?)",requestId,jid,"UNKNOWN",now());
 try{
  const result=await waRequest("/api/messages/"+currentId()+"/"+encodeURIComponent(jid)+"/send",{method:"POST",data:{message:{text}}});
  if(result.status!==true)return {status:502,body:{error:"WA-AKG não confirmou o envio",delivery:"UNKNOWN"}};
  run("UPDATE waakg_remote_outbox SET state='SENT' WHERE id=?",requestId);
  const lead=addLead({business:"Contato WhatsApp "+normalized.slice(-4),phone:normalized,source:"WHATSAPP_INBOUND",contact_permission:false}).lead;
  const thread=getThread(lead.id,jid);
  addMessage({threadId:thread.id,providerId:"remote-operator:"+requestId,direction:"out",body:text,status:"sent"});
  audit("WA_AKG_OPERATOR_REPLY",lead.id,{manual:true});
  return {status:200,body:{ok:true,delivery:"ACCEPTED"}};
 }catch{return {status:502,body:{error:"Envio incerto; confira o WhatsApp antes de tentar novamente",delivery:"UNKNOWN"}};}
}
