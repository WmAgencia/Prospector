// Consecom two-channel offer A/B. NEVER send without an operator-approved
// campaign, confirmed permission, an approved current portfolio deadline,
// and a registered original audio. Other tenants cannot use this campaign.
import fs from 'node:fs';
import path from 'node:path';
import {db,one,all,run,now,tx,id,addMessage,audit,getSetting,setSetting,getThread} from './db.mjs';
import {managedSessions,isManagedSession,leadSession} from './waakg-session-registry.mjs';
import {ownerProspectionPaused} from './prospection-pause.mjs';
import {waRequest,waControlStatus} from './waakg-control.mjs';
import {sendRecordedOfferVoiceMedia} from './waakg-media.mjs';
import {prospectorChatEligible} from './whatsapp-roles.mjs';
import {conversationAuthorized} from './operator-outreach.mjs';
import {offerVariantForOrdinal} from './consecom-offer-rotation.mjs';

const KEY='consecom_offer_ab_2026_v1';
const allowed=()=>!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true';
const outreachPaused=()=>ownerProspectionPaused()||getSetting('paused',true)===true;
const daySP=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
// The text variant uses the transcribed original audio, not a separate sales pitch.
export {OFFER_AB_TEXT} from './consecom-offer-copy.mjs';
import {OFFER_AB_TEXT,OFFER_AB_COPY_VERSION,OFFER_AB_REFERENCES_TEXT,OFFER_AB_REFERENCES_DELAY_MS,offerDeadlineMatchesScript} from './consecom-offer-copy.mjs';

