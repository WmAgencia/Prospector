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
import {offerVariantForOrdinal} from './consecom-offer-rotation.mjs';

const KEY='consecom_offer_ab_2026_v1';
const allowed=()=>!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true';
const outreachPaused=()=>ownerProspectionPaused()||getSetting('paused',true)===true;
const daySP=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const isMonday=d=>new Date(d+'T12:00:00Z').getUTCDay()===1;
// The text variant uses the transcribed original audio, not a separate sales pitch.
export {OFFER_AB_TEXT} from './consecom-offer-copy.mjs';
import {OFFER_AB_TEXT} from './consecom-offer-copy.mjs';

db.exec("CREATE TABLE IF NOT EXISTS consecom_offer_ab(lead_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,variant TEXT NOT NULL CHECK(variant IN ('AUDIO','TEXT')),phase INTEGER NOT NULL,provider_id TEXT UNIQUE NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,sent_at TEXT,updated_at TEXT NOT NULL,reason TEXT)");
db.exec("CREATE INDEX IF NOT EXISTS ix_consecom_offer_ab_variant ON consecom_offer_ab(variant,status,sent_at)");
run("UPDATE consecom_offer_ab SET status='UNKNOWN',reason='Send interrupted; do not resend without manual verification',updated_at=? WHERE status='SENDING'",now());
const baseConfig={enabled:false,audioMediaId:null,deadlineMonday:null,confirmedAt:null,startDate:null,rotationDays:7};
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
function deadlineReady(c,at=new Date()){
 if(!datePattern.test(c.deadlineMonday||'')||!isMonday(c.deadlineMonday))return false;
 const today=daySP(at),days=Math.round((Date.parse(c.deadlineMonday)-Date.parse(today))/86400000);
 // "na segunda-feira" in the original audio is meaningful ONLY while that
 // delivery is upcoming. Fail closed after expiry rather than alter the audio.
 return days>=0&&days<=7&&!!c.confirmedAt;
}
export function offerAbConfig(){
 const c=config(),asset=mediaRecord(c),sessions=managedSessions();
 return {enabled:c.enabled,paused:outreachPaused(),assetReady:!!asset,audioMediaId:c.audioMediaId,
  deadlineMonday:c.deadlineMonday,deadlineReady:deadlineReady(c),startDate:c.startDate,
  rotationDays:c.rotationDays,sessionA:sessions[0]?.label||null,sessionB:sessions[1]?.label||null,
  availableSessions:sessions.length,ready:allowed()&&c.enabled&&!outreachPaused()&&!!asset&&sessions.length>=1&&deadlineReady(c)};
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
 return {available:true,config:c,counts:totals,metrics,design:'alternating eligible leads in chronological assignment order, AUDIO then TEXT, independent of WhatsApp session',note:'No spam-evasion guarantees; measure only permission-based conversations'};
}
export function attachOriginalAbAudio(mediaId){
 if(!allowed())throw Error('CONSECOM_ONLY');
 const audioMediaId=String(mediaId||'');
 const candidate=mediaRecord({...config(),audioMediaId});
 if(!candidate)throw Error('Envie o áudio OGG original para a biblioteca antes de selecioná-lo.');
 const c={...config(),audioMediaId,enabled:false};
 setSetting(KEY,c);audit('OFFER_AB_AUDIO_REGISTERED',null,{mediaId:audioMediaId,bytes:candidate.bytes});
 return offerAbStatus();
}
export function setOfferAbPlan({deadlineMonday,startDate,enabled=false}={}){
 if(!allowed())throw Error('CONSECOM_ONLY');
 const delivery=String(deadlineMonday||'').trim(),start=String(startDate||daySP(new Date())).trim();
 if(!datePattern.test(delivery)||!isMonday(delivery))throw Error('Informe uma segunda-feira real para a promessa gravada no áudio.');
 if(!datePattern.test(start))throw Error('Informe a data inicial AAAA-MM-DD.');
 const next={...config(),deadlineMonday:delivery,confirmedAt:now(),startDate:start,enabled:enabled===true};
 if(next.enabled&&(!mediaRecord(next)||outreachPaused()))throw Error('Não é possível ativar enquanto pausado ou sem áudio cadastrado.');
 setSetting(KEY,next);
 audit('OFFER_AB_PLAN_SAVED',null,{enabled:next.enabled,deadlineMonday:next.deadlineMonday,startDate:next.startDate});
 return offerAbStatus();
}
export function offerAbDecision({leadId,sessionId,at=new Date()}={}){
 if(!allowed())return {eligible:false,reason:'CONSECOM_ONLY'};
 const c=config();
 if(!c.enabled)return {eligible:false,reason:'EXPERIMENT_DISABLED'};
 if(outreachPaused())return {eligible:false,reason:'OWNER_PAUSED'};
 if(!mediaRecord(c))return {eligible:false,reason:'AUDIO_NOT_READY'};
 if(!deadlineReady(c,at))return {eligible:false,reason:'MONDAY_CLAIM_UNVERIFIED_OR_EXPIRED'};
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
  run("UPDATE consecom_offer_ab SET status='SENT',sent_at=?,updated_at=? WHERE lead_id=? AND status='SENDING'",now(),now(),leadId);
  const thread=threadId?{id:threadId}:getThread(leadId,jid);
  addMessage({threadId:thread.id,providerId:recordId,direction:'out',type:plan.variant==='AUDIO'?'audio':'text',
   body:plan.variant==='AUDIO'?'[Áudio original de proposta Consecom — variante A/B]':plan.body,status:'sent'});
  audit('OFFER_AB_SENT',leadId,{variant:plan.variant,phase:plan.phase,session:sessionId});
  return {state:'SENT',variant:plan.variant,phase:plan.phase};
 }catch(error){
  run("UPDATE consecom_offer_ab SET status='UNKNOWN',reason=?,updated_at=? WHERE lead_id=? AND status='SENDING'",
   String(error.message||'UNCERTAIN_DELIVERY').slice(0,95),now(),leadId);
  audit('OFFER_AB_SEND_UNKNOWN',leadId,{variant:plan.variant,needsReview:true});
  return {state:'UNKNOWN',variant:plan.variant,reason:'TRANSPORT_UNCERTAIN_NO_RETRY'};
 }
}
