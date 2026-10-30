// Check the recipient and the actual WA-AKG message receipt. HTTP 200 or
// Baileys sendMessage resolving is NOT proof that WhatsApp delivered to a phone.
// No retries: the caller owns any explicit new attempt after reconciliation.
import {waRequest} from './waakg-control.mjs';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const safeSession=s=>/^[a-zA-Z0-9_-]{3,70}$/.test(s);
const actualJid=s=>/^55\d{10,11}@s\.whatsapp\.net$/.test(s);
const state=s=>String(s||'').toUpperCase();
export function mobileLooksTruncated(number){
 const raw=String(number||'').replace(/\D/g,'');
 // BR +55 / DDD / leading 9 followed by only 7 digits: it looks
 // like a 9-digit mobile without one digit. Do not send to that JID.
 return /^55\d{2}9\d{7}$/.test(raw);
}
export async function checkDeliveryById({jid,sessionId,messageId},{request=waRequest}={}){
 if(!actualJid(jid)||!safeSession(sessionId)||!/^[-_A-Za-z0-9]{6,200}$/.test(String(messageId||'')))
  return {status:'UNKNOWN',proof:false};
 try{
  const history=await request('/api/chat/'+encodeURIComponent(sessionId)+'/'+encodeURIComponent(jid));
  const messages=Array.isArray(history?.data)?history.data:[];
  const record=messages.find(m=>m?.keyId===messageId&&m?.remoteJid===jid&&m?.fromMe===true);
  if(!record)return {status:'NOT_OBSERVED',proof:false};
  const observed=state(record.status);
  if(observed==='READ'||observed==='DELIVERED')
   return {status:observed,proof:true};
  return {status:observed||'UNKNOWN',proof:false};
 }catch{return {status:'UNKNOWN',proof:false};}
}
export async function deliverVoiceDirectMessage({jid,sessionId,text},{request=waRequest,pause=wait,polls=3}={}){
 if(!actualJid(jid)||!safeSession(sessionId)||typeof text!=='string'||!text.trim())
  return {state:'BLOCKED',reason:'Destinatário, sessão ou texto inválido; nenhuma mensagem foi enviada.'};
 const number=jid.split('@')[0];
 if(mobileLooksTruncated(number))
  return {state:'BLOCKED',reason:'O número parece estar com um dígito faltando. Confirme o DDD e o celular completo; não enviei.'};
 // Check the exact WhatsApp account BEFORE any send. Do not redirect to
 // alternate JIDs: the owner explicitly authorized this exact number.
 let lookup;
 try{
  lookup=await request('/api/chat/'+encodeURIComponent(sessionId)+'/check',
   {method:'POST',data:{numbers:[number]}});
 }catch{
  return {state:'BLOCKED',reason:'Não consegui verificar se esse número está no WhatsApp. Não enviei.'};
 }
 const match=lookup?.data?.results?.find(x=>x.number===number);
 if(lookup?.status!==true||match?.exists!==true)
  return {state:'BLOCKED',reason:'O WhatsApp não confirmou que esse número possui uma conta. Não enviei.'};
 if(match.jid!==jid)
  return {state:'BLOCKED',reason:'O WhatsApp associou o número a um destinatário diferente. Confirme o telefone; não enviei.'};
 let result;
 try{
  result=await request('/api/messages/'+encodeURIComponent(sessionId)+'/'+encodeURIComponent(jid)+'/send',
   {method:'POST',data:{message:{text}}});
 }catch{
  // The provider may have received the request despite the network error.
  return {state:'UNKNOWN',reason:'O envio ficou sem resposta conclusiva. Confira a conversa antes de repetir.'};
 }
 if(result?.status!==true)
  return {state:'UNKNOWN',reason:'O WhatsApp não confirmou a solicitação de envio.'};
 const providerId=String(result?.data?.key?.id||'');
 const remote=String(result?.data?.key?.remoteJid||'');
 if(remote&&remote!==jid)
  return {state:'UNKNOWN',reason:'O provedor retornou um destinatário diferente. Confira a conversa antes de qualquer nova tentativa.'};
 if(!/^[-_A-Za-z0-9]{6,200}$/.test(providerId))
  return {state:'UNKNOWN',reason:'O provedor aceitou a operação, mas não retornou o identificador da mensagem. Entrega não comprovada.'};
 for(let n=0;n<Math.min(4,Math.max(0,Math.floor(polls)));n++){
  if(n)await pause(950);
  const received=await checkDeliveryById({jid,sessionId,messageId:providerId},{request});
  if(received.proof)return {state:received.status,providerId,deliveryProof:true};
 }
 return {state:'ACCEPTED',providerId,deliveryProof:false,reason:'Solicitação aceita, mas a entrega não foi confirmada pelo WhatsApp.'};
}