db.exec("CREATE TABLE IF NOT EXISTS consecom_offer_ab(lead_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,variant TEXT NOT NULL CHECK(variant IN ('AUDIO','TEXT')),phase INTEGER NOT NULL,provider_id TEXT UNIQUE NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,sent_at TEXT,updated_at TEXT NOT NULL,reason TEXT)");
db.exec("CREATE INDEX IF NOT EXISTS ix_consecom_offer_ab_variant ON consecom_offer_ab(variant,status,sent_at)");
run("UPDATE consecom_offer_ab SET status='UNKNOWN',reason='Send interrupted; do not resend without manual verification',updated_at=? WHERE status='SENDING'",now());
db.exec("CREATE TABLE IF NOT EXISTS consecom_offer_references(lead_id TEXT PRIMARY KEY REFERENCES leads(id),session_id TEXT NOT NULL,jid TEXT NOT NULL,source_provider_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('HELD','WAITING','SENDING','SENT','UNKNOWN','CANCELLED')),due_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,sent_at TEXT,reason TEXT)");
db.exec("CREATE INDEX IF NOT EXISTS ix_consecom_offer_references_due ON consecom_offer_references(state,due_at)");
run("UPDATE consecom_offer_references SET state='UNKNOWN',reason='Process interrupted during reference send; manual review required',updated_at=? WHERE state='SENDING'",now());
const baseConfig={enabled:false,audioMediaId:null,audioCopyVersion:null,portfolioDueDate:null,confirmedAt:null,startDate:null,rotationDays:7};
const config=()=>({...baseConfig,...(getSetting(KEY,null)||{})});
const mediaRecord=c=>{
 if(!c.audioMediaId)return null;
 const item=one("SELECT id,kind,mime,bytes,filename FROM media WHERE id=?",c.audioMediaId);
 if(!item||item.kind!=='audio'||item.mime!=='audio/ogg'||item.bytes<256||item.bytes>15*1024*1024)return null;
 if(!/^[0-9a-f-]{36}\.ogg$/i.test(item.filename))return null;
 const mediaDir=path.resolve(process.env.PROSPECTOR_DATA_DIR||'data','media');
 const file=path.resolve(mediaDir,item.filename);
 if(!file.startsWith(mediaDir+path.sep))return null;
 try{const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||st.size!==item.bytes)return null;}catch{return null;}
 return {...item,file};
};
const deadlineReady=(c,at=new Date())=>offerDeadlineMatchesScript(c,at);
export function offerAbConfig(){
 const c=config(),asset=mediaRecord(c),sessions=managedSessions();
 const audioCurrent=!!asset&&c.audioCopyVersion===OFFER_AB_COPY_VERSION;
 return {enabled:c.enabled,paused:outreachPaused(),assetReady:audioCurrent,audioNeedsUpdate:!!asset&&!audioCurrent,
  audioMediaId:audioCurrent?c.audioMediaId:null,copyVersion:OFFER_AB_COPY_VERSION,
  portfolioDueDate:c.portfolioDueDate,deadlineReady:deadlineReady(c),startDate:c.startDate,
  rotationDays:c.rotationDays,sessionA:sessions[0]?.label||null,sessionB:sessions[1]?.label||null,
  availableSessions:sessions.length,ready:allowed()&&c.enabled&&!outreachPaused()&&audioCurrent&&sessions.length>=1&&deadlineReady(c)};
}
export function offerAbStatus(){
 if(!allowed())return {available:false,reason:'CONSECOM_ONLY'};
 const c=offerAbConfig();
 const totals=all("SELECT variant,status,COUNT(*) n FROM consecom_offer_ab GROUP BY variant,status");
 const metrics=[];
 for(const variant of ['AUDIO','TEXT']){
  const sent=one("SELECT COUNT(*) n FROM consecom_offer_ab WHERE variant=? AND status='SENT'",variant)?.n||0;
  const replies=one("SELECT COUNT(DISTINCT a.lead_id) n FROM consecom_offer_ab a JOIN waakg_inbox i ON i.lead_id=a.lead_id WHERE a.variant=? AND a.status='SENT' AND i.state='REVIEW' AND i.received_at>a.sent_at",variant)?.n||0;
  const conversions=one("SELECT COUNT(DISTINCT a.lead_id) n FROM consecom_offer_ab a JOIN leads l ON l.id=a.lead_id WHERE a.variant=? AND a.status='SENT' AND l.stage='CLOSED_WON'",variant)?.n||0;
  metrics.push({variant,sent,humanReplies:replies,closed:conversions,replyRate:sent?Math.round(replies/sent*1000)/10:null,closeRate:sent?Math.round(conversions/sent*1000)/10:null});
 }
 return {available:true,config:c,counts:totals,metrics,proposalPreview:OFFER_AB_TEXT,referencesPreview:OFFER_AB_REFERENCES_TEXT,referenceFollowups:all('SELECT state,COUNT(*) n FROM consecom_offer_references GROUP BY state'),referenceDelaySeconds:OFFER_AB_REFERENCES_DELAY_MS/1000,design:'alternating eligible leads in chronological assignment order, AUDIO then TEXT, independent of WhatsApp session',note:'No spam-evasion guarantees; measure only permission-based conversations'};
}
export function attachOriginalAbAudio(mediaId,{confirmedScript=false}={}){
 if(!allowed())throw Error('CONSECOM_ONLY');
 if(confirmedScript!==true)throw Error('Confirme que este áudio foi regravado com o roteiro atualizado.');
 const audioMediaId=String(mediaId||'');
 const candidate=mediaRecord({...config(),audioMediaId});
 if(!candidate)throw Error('Envie o novo áudio OGG para a biblioteca antes de selecioná-lo.');
 const c={...config(),audioMediaId,audioCopyVersion:OFFER_AB_COPY_VERSION,enabled:false};
 setSetting(KEY,c);audit('OFFER_AB_AUDIO_REGISTERED',null,{mediaId:audioMediaId,bytes:candidate.bytes,copyVersion:OFFER_AB_COPY_VERSION});
 return offerAbStatus();
}
export function setOfferAbPlan({portfolioDueDate,startDate,enabled=false}={}){
 if(!allowed())throw Error('CONSECOM_ONLY');
 const delivery=String(portfolioDueDate||'').trim(),start=String(startDate||daySP(new Date())).trim();
 if(!datePattern.test(delivery)||!Number.isFinite(Date.parse(delivery+'T12:00:00Z'))||new Date(delivery+'T12:00:00Z').toISOString().slice(0,10)!==delivery)
  throw Error('Informe a data real de entrega do portfólio.');
 if(!datePattern.test(start))throw Error('Informe a data inicial AAAA-MM-DD.');
 const next={...config(),portfolioDueDate:delivery,confirmedAt:now(),startDate:start,enabled:enabled===true};
 if(next.enabled&&(!mediaRecord(next)||next.audioCopyVersion!==OFFER_AB_COPY_VERSION||outreachPaused()||!deadlineReady(next)))
  throw Error('Ativação indisponível: envie o novo áudio, confirme o prazo de três dias e libere a prospecção.');
 setSetting(KEY,next);
 audit('OFFER_AB_PLAN_SAVED',null,{enabled:next.enabled,portfolioDueDate:delivery,startDate:start,copyVersion:OFFER_AB_COPY_VERSION});
 return offerAbStatus();
}
export function offerAbDecision({leadId,sessionId,at=new Date()}={}){
 if(!allowed())return {eligible:false,reason:'CONSECOM_ONLY'};
 const c=config();
 if(!c.enabled)return {eligible:false,reason:'EXPERIMENT_DISABLED'};
 if(outreachPaused())return {eligible:false,reason:'OWNER_PAUSED'};
 if(!mediaRecord(c)||c.audioCopyVersion!==OFFER_AB_COPY_VERSION)return {eligible:false,reason:'UPDATED_AUDIO_NOT_READY'};
 if(!deadlineReady(c,at))return {eligible:false,reason:'THREE_DAY_CLAIM_UNVERIFIED_OR_EXPIRED'};
 if(!datePattern.test(c.startDate||'')||daySP(at)<c.startDate)return {eligible:false,reason:'NOT_STARTED'};
 if(!leadId||leadSession(leadId)!==sessionId||!isManagedSession(sessionId))return {eligible:false,reason:'SESSION_MISMATCH'};
 const prior=one("SELECT variant,status FROM consecom_offer_ab WHERE lead_id=?",leadId);
 if(prior)return {eligible:false,reason:'ALREADY_ASSIGNED',prior};
 const elapsed=Math.floor((Date.parse(daySP(at))-Date.parse(c.startDate))/86400000);
 const phase=Math.floor(elapsed/7);
 const nextOrdinal=Number(one('SELECT COUNT(*) n FROM consecom_offer_ab')?.n||0);
 const variant=offerVariantForOrdinal(nextOrdinal);
 return {eligible:true,leadId,sessionId,variant,phase,body:OFFER_AB_TEXT};
}
export async function sendOfferAb({leadId,sessionId,jid,providerId,threadId,at=new Date(),sendText=waRequest,sendAudio=sendRecordedOfferVoiceMedia,connected=waControlStatus}={}){
 const plan=offerAbDecision({leadId,sessionId,at});
 if(!plan.eligible)return {state:'NOT_SENT',reason:plan.reason};
 if(!/^\d{12,15}@s\.whatsapp\.net$/.test(String(jid||''))||!prospectorChatEligible({jid,sessionId}))return {state:'NOT_SENT',reason:'INELIGIBLE_CONTACT'};
 const latest=one("SELECT provider_id,state FROM waakg_inbox WHERE jid=? ORDER BY rowid DESC LIMIT 1",jid);
 if(!providerId||!latest||latest.provider_id!==providerId||latest.state!=='REVIEW')
  return {state:'NOT_SENT',reason:'INBOUND_CHANGED_OR_NOT_APPROVED'};
 if(one("SELECT manual_takeover FROM threads WHERE lead_id=?",leadId)?.manual_takeover===1||
    one("SELECT phone FROM suppressions WHERE phone=?",String(jid).split('@')[0]))
  return {state:'NOT_SENT',reason:'TAKEOVER_OR_OPTOUT'};

 const status=await connected(sessionId);
 if(!status?.connected)return {state:'NOT_SENT',reason:'WA_OFFLINE'};
 if(outreachPaused())return {state:'NOT_SENT',reason:'OWNER_PAUSED'};
 if(!deadlineReady(config(),new Date())||config().audioCopyVersion!==OFFER_AB_COPY_VERSION)return {state:'NOT_SENT',reason:'OUTDATED_SCRIPT_OR_DEADLINE'};
 const current=one("SELECT provider_id,state FROM waakg_inbox WHERE jid=? ORDER BY rowid DESC LIMIT 1",jid);
 if(!current||current.provider_id!==providerId||current.state!=='REVIEW'||!prospectorChatEligible({jid,sessionId})||
    one("SELECT phone FROM suppressions WHERE phone=?",String(jid).split('@')[0]))
  return {state:'NOT_SENT',reason:'CONTACT_CHANGED_BEFORE_SEND'};
 const stamp=now(),recordId='offer-ab:'+String(leadId);
 const reserved=tx(()=>{if(outreachPaused()||one('SELECT 1 FROM consecom_offer_ab WHERE lead_id=?',leadId))return null;
  // Assign the next slot inside the transaction, so concurrent replies do not get the same channel.
  const nextOrdinal=Number(one('SELECT COUNT(*) n FROM consecom_offer_ab')?.n||0);
  const variant=offerVariantForOrdinal(nextOrdinal);
  const saved=run("INSERT OR IGNORE INTO consecom_offer_ab(lead_id,session_id,variant,phase,provider_id,status,created_at,updated_at) VALUES(?,?,?,?,?,'SENDING',?,?)",
   leadId,sessionId,variant,plan.phase,recordId,stamp,stamp).changes===1;
  if(saved)run("INSERT OR IGNORE INTO consecom_offer_references(lead_id,session_id,jid,source_provider_id,state,created_at,updated_at) VALUES(?,?,?,?,'HELD',?,?)",leadId,sessionId,jid,recordId,stamp,stamp);
  return saved?variant:null;
 });
 if(!reserved)return {state:'NOT_SENT',reason:'ALREADY_RESERVED'};
 plan.variant=reserved;
 try{
  let acknowledged=false;
  if(plan.variant==='AUDIO'){
   const asset=mediaRecord(config());
   if(!asset)throw Error('AUDIO_DISAPPEARED');
   const bytes=fs.readFileSync(asset.file);
   const r=await sendAudio({jid,session:sessionId,bytes});
   acknowledged=r?.accepted===true;
  }else{
   const r=await sendText('/api/messages/'+encodeURIComponent(sessionId)+'/'+encodeURIComponent(jid)+'/send',
    {method:'POST',data:{message:{text:plan.body}}});
   acknowledged=r?.status===true;
  }
  if(!acknowledged)throw Error('TRANSPORT_UNCONFIRMED');
  tx(()=>{
   const acceptedAt=now();
   run("UPDATE consecom_offer_ab SET status='SENT',sent_at=?,updated_at=? WHERE lead_id=? AND status='SENDING'",acceptedAt,acceptedAt,leadId);
   run("UPDATE consecom_offer_references SET state='WAITING',due_at=?,updated_at=? WHERE lead_id=? AND state='HELD'",new Date(Date.now()+OFFER_AB_REFERENCES_DELAY_MS).toISOString(),acceptedAt,leadId);
  });
  const thread=threadId?{id:threadId}:getThread(leadId,jid);
  addMessage({threadId:thread.id,providerId:recordId,direction:'out',type:plan.variant==='AUDIO'?'audio':'text',
   body:plan.variant==='AUDIO'?'[Áudio original de proposta Consecom — variante A/B]':plan.body,status:'sent'});
  audit('OFFER_AB_SENT',leadId,{variant:plan.variant,phase:plan.phase,session:sessionId});
  return {state:'SENT',variant:plan.variant,phase:plan.phase};
 }catch(error){
  run("UPDATE consecom_offer_ab SET status='UNKNOWN',reason=?,updated_at=? WHERE lead_id=? AND status='SENDING'",
   String(error.message||'UNCERTAIN_DELIVERY').slice(0,95),now(),leadId);
  run("UPDATE consecom_offer_references SET state='CANCELLED',reason='Proposal delivery unconfirmed',updated_at=? WHERE lead_id=? AND state IN ('HELD','WAITING')",now(),leadId);
  audit('OFFER_AB_SEND_UNKNOWN',leadId,{variant:plan.variant,needsReview:true});
  return {state:'UNKNOWN',variant:plan.variant,reason:'TRANSPORT_UNCERTAIN_NO_RETRY'};
 }
}

