// Persisted operator <-> IA ownership for authenticated WhatsApp conversations.
// This controls automatic responses, not authorization to send unsolicited messages.
import {one,run,now,audit,phone,addLead,getThread} from './db.mjs';
import {getSetting} from './db.mjs';
import {documentedOptIn} from './outreach-queue.mjs';
import {introductionStatus} from './prospecting-introduction.mjs';
import {classifyContact} from './whatsapp-roles.mjs';
import {selectedWaSession,waControlStatus} from './waakg-control.mjs';
import {remoteChats} from './waakg-conversations.mjs';
import {takeover} from './runtime.mjs';

const validJid=jid=>/^[0-9]{10,15}@s\.whatsapp\.net$/.test(String(jid||''));
const validLocalId=id=>/^[a-f0-9-]{36}$/i.test(String(id||''));
function resolve(chatId){
 const key=String(chatId||'');
 if(key.startsWith('wa:')){
  const jid=key.slice(3);
  if(!validJid(jid))return null;
  const p=phone(jid.split('@')[0]);
  const lead=p?one('SELECT id,phone,stage FROM leads WHERE phone=?',p):null;
  const thread=lead?one('SELECT id,manual_takeover,jid FROM threads WHERE lead_id=?',lead.id):null;
  return {chatId:key,jid,lead,thread,remote:true};
 }
 if(!validLocalId(key))return null;
 const thread=one('SELECT id,manual_takeover,jid,lead_id FROM threads WHERE id=?',key);
 if(!thread)return null;
 const lead=one('SELECT id,phone,stage FROM leads WHERE id=?',thread.lead_id);
 return {chatId:key,jid:thread.jid||((lead?.phone||'')+'@s.whatsapp.net'),lead,thread,remote:false};
}
export function conversationHandoffStatus(chatId){
 const row=resolve(chatId);
 if(!row)return {chatId:String(chatId||''),manualTakeover:false,canTakeover:false,canDeliverToAi:false,reason:'CONVERSATION_NOT_SUPPORTED'};
 const valid=validJid(row.jid);
 const role=valid?classifyContact({jid:row.jid,sessionId:selectedWaSession()}):{role:'UNVERIFIED'};
 const suppressed=!!row.lead?.phone&&!!one('SELECT 1 FROM suppressions WHERE phone=?',row.lead.phone);
 const eligibleStage=!['NO_INTEREST','INTERESTED','CLOSED_WON'].includes(row.lead?.stage);
 const genericAi=process.env.AI_CONVERSATION_AUTOSEND==='true'||process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED==='true';
 const intro=row.lead?introductionStatus(row.lead.id):null;
 const approved=role.role==='PROSPECT_APPROACHED'&&row.lead&&documentedOptIn(row.lead.id)&&
  getSetting('sales_followup_enabled',true)===true&&(!intro||intro.stage==='CONVERSING');
 const canTakeover=valid&&role.role!=='OWNER'&&role.role!=='UNVERIFIED'&&!suppressed;
 const canDeliverToAi=!!(canTakeover&&eligibleStage&&(approved||genericAi)&&process.env.GROQ_API_KEY);
 const reason=!valid?'UNSUPPORTED_CHAT':role.role==='OWNER'?'OWNER_PRIVATE':role.role==='UNVERIFIED'?'UNVERIFIED':
  suppressed?'OPT_OUT':!eligibleStage?'HUMAN_FOLLOWUP_REQUIRED':!canDeliverToAi?'AI_NOT_ENABLED':'READY';
 return {chatId:row.chatId,manualTakeover:row.thread?.manual_takeover===1,canTakeover,canDeliverToAi,
  role:role.role,reason};
}
export async function changeConversationHandoff({chatId,manual}={},deps={}){
 const key=String(chatId||'');
 if(typeof manual!=='boolean')return {status:400,body:{error:'Escolha atendimento humano ou IA'}};
 const current=conversationHandoffStatus(key);
 if(!current.canTakeover)return {status:403,body:{error:current.reason==='OWNER_PRIVATE'?
  'O canal do proprietário tem controle separado da IA de clientes.':'Esta conversa não permite transferência.'}};
 if(!manual&&!current.canDeliverToAi)return {status:409,body:{error:'IA não habilitada para esta conversa. Verifique o atendimento automático e o estado do contato.'}};
 const row=resolve(key);
 if(row.remote){
  const wa=await (deps.status||waControlStatus)();
  if(!wa.connected)return {status:503,body:{error:'WhatsApp desconectado'}};
  // A browser caller cannot register an arbitrary phone as an inbound contact.
  const chatList=await (deps.listChats||remoteChats)();
  if(!Array.isArray(chatList.items)||!chatList.items.some(x=>x.jid===row.jid))
   return {status:404,body:{error:'Conversa não encontrada no WhatsApp conectado'}};
 }
 const lead=row.lead||addLead({business:'Contato WhatsApp '+row.jid.split('@')[0].slice(-4),
  phone:row.jid.split('@')[0],source:'WHATSAPP_INBOUND',contact_permission:false}).lead;
 const thread=row.thread||getThread(lead.id,row.jid);
 // Recheck identity and status after reading remote state; never resurrect opt-outs.
 const fresh=conversationHandoffStatus(key);
 if(!fresh.canTakeover||(!manual&&!fresh.canDeliverToAi))
  return {status:409,body:{error:'Condições da conversa mudaram. Atualize e tente novamente.'}};
 if((thread.manual_takeover===1)===manual)return {status:200,body:{ok:true,...fresh}};
 takeover(thread.id,manual);
 audit('CHAT_OPERATOR_AI_HANDOFF',lead.id,{manual,source:'CHAT_HEADER'});
 return {status:200,body:{ok:true,...conversationHandoffStatus(key)}};
}
