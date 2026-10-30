// Groq assistant for inbound 1:1 conversations only. Hot leads silently
// transfer to the operator; never sends an extra response on handoff.
import {db,one,all,run,id,tx,now,stage,addMessage,audit} from './db.mjs';
import {aiDraft} from './ai-groq.mjs';
import {getSetting} from './db.mjs';
import {conversationAuthorized,operatorOffer} from './operator-outreach.mjs';
import {requestPriceApproval,approvedPriceForLead} from './owner-price-approvals.mjs';
import {prospectSalesContext,priceQuestion} from './sales-policy.mjs';
import {introductionStatus} from './prospecting-introduction.mjs';
import {recordSalesOutcome} from './sales-outcomes.mjs';
import {explicitInterest,qualifyWithGroq} from './groq-interest-check.mjs';
import {queueNotice} from './notifications.mjs';
import {testModeAllowed,reviewGroqReply} from './groq-live-test-guard.mjs';
import {classifyInbound,firstGreeting,personalPhone} from './personal-concierge.mjs';
import {analyzeChatTurn,compactChatHistory,refineChatReply} from './francisca-chat-coach.mjs';
import {classifyContact} from './whatsapp-roles.mjs';
import {makeFranciscaVoice} from './francisca-tts.mjs';
import {sendVoiceMedia} from './waakg-media.mjs';
import {chooseReplyChannel,channelPreference,saveChannelPreference,reservePart,acceptPart,partsFor} from './groq-reply-channels.mjs';
import {waControlStatus,waRequest,selectedWaSession} from './waakg-control.mjs';
db.exec("CREATE TABLE IF NOT EXISTS groq_auto_events(provider_id TEXT PRIMARY KEY,jid TEXT NOT NULL,state TEXT NOT NULL,at TEXT NOT NULL,error TEXT)");
run("UPDATE groq_auto_events SET state='UNKNOWN',error='Interrupted; verify before retry' WHERE state IN ('PROCESSING','SENDING')");
const digits=s=>String(s||'').replace(/\D/g,'');
const optedOut=s=>/\b(pare|parar|stop|sair|remover|nao me contate|não me contate|sem interesse|nao tenho interesse)\b/i.test(String(s||''));
export function ownerTarget(){const preferred=personalPhone();if(preferred)return preferred;const raw=digits(process.env.PROSPECTOR_HOT_LEAD_PHONE);const val=raw.length===11?'55'+raw:raw;return /^55\d{10,11}$/.test(val)?val:null;}
export function interestNotice(lead,evidence){
 const business=one('SELECT * FROM leads WHERE id=?',lead.lead_id)||lead;
 const links=[];
 if(business.instagram){const ig=String(business.instagram);if(/^https:\/\/(?:www\.)?instagram\.com\//i.test(ig))links.push('Instagram: '+ig);else if(/^[a-z0-9._]+$/i.test(ig))links.push('Instagram: https://www.instagram.com/'+ig+'/');}
 if(/^https?:\/\//i.test(business.website||''))links.push('Site: '+business.website);
 for(const row of all("SELECT identity FROM lead_origins WHERE lead_id=? AND source='maps_extension'",lead.lead_id))if(/^https:\/\/(?:www\.google\.[a-z.]+\/maps\/|maps\.google\.[a-z.]+\/|maps\.app\.goo\.gl\/)/i.test(row.identity))links.push('Maps: '+row.identity);
 return ['⭐ Interesse real no Prospector','Empresa: '+business.business,'Contato: '+(business.name||'não informado'),'Telefone: '+business.phone,...links,'Assumir conversa: https://wa.me/'+business.phone,'Interesse: '+String(evidence||lead.body||'Intenção confirmada').slice(0,180),'Próximo passo: assumir atendimento e confirmar escopo.'].join('\n');
}
export function agentStatus(){return {enabled:process.env.AI_CONVERSATION_AUTOSEND==='true',inboundAssistantEnabled:process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED==='true',approvedProspectFollowup:getSetting('sales_followup_enabled',true)===true,alertOnlyEnabled:process.env.PROSPECTOR_INTEREST_ALERTS_ENABLED==='true',ownerConfigured:!!ownerTarget(),ownerLastFour:(ownerTarget()||'').slice(-4),inboundOnly:true};}
function approvedProspectFollowup(identity,jid){
 if(getSetting('sales_followup_enabled',true)!==true||identity.role!=='PROSPECT_APPROACHED')return false;
 const number=String(jid||'').split('@')[0];
 const lead=one("SELECT id FROM leads WHERE phone=?",number);
 return !!lead&&conversationAuthorized(lead.id);
}
export function queueInboundTurn({providerId,jid}={}){
 if(!providerId||!/^\d{12,15}@s\.whatsapp\.net$/.test(jid||''))return false;
 const identity=classifyContact({jid,sessionId:selectedWaSession()});
 const lead=one('SELECT id FROM leads WHERE phone=?',String(jid).split('@')[0]);
 const intro=lead?introductionStatus(lead.id):null;
 if(intro&&intro.stage!=='CONVERSING'&&!conversationAuthorized(lead.id))return false;
 const allowed=approvedProspectFollowup(identity,jid);
 if(!allowed&&process.env.AI_CONVERSATION_AUTOSEND!=='true'&&process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED!=='true'&&process.env.PROSPECTOR_INTEREST_ALERTS_ENABLED!=='true'&&!testModeAllowed(String(jid).split('@')[0]))return false;
 return run("INSERT OR IGNORE INTO groq_auto_events(provider_id,jid,state,at) VALUES(?,?,?,?)",providerId,jid,'PENDING',now()).changes>0;
}
const active=new Set();
export async function handleSalesTurn(providerId,deps={}){
 const r=one("SELECT e.*,i.body,i.state inbox_state,i.lead_id,i.session_id,l.business,l.phone,l.stage,t.id thread_id,t.manual_takeover FROM groq_auto_events e JOIN waakg_inbox i ON i.provider_id=e.provider_id JOIN leads l ON l.id=i.lead_id JOIN threads t ON t.lead_id=l.id WHERE e.provider_id=? AND e.state='PENDING'",providerId);
 if(!r)return {state:'SKIP'};
 const finish=(status,error='')=>{run('UPDATE groq_auto_events SET state=?,error=? WHERE provider_id=?',status,error,providerId);return {state:status};};
 const identity=classifyContact({jid:r.jid,sessionId:r.session_id});
 const allowTest=identity.role==='OWNER'&&identity.testSandbox===true;
 const salesFollowup=approvedProspectFollowup(identity,r.jid);
 const intro=introductionStatus(r.lead_id);
 if(intro&&intro.stage!=='CONVERSING'&&!conversationAuthorized(r.lead_id))return finish('SKIPPED','INTRO_NOT_COMPLETE');
 if(identity.role==='UNVERIFIED')return finish('SKIPPED','UNVERIFIED_SENDER');
 if(identity.role==='OWNER'&&!allowTest)return finish('HANDOFF','OWNER_PRIVILEGED_CHANNEL');
 if(!salesFollowup&&process.env.AI_CONVERSATION_AUTOSEND!=='true'&&process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED!=='true'&&process.env.PROSPECTOR_INTEREST_ALERTS_ENABLED!=='true'&&!allowTest)return finish('DISABLED');
 if(r.session_id!==selectedWaSession())return finish('SKIPPED','SESSION');
 if(!allowTest&&(r.phone===ownerTarget()||r.phone===digits(process.env.GROQ_OWNER_WHATSAPP)||r.phone===personalPhone()))return finish('SKIPPED','OWNER');
 if(optedOut(r.body)||one('SELECT phone FROM suppressions WHERE phone=?',r.phone))return finish('SKIPPED','OPTOUT');
 if(identity.role!=='EXISTING_CLIENT'&&['INTERESTED','NO_INTEREST','CLOSED_WON'].includes(r.stage))return finish('SKIPPED','ALREADY_HANDOFF');
 const stale=()=>{
  const current=one('SELECT l.stage,l.phone,t.manual_takeover,i.state inbox_state,i.body FROM leads l JOIN threads t ON t.lead_id=l.id JOIN waakg_inbox i ON i.provider_id=? WHERE l.id=?',providerId,r.lead_id);
  if(!current||current.manual_takeover||current.inbox_state!=='REVIEW'||current.stage!==r.stage||current.phone!==r.phone||current.body!==r.body||selectedWaSession()!==r.session_id||one('SELECT phone FROM suppressions WHERE phone=?',r.phone))return 'HANDOFF';
  if(classifyContact({jid:r.jid,sessionId:r.session_id}).role!==identity.role)return 'HANDOFF';
  const currentIntro=introductionStatus(r.lead_id);
  if((currentIntro&&currentIntro.stage!=='CONVERSING'&&!conversationAuthorized(r.lead_id))||(salesFollowup&&!approvedProspectFollowup(identity,r.jid)))return 'HANDOFF';
  if(one('SELECT provider_id FROM waakg_inbox WHERE jid=? ORDER BY rowid DESC LIMIT 1',r.jid)?.provider_id!==providerId)return 'SUPERSEDED';
  return '';
 };
 if(stale())return finish(stale());
 run("UPDATE groq_auto_events SET state='PROCESSING' WHERE provider_id=?",providerId);
 const recentTurns=all("SELECT direction,body,at FROM messages WHERE thread_id=? ORDER BY at DESC,rowid DESC LIMIT 22",r.thread_id).reverse();
 const history=recentTurns.slice(-8).map(m=>(m.direction==='in'?'Cliente: ':'Consecom: ')+String(m.body||'').slice(0,220)).join('\n');
 // A chat is a continuous exchange. Read the real server-side thread rather
 // than asking the model to infer whether it has greeted the contact before.
 const hasOutbound=!!one("SELECT 1 FROM messages WHERE thread_id=? AND direction='out' LIMIT 1",r.thread_id);
 const dialogue=analyzeChatTurn({text:r.body,history:recentTurns,role:identity.role});
 dialogue.hasAssistantReply=hasOutbound;
 dialogue.isFirstContact=!hasOutbound;
 const financial=priceQuestion(r.body)&&!['EXISTING_CLIENT','OWNER'].includes(identity.role);
 const approval=financial?(deps.requestPriceApproval||requestPriceApproval)({leadId:r.lead_id,providerId,question:r.body,sessionId:r.session_id}):null;
 if(financial&&!approval?.ok)return finish('REVIEW','PRICE_APPROVAL_UNAVAILABLE');
 const qualify=deps.qualify||qualifyWithGroq;
 // Existing customers and owner QA NEVER become sales opportunities from
 // their ordinary WhatsApp messages, regardless of how they phrase a request.
 const interest=financial||['EXISTING_CLIENT','OWNER'].includes(identity.role)?
  {confirmed:false,reason:'NOT_A_SALES_PROSPECT'}:await qualify({text:r.body,history});
 if(stale())return finish(stale());
 if(interest.confirmed){
  tx(()=>{
   if(one('SELECT manual_takeover FROM threads WHERE id=?',r.thread_id)?.manual_takeover!==1){
    stage(r.lead_id,'INTERESTED','GROQ_REAL_INTEREST');
    recordSalesOutcome({leadId:r.lead_id,status:'INTERESTED',providerId,evidence:interest.evidence||r.body,notify:false});
    run('UPDATE threads SET manual_takeover=1 WHERE id=?',r.thread_id);
    queueNotice('groq-hot:'+r.lead_id,'GROQ_HOT_LEAD',
     interestNotice(r,interest.evidence),r.lead_id);
    audit('GROQ_INTEREST_ALERT_QUEUED',r.lead_id,{model:'groq',confidence:interest.confidence});
   }
  });
  return finish('HOT');
 }
 // An apparent commitment which the model cannot verify is left for review.
 if(!financial&&identity.role!=='EXISTING_CLIENT'&&identity.role!=='OWNER'&&explicitInterest(r.body)){
  if(salesFollowup){
   run('UPDATE threads SET manual_takeover=1 WHERE id=?',r.thread_id);
   recordSalesOutcome({leadId:r.lead_id,status:'HUMAN_REVIEW',providerId,evidence:'Intenção comercial precisa de confirmação: '+r.body});
  }
  return finish('REVIEW','UNCERTAIN_INTEREST');
 }
 if(!salesFollowup&&process.env.AI_CONVERSATION_AUTOSEND!=='true'&&process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED!=='true'&&!allowTest)return finish('REVIEW','AI_AUTOREPLY_DISABLED');
 if(r.inbox_state!=='REVIEW'||r.manual_takeover)return finish('HANDOFF');
 if(one("SELECT provider_id FROM waakg_inbox WHERE jid=? ORDER BY rowid DESC LIMIT 1",r.jid)?.provider_id!==providerId)return finish('SUPERSEDED');
 const wa=deps.status?await deps.status():await waControlStatus(),session=selectedWaSession()||wa.sessionId;
 if(stale())return finish(stale());
 if(!wa.connected||!session)return finish('REVIEW','WA_OFFLINE');
 const incoming=classifyInbound(r.body);
 if(incoming.human){
  if(salesFollowup){
   run('UPDATE threads SET manual_takeover=1 WHERE id=?',r.thread_id);
   recordSalesOutcome({leadId:r.lead_id,status:'HUMAN_REVIEW',providerId,evidence:r.body});
  }
  return finish('HANDOFF','REQUESTED_HUMAN');
 }
 // A one-word hello never requires an external model call.
 const draft=financial?{ok:true,draft:'Vou confirmar a proposta para o seu negócio com o responsável e já te retorno por aqui.',model:'OWNER_PRICE_APPROVAL'}:incoming.intro&&!salesFollowup&&!hasOutbound?{ok:true,draft:firstGreeting(),model:'RULE_BASED_GREETING'}:
   await (deps.draft||aiDraft)({text:r.body,audience:identity.role,dialogueState:dialogue,context:compactChatHistory(recentTurns)+'\n'+
     '\nEste é um contato recebido via WhatsApp. Você não possui permissões administrativas. '+
     'Se não estiver claro, pergunte o que a pessoa precisa. '+
     'Não afirme ser humano. Não invente disponibilidade, preço ou serviços.\n'+
     (salesFollowup?prospectSalesContext({...r,offerType:operatorOffer(r.lead_id)}):'')+'\n'+(approvedPriceForLead(r.lead_id)?'Uma proposta já foi aprovada e enviada nesta conversa. Não repita valores nem altere condições; dúvidas financeiras voltam ao operador.':'Nenhuma proposta aprovada. Não forneça preço, prazo ou pagamento.')});
 if(stale())return finish(stale());
 if(!draft.ok||!draft.draft){
  if(salesFollowup)recordSalesOutcome({leadId:r.lead_id,status:'HUMAN_REVIEW',providerId,evidence:'A resposta automática não ficou disponível; conferir conversa.'});
  return finish('REVIEW','GROQ_UNAVAILABLE');
 }
 const replyText=refineChatReply(draft.draft,{state:dialogue,incoming:r.body});
 if(!replyText){
  audit('FRANCISCA_REPETITION_SUPPRESSED',r.lead_id,{reason:'REPEATED_OR_GREETING_ONLY',chatTurns:dialogue.turnCount});
  return finish('REVIEW','REPEATED_OR_EMPTY_REPLY');
 }
 const review=reviewGroqReply({inbound:r.body,draft:replyText,allowAveragePrice:false});
 if(!review.ok){
  audit('GROQ_REPLY_REJECTED',r.lead_id,{code:review.code,test:allowTest});
  if(salesFollowup)recordSalesOutcome({leadId:r.lead_id,status:'HUMAN_REVIEW',providerId,evidence:'Resposta bloqueada para revisão: '+review.code});
  return finish('REVIEW','SAFETY_'+review.code);
 }
 if(one('SELECT manual_takeover FROM threads WHERE id=?',r.thread_id)?.manual_takeover===1||one('SELECT phone FROM suppressions WHERE phone=?',r.phone))return finish('HANDOFF');
 if(one("SELECT provider_id FROM waakg_inbox WHERE jid=? ORDER BY rowid DESC LIMIT 1",r.jid)?.provider_id!==providerId)return finish('SUPERSEDED');
 const audioTable=!!one("SELECT name FROM sqlite_master WHERE type='table' AND name='inbound_audio_jobs'");
 const wasAudio=audioTable&&!!one("SELECT provider_id FROM inbound_audio_jobs WHERE provider_id=? AND state='DONE'",providerId);
 const routing=chooseReplyChannel({inbound:r.body,draft:replyText,wasAudio,isOperatorTest:allowTest,
  preferredMode:channelPreference(r.jid),
  voiceAvailable:process.env.AUDIO_RESPONSE_ENABLED==='true'&&process.env.FRANCISCA_TTS_ENABLED==='true'});
 if(routing.preference)saveChannelPreference(r.jid,routing.preference);
 // Synthesise before any transport attempt. For temporary TTS failure, retain a
 // complete written response instead of leaving the contact without a reply.
 let voiceBytes=null;
 if(routing.voice){
  try{const speech=await (deps.voice||makeFranciscaVoice)(replyText);voiceBytes=speech.bytes;
   if(!Buffer.isBuffer(voiceBytes)||voiceBytes.length<256)throw Error('INVALID_VOICE');
  }catch(e){
   audit('GROQ_VOICE_FALLBACK',r.lead_id,{reason:'SYNTHESIS_FAILED',channel:routing.mode,test:allowTest});
   routing.mode='TEXT';routing.text=true;routing.voice=false;
  }
 }
 // Recheck takeover and newer inbound after potentially slow TTS generation.
 if(one('SELECT manual_takeover FROM threads WHERE id=?',r.thread_id)?.manual_takeover===1||
    one('SELECT phone FROM suppressions WHERE phone=?',r.phone))return finish('HANDOFF');
 if(one("SELECT provider_id FROM waakg_inbox WHERE jid=? ORDER BY rowid DESC LIMIT 1",r.jid)?.provider_id!==providerId)return finish('SUPERSEDED');
 if(stale())return finish(stale());
 run("UPDATE groq_auto_events SET state='SENDING' WHERE provider_id=?",providerId);
 const accepted=[];
 const mark=(part)=>{acceptPart(providerId,part);accepted.push(part);
  // Record acknowledged delivery before a later transport can fail.
  addMessage({threadId:r.thread_id,providerId:'groq:'+providerId,direction:'out',body:(part==='VOICE'&&!accepted.includes('TEXT')?'[Áudio Francisca] ':'')+replyText,status:'sent'});
 };
 try{
  if(routing.text){
   if(!reservePart(providerId,'TEXT'))return finish('UNKNOWN','DUPLICATE_TEXT_ATTEMPT');
   const ack=await (deps.send||waRequest)('/api/messages/'+encodeURIComponent(session)+'/'+encodeURIComponent(r.jid)+'/send',
    {method:'POST',data:{message:{text:replyText}}});
   if(ack.status!==true)return finish('UNKNOWN','TEXT_UNCONFIRMED');
   mark('TEXT');
  }
  if(routing.voice){
   if(stale())return finish(accepted.length?'PARTIAL':stale(),'STATE_CHANGED');
   if(!reservePart(providerId,'VOICE'))return finish(accepted.length?'PARTIAL':'UNKNOWN','DUPLICATE_VOICE_ATTEMPT');
   const ack=await (deps.sendVoice||sendVoiceMedia)({jid:r.jid,session,bytes:voiceBytes});
   if(ack?.accepted!==true)return finish(accepted.length?'PARTIAL':'UNKNOWN','VOICE_UNCONFIRMED');
   mark('VOICE');
  }
  const prefix=routing.mode==='VOICE'?'[Áudio Francisca] ':
    routing.mode==='BOTH'?'[Texto + áudio Francisca] ':'';
  run('UPDATE messages SET body=? WHERE provider_id=?',prefix+replyText,'groq:'+providerId);
  audit('GROQ_AUTOMATED_INBOUND_REPLY',r.lead_id,{inbound:true,testOnly:allowTest,
    replyLength:replyText.length,deliveryMode:routing.mode,channelReason:routing.reason,contactRole:identity.role,parts:accepted});
  return finish('SENT');
 }catch(e){
  // If the written part was accepted but a voice send fails, NEVER send it again.
  const result=accepted.length?'PARTIAL':'UNKNOWN';
  audit('GROQ_REPLY_DELIVERY_UNCERTAIN',r.lead_id,{deliveryMode:routing.mode,
    partsAccepted:accepted,partsLedger:partsFor(providerId),result});
  return finish(result,'TRANSPORT_UNCERTAIN');
 }
}
let workerBusy=false;
export async function tickSalesAgent(deps={}){
 if(workerBusy)return {status:'BUSY'};
 workerBusy=true;
 try{
  const queue=all("SELECT provider_id,jid FROM groq_auto_events WHERE state='PENDING' ORDER BY at LIMIT 12");
  const candidates=queue.filter(x=>!active.has(x.jid)).slice(0,4);
  for(const row of candidates)active.add(row.jid);
  const outcomes=await Promise.all(candidates.map(x=>handleSalesTurn(x.provider_id,deps).catch(()=>({state:'ERROR'})).finally(()=>active.delete(x.jid))));
  return {status:'OK',processed:outcomes.length,states:outcomes.map(x=>x.state)};
 }finally{workerBusy=false;}
}
let notifying=false;
export async function flushInterestAlerts(deps={}){
 const target=ownerTarget();if(!target||notifying||!one("SELECT id FROM owner_notices WHERE kind IN ('GROQ_HOT_LEAD','SALES_OUTCOME','DAILY_REPORT') AND status='PENDING' LIMIT 1"))return 0;
 notifying=true;
 try{
  const wa=deps.status?await deps.status():await waControlStatus(),session=selectedWaSession()||wa.sessionId;
  if(!wa.connected||!session)return 0;
  let delivered=0;
  for(const entry of all("SELECT * FROM owner_notices WHERE kind IN ('GROQ_HOT_LEAD','SALES_OUTCOME','DAILY_REPORT') AND status='PENDING' ORDER BY created_at LIMIT 5")){
   if(!run("UPDATE owner_notices SET status='SENDING',updated_at=? WHERE id=? AND status='PENDING'",now(),entry.id).changes)continue;
   try{
    const send=deps.send||waRequest;
    const ack=await send('/api/messages/'+encodeURIComponent(session)+'/'+encodeURIComponent(target+'@s.whatsapp.net')+'/send',{method:'POST',data:{message:{text:entry.message}}});
    if(ack.status!==true)throw Error('UNCONFIRMED');
    run("UPDATE owner_notices SET status='SENT',updated_at=? WHERE id=?",now(),entry.id);
    audit('GROQ_HOT_LEAD_ALERT_SENT',entry.lead_id,{owner:true});delivered++;
   }catch{run("UPDATE owner_notices SET status='UNKNOWN',updated_at=?,error=? WHERE id=?",now(),'Unknown delivery, do not automatically retry',entry.id);}
  }
  return delivered;
 }finally{notifying=false;}
}