let referencesTicking=false;
// A separate persisted worker sends the references after the initial text or
// recorded audio is acknowledged by WA-AKG. Never retry uncertain deliveries.
export async function tickOfferReferences({currentTime=()=>Date.now(),getWaStatus=waControlStatus,send=waRequest}={}){
 if(referencesTicking)return {state:'BUSY'};
 if(!allowed()||outreachPaused())return {state:'PAUSED'};
 referencesTicking=true;
 try{
  const item=one("SELECT * FROM consecom_offer_references WHERE state='WAITING' AND due_at<=? ORDER BY due_at,created_at LIMIT 1",new Date(currentTime()).toISOString());
  if(!item)return {state:'NOT_DUE'};
  const cancel=reason=>{run("UPDATE consecom_offer_references SET state='CANCELLED',reason=?,updated_at=? WHERE lead_id=? AND state='WAITING'",reason,now(),item.lead_id);audit('OFFER_AB_REFERENCES_CANCELLED',item.lead_id,{reason});return {state:'CANCELLED',reason};};
  // A paused or disconnected campaign must never dispatch an old 25-second follow-up hours later.
  if(currentTime()-Date.parse(item.due_at)>90_000)return cancel('FOLLOWUP_WINDOW_EXPIRED');
  const original=one("SELECT status,sent_at,provider_id FROM consecom_offer_ab WHERE lead_id=?",item.lead_id);
  const lead=one("SELECT l.phone,l.stage,t.manual_takeover FROM leads l LEFT JOIN threads t ON t.lead_id=l.id WHERE l.id=?",item.lead_id);
  if(!original||original.status!=='SENT'||original.provider_id!==item.source_provider_id||!original.sent_at)return cancel('OFFER_NOT_CONFIRMED');
  if(!lead||lead.phone!==String(item.jid).split('@')[0]||['NO_INTEREST','INTERESTED','CLOSED_WON'].includes(lead.stage)||lead.manual_takeover===1)return cancel('LEAD_CHANGED_OR_HANDOFF');
  if(one('SELECT 1 FROM suppressions WHERE phone=?',lead.phone))return cancel('OPTED_OUT');
  if(!isManagedSession(item.session_id)||leadSession(item.lead_id)!==item.session_id||!prospectorChatEligible({jid:item.jid,sessionId:item.session_id})||!conversationAuthorized(item.lead_id))return cancel('NO_LONGER_AUTHORIZED');
  // If the person replies before the 25-second follow-up, allow the human/AI
  // conversation to proceed instead of sending an untimely link blast.
  const newerReply=one("SELECT 1 FROM waakg_inbox WHERE jid=? AND received_at>? LIMIT 1",item.jid,original.sent_at);
  if(newerReply)return cancel('RECIPIENT_REPLIED');
  const connection=await getWaStatus(item.session_id);
  if(!connection?.connected)return {state:'WAITING',reason:'WHATSAPP_OFFLINE'};
  if(outreachPaused())return {state:'PAUSED'};
  // A reply or opt-out arriving during the connection check takes precedence.
  const freshest=one("SELECT 1 FROM waakg_inbox WHERE jid=? AND received_at>? LIMIT 1",item.jid,original.sent_at);
  if(freshest||one('SELECT 1 FROM suppressions WHERE phone=?',lead.phone)||!conversationAuthorized(item.lead_id))return cancel('CONTACT_CHANGED_BEFORE_FOLLOWUP');
  if(currentTime()-Date.parse(item.due_at)>90_000)return cancel('FOLLOWUP_WINDOW_EXPIRED');
  // No retries on any in-flight transport. Crash recovery marks SENDING UNKNOWN.
  const locked=run("UPDATE consecom_offer_references SET state='SENDING',updated_at=? WHERE lead_id=? AND state='WAITING' AND due_at<=?",now(),item.lead_id,new Date(currentTime()).toISOString()).changes===1;
  if(!locked)return {state:'SKIP'};
  try{
   if(outreachPaused())throw Error('OWNER_PAUSED_DURING_SEND');
   const ack=await send('/api/messages/'+encodeURIComponent(item.session_id)+'/'+encodeURIComponent(item.jid)+'/send',{method:'POST',data:{message:{text:OFFER_AB_REFERENCES_TEXT}}});
   if(ack?.status!==true)throw Error('REFERENCES_TRANSPORT_UNCONFIRMED');
   const acceptedAt=now();
   run("UPDATE consecom_offer_references SET state='SENT',sent_at=?,updated_at=? WHERE lead_id=? AND state='SENDING'",acceptedAt,acceptedAt,item.lead_id);
   const thread=getThread(item.lead_id,item.jid);
   addMessage({threadId:thread.id,providerId:'offer-ab-references:'+item.lead_id,direction:'out',body:OFFER_AB_REFERENCES_TEXT,status:'sent'});
   audit('OFFER_AB_REFERENCES_SENT',item.lead_id,{seconds:OFFER_AB_REFERENCES_DELAY_MS/1000,deliveryVerifiedOnPhone:false});
   return {state:'SENT',leadId:item.lead_id};
  }catch(error){
   const reason=String(error?.message||'DELIVERY_UNCERTAIN').slice(0,100);
   run("UPDATE consecom_offer_references SET state='UNKNOWN',reason=?,updated_at=? WHERE lead_id=? AND state='SENDING'",reason,now(),item.lead_id);
   audit('OFFER_AB_REFERENCES_UNKNOWN',item.lead_id,{reason,manualReview:true});
   return {state:'UNKNOWN',reason};
  }
 }finally{referencesTicking=false;}
}
