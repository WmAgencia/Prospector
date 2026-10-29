// WA-AKG Native Flow button transport; not the official Meta Cloud API.
// Interactive formats may not display on every WhatsApp client even when accepted.
// Each send requires an authenticated operator and per-message explicit approval.
import {db,one,run,now,phone,addLead,getThread,addMessage,audit} from './db.mjs';
import {waControlStatus,selectedWaSession,waRequest} from './waakg-control.mjs';
import {remoteMessages} from './waakg-conversations.mjs';
db.exec("CREATE TABLE IF NOT EXISTS waakg_interactive_outbox(id TEXT PRIMARY KEY,jid TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
const MODES={
 introduction:{title:'Consecom Brasil',body:'Gostaria de conhecer melhor o que podemos fazer pela sua empresa?',buttons:[
  {type:'quick_reply',displayText:'Quero saber mais',id:'consecom_more'},
  {type:'quick_reply',displayText:'Ver um exemplo',id:'consecom_example'},
  {type:'quick_reply',displayText:'Falar com alguém',id:'consecom_person'}]},
 meeting:{title:'Conversar sobre o projeto',body:'Qual seria o melhor próximo passo para você?',buttons:[
  {type:'quick_reply',displayText:'Agendar conversa',id:'consecom_meeting'},
  {type:'quick_reply',displayText:'Ver um exemplo',id:'consecom_example'},
  {type:'quick_reply',displayText:'Agora não',id:'consecom_later'}]}
};
const jidValid=jid=>/^\d{10,15}@s\.whatsapp\.net$/.test(jid);
const uuidValid=id=>/^[a-f0-9-]{36}$/i.test(id);
const optOut=text=>/\b(parar|pare|stop|remover|nao me contate|não me contate|nao quero|não quero|sem interesse)\b/i.test(String(text||''));
export function interactivePreview(input={}){
 const mode=typeof input.mode==='string'?input.mode:'introduction';
 if(!Object.hasOwn(MODES,mode))throw Error('Modelo de botões inválido');
 const data=MODES[mode];
 return {ok:true,mode,title:data.title,body:data.body,buttons:data.buttons.map(x=>({...x})),
  needsApproval:true,autoSent:false,
  notice:'Botões do WA-AKG são não oficiais; entrega e visualização devem ser verificadas no WhatsApp do destinatário.'};
}
export async function sendApprovedInteractive(input={},deps={}){
 const {getStatus=waControlStatus,getMessages=remoteMessages,transmit=waRequest}=deps;
 const jid=String(input.jid||''),requestId=String(input.requestId||'');
 if(!jidValid(jid)||!uuidValid(requestId)||input.approve!==true)return {status:400,body:{error:'Destinatário, identificador ou aprovação inválidos'}};
 let template;
 try{template=interactivePreview({mode:input.mode});}catch(e){return {status:400,body:{error:e.message}};}
 if(one('SELECT id FROM waakg_interactive_outbox WHERE id=?',requestId))return {status:409,body:{error:'Este envio já foi registrado. Confira a conversa antes de repetir.'}};
 const number=phone(jid.split('@')[0]);
 if(!number||one('SELECT phone FROM suppressions WHERE phone=?',number))return {status:403,body:{error:'Contato bloqueado ou inválido'}};
 const status=await getStatus();
 if(!status.connected)return {status:503,body:{error:'WhatsApp não conectado'}};
 const session=selectedWaSession()||status.sessionId;
 if(!session)return {status:503,body:{error:'Sessão não identificada'}};
 const history=await getMessages(jid);
 if(!Array.isArray(history)||!history.some(m=>m.direction==='in'))return {status:403,body:{error:'Botões são permitidos somente em conversas iniciadas pelo contato'}};
 const lastInbound=history.filter(m=>m.direction==='in').at(-1);
 if(optOut(lastInbound?.body))return {status:403,body:{error:'O contato recusou mensagens'}};
 const at=now();
 // Lock before transport: UNKNOWN means never retry automatically after timeout.
 run('INSERT INTO waakg_interactive_outbox(id,jid,state,created_at,updated_at) VALUES(?,?,?,?,?)',requestId,jid,'UNKNOWN',at,at);
 try{
  const payload={title:template.title,body:template.body,footer:'Consecom Brasil',buttons:template.buttons};
  const response=await transmit('/api/messages/'+encodeURIComponent(session)+'/'+encodeURIComponent(jid)+'/interactive',{method:'POST',data:payload});
  if(response.status!==true)return {status:502,body:{error:'WA-AKG não confirmou o aceite dos botões; verificar no celular antes de tentar novamente',delivery:'UNKNOWN'}};
  run("UPDATE waakg_interactive_outbox SET state='ACCEPTED',updated_at=? WHERE id=?",now(),requestId);
  const lead=addLead({business:'Contato WhatsApp '+number.slice(-4),phone:number,source:'WHATSAPP_INBOUND',contact_permission:false}).lead;
  const thread=getThread(lead.id,jid);
  addMessage({threadId:thread.id,providerId:'interactive:'+requestId,direction:'out',body:template.body,status:'accepted'});
  audit('WAAKG_INTERACTIVE_ACCEPTED',lead.id,{mode:template.mode,buttons:template.buttons.length,manual:true});
  return {status:200,body:{ok:true,state:'ACCEPTED',delivery:'UNVERIFIED',mode:template.mode,message:'O gateway aceitou o envio. Confirme no WhatsApp se os botões apareceram.'}};
 }catch{
  return {status:502,body:{error:'O envio pode ter ocorrido. Confira no WhatsApp; não repetir automaticamente.',delivery:'UNKNOWN'}};
 }
}
