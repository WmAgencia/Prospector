// Owner-only, exact-name lookup from the existing WA-AKG synchronized contact
// book. Never infer a phone from a push name, LID or an approximate match.
// A spoken name is NOT permission to send; existing number readback and verbal
// approval still apply for every individual message.
import {waRequest} from './waakg-control.mjs';

const clean=s=>String(s||'').trim().replace(/\s+/g,' ');
const norm=s=>clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N} ]/gu,' ').replace(/\s+/g,' ').trim();
const validSession=s=>/^[a-zA-Z0-9_-]{3,70}$/.test(String(s||''));
const phoneJid=s=>/^55\d{10,11}@s\.whatsapp\.net$/.test(String(s||''));
export function recipientNameInVoice(text,{standalone=false}={}){
 let raw=clean(text);
 if(!raw||raw.length>450)return null;
 let name='';
 if(standalone){
  name=raw.replace(/^(?:é|eh|seria|o nome é|o contato é|para|pra|pro|ao)\s+/i,'')
   .replace(/^(?:o|a|contato|o contato|a contato|meu contato|minha contato)\s+/i,'').trim();
 }else{
  const command=/\b(?:mensage\w*|recado|whatsapp|texto)\b/i;
  if(!command.test(raw))return null;
  const match=raw.match(/\b(?:para|pra|pro|ao)\s+(?:o\s+contato\s+|a\s+contato\s+|o\s+whatsapp\s+(?:de|da|do)\s+|a\s+|o\s+)?(.+?)(?=\s+(?:falando|dizendo|escrevendo|que\s+diga|com\s+(?:a\s+)?mensagem|com\s+(?:o\s+)?texto|mensagem\s+(?:e|é)|texto\s+(?:e|é))\b|[.!?]*$)/i);
  name=clean(match?.[1]);
 }
 if(!name||name.length<2||name.length>80||/\d{3,}/.test(name)||/^(?:numero|telefone|celular|ddd|contato|pessoa|alguem|todos|todos os|grupo)$/i.test(name))return null;
 if(!/[\p{L}]/u.test(name))return null;
 return name;
}
export async function findContactByName(name,{sessionId,request=waRequest}={}){
 const spoken=clean(name);
 if(!validSession(sessionId)||!spoken||spoken.length>80)return {state:'INVALID'};
 const sought=norm(spoken);
 if(sought.length<2)return {state:'INVALID'};
 let response;
 try{
  response=await request('/api/contacts/'+encodeURIComponent(sessionId)+'?search='+encodeURIComponent(spoken)+'&limit=all');
 }catch{return {state:'UNAVAILABLE'};}
 if(response?.status!==true||!Array.isArray(response?.data))return {state:'UNAVAILABLE'};
 // All matching entries are returned by the synchronized-contact endpoint.
 // Avoid silently selecting a contact if the provider response is truncated.
 if(response.data.length>250)return {state:'AMBIGUOUS',matches:[],tooMany:true};
 const matches=new Map();
 for(const item of response.data){
  if(norm(item?.name)!==sought)continue; // notify/push name is not an exact saved-name match
  const addresses=[item.jid,item.remoteJidAlt].filter(phoneJid);
  if(addresses.length>1&&new Set(addresses).size!==1)continue;
  const jid=addresses[0];
  if(!jid)continue; // unresolved WhatsApp LID is not safe for send
  const number=jid.split('@')[0];
  if(/^55\d{2}9\d{7}$/.test(number))continue; // possibly truncated mobile
  matches.set(number,{name:clean(item.name).slice(0,80),number});
 }
 const found=[...matches.values()];
 if(found.length===1)return {state:'MATCH',...found[0]};
 if(found.length>1)return {state:'AMBIGUOUS',matches:found.slice(0,6),tooMany:found.length>6};
 return {state:'NOT_FOUND'};
}
export function contactChoiceFromSpeech(text,matches=[]){
 const input=norm(text),suffix=(input.match(/(?:final|termina|terminado|terminado em|final em|em)\s+(\d{4})\b/)||[])[1];
 if(!suffix)return null;
 const found=matches.filter(x=>x.number.endsWith(suffix));
 return found.length===1?found[0]:null;
}
