// Persistent, at-most-once media ledger for Consecom's approved R$ 550 sequence.
// A successful WA-AKG HTTP response is not proof of handset delivery.
// Do not resend after timeouts, restarts, missing history or ambiguous receipts.
import {db,one,all,run,now,audit} from './db.mjs';
import {waRequest} from './waakg-control.mjs';
import {isManagedSession,leadSession} from './waakg-session-registry.mjs';
import {queueNotice} from './notifications.mjs';
import {acceptsProposalAudio} from './prospector-sales-signals.mjs';
import {wantsPortfolioPitchAudio} from './portfolio-pitch-audio.mjs';
import {CAMPAIGN_VIDEO_CAPTION} from './consecom-flow.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS pitch_delivery_receipts(
 lead_id TEXT NOT NULL REFERENCES leads(id),
 greeting_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('AUDIO','VIDEO')),
 session_id TEXT NOT NULL,
 jid TEXT NOT NULL,
 attempted_at TEXT NOT NULL,
 provider_id TEXT,
 status TEXT NOT NULL,
 last_checked_at TEXT,
 confirmed_at TEXT,
 delivered_at TEXT,
 read_at TEXT,
 alerted_at TEXT,
 error TEXT,
 PRIMARY KEY(lead_id,greeting_id,kind))`);
db.exec('CREATE INDEX IF NOT EXISTS idx_pitch_receipt_check ON pitch_delivery_receipts(status,last_checked_at)');
// A crash during network I/O is ambiguous. Preserve the single-attempt rule.
run("UPDATE pitch_delivery_receipts SET status='UNKNOWN',error='Process interrupted before send acknowledgement' WHERE status='SENDING'");
const validId=s=>/^[A-Za-z0-9_-]{5,150}$/.test(String(s||''));
const cleanStatus=s=>String(s||'').toUpperCase();
const ageMs=t=>{const n=Number(t);return Number.isFinite(n)&&n>1e11?n:Number.isFinite(n)&&n>1e8?n*1000:(Date.parse(t)||0);};
const delivered=new Set(['DELIVERED','READ']);
const terminal=new Set(['READ','CANCELLED']);
const expectedType=(type,kind)=>kind==='AUDIO'?['AUDIO','VOICE','PTT'].includes(cleanStatus(type)):cleanStatus(type)==='VIDEO';

export function beginPitchDelivery({leadId,greetingId,kind,sessionId,jid}={}){
 if(!['AUDIO','VIDEO'].includes(kind)||!isManagedSession(sessionId)||leadSession(leadId)!==sessionId||
   !/^\d{10,15}@s\.whatsapp\.net$/.test(jid||'')||
   one('SELECT phone FROM leads WHERE id=?',leadId)?.phone!==jid.split('@')[0])
  throw Error('PITCH_RECEIPT_INVALID_ROUTE');
 const introduction=one('SELECT greeting_id,stage,followup_status FROM prospecting_introductions WHERE lead_id=?',leadId);
 if(!introduction||introduction.greeting_id!==greetingId||
   (kind==='AUDIO'&&introduction.stage!=='SENDING')||
   (kind==='VIDEO'&&introduction.followup_status!=='SENDING'))
  throw Error('PITCH_RECEIPT_NOT_RESERVED');
 const inserted=run("INSERT OR IGNORE INTO pitch_delivery_receipts(lead_id,greeting_id,kind,session_id,jid,attempted_at,status) VALUES(?,?,?,?,?,?,'SENDING')",
  leadId,greetingId,kind,sessionId,jid,now()).changes;
 if(inserted!==1)throw Error('PITCH_DUPLICATE_BLOCKED');
 return true;
}
export function acknowledgePitchDelivery({leadId,greetingId,kind,providerId}={}){
 const id=validId(providerId)?String(providerId):null;
 run("UPDATE pitch_delivery_receipts SET provider_id=COALESCE(provider_id,?),status=CASE WHEN status IN ('READ','DELIVERED','SENT') THEN status ELSE 'ACCEPTED' END,error=CASE WHEN ? IS NULL THEN 'Gateway accepted without message ID' ELSE NULL END WHERE lead_id=? AND greeting_id=? AND kind=? AND status NOT IN ('CANCELLED')",
  id,id,leadId,greetingId,kind);
 return {messageIdKnown:!!id};
}
export function unknownPitchDelivery({leadId,greetingId,kind,reason='UNKNOWN_TRANSPORT'}={}){
 run("UPDATE pitch_delivery_receipts SET status=CASE WHEN status IN ('READ','DELIVERED','SENT') THEN status ELSE 'UNKNOWN' END,error=? WHERE lead_id=? AND greeting_id=? AND kind=?",
  String(reason||'UNKNOWN').slice(0,110),leadId,greetingId,kind);
}
export function cancelPitchDelivery({leadId,greetingId,kind,reason='OWNER_TAKEOVER'}={}){
 run("UPDATE pitch_delivery_receipts SET status='CANCELLED',error=? WHERE lead_id=? AND greeting_id=? AND kind=? AND status='SENDING'",
  String(reason||'CANCELLED').slice(0,110),leadId,greetingId,kind);
}
export function pitchDeliveryReceipt(leadId,greetingId,kind){
 return one('SELECT * FROM pitch_delivery_receipts WHERE lead_id=? AND greeting_id=? AND kind=?',leadId,greetingId,kind)||null;
}
function updateStatus(record,status,providerId=null){
 const next=cleanStatus(status);
 if(!['SENT','DELIVERED','READ','FAILED'].includes(next))return false;
 if(record.status==='READ'||(record.status==='DELIVERED'&&next!=='READ')||record.status==='CANCELLED')return false;
 if(record.provider_id&&providerId&&record.provider_id!==providerId)return false;
 const stamp=now();
 run(`UPDATE pitch_delivery_receipts SET status=?,provider_id=COALESCE(provider_id,?),
  confirmed_at=COALESCE(confirmed_at,?),delivered_at=CASE WHEN ? IN ('DELIVERED','READ') THEN COALESCE(delivered_at,?) ELSE delivered_at END,
  read_at=CASE WHEN ?='READ' THEN COALESCE(read_at,?) ELSE read_at END,error=NULL
  WHERE lead_id=? AND greeting_id=? AND kind=? AND status NOT IN ('CANCELLED','READ')`,
  next,providerId,stamp,next,stamp,next,stamp,record.lead_id,record.greeting_id,record.kind);
 if(next!==record.status)audit('PITCH_DELIVERY_STATUS',record.lead_id,{kind:record.kind,status:next,sender:record.session_id,deviceDelivered:delivered.has(next)});
 return true;
}
// Gateway webhook updates refer to the exact Baileys message ID, never just the
// recipient number. An unrelated/manual message cannot satisfy an operation.
export function receivePitchDeliveryStatus(payload={}){
 const event=String(payload.event||''),data=payload.data||{};
 if(!['message.sent','message.status'].includes(event))return false;
 const sessionId=String(payload.sessionId||''),providerId=String(data.keyId||data.key?.id||'');
 if(!isManagedSession(sessionId)||!validId(providerId))return false;
 const receipt=one('SELECT * FROM pitch_delivery_receipts WHERE session_id=? AND provider_id=?',sessionId,providerId);
 if(!receipt)return false;
 if(event==='message.status'&&data.remoteJid&&String(data.remoteJid)!==receipt.jid)return false;
 const status=event==='message.sent'?'SENT':cleanStatus(data.status);
 // The correlation itself is authoritative for origin, even when a late SENT
 // event is ignored because DELIVERED/READ was already recorded.
 updateStatus(receipt,status,providerId);
 return true;
}
const remoteId=m=>String(m.keyId||m.key?.id||'');
// WA-AKG persists outgoing messages with status=PENDING until a receipt arrives.
// Matching an exact Baileys message ID in its OWN outbound history confirms
// the message was sent into WhatsApp, but does NOT prove handset delivery.
const chatStatus=m=>{
 const raw=cleanStatus(m?.status);
 if(raw==='PENDING'&&m?.fromMe===true&&validId(remoteId(m)))return 'SENT';
 return ['SENT','DELIVERED','READ','FAILED'].includes(raw)?raw:null;
};
export function matchPitchHistory(record,messages=[]){
 const pool=messages.filter(m=>m.fromMe===true&&expectedType(m.type,record.kind));
 if(record.provider_id){
  const exact=pool.find(m=>remoteId(m)===record.provider_id);
  return exact?{state:'EXACT',message:exact}:{state:'NOT_FOUND'};
 }
 // Without an ID we cannot prove which media the gateway accepted. Report a
 // potential match for operator review; NEVER treat it as a safe retry signal.
 const start=ageMs(record.attempted_at),end=start+5*60_000;
 const candidates=pool.filter(m=>{
  const at=ageMs(m.timestamp||m.createdAt);
  if(!at||at<start-30_000||at>end)return false;
  return record.kind!=='VIDEO'||String(m.content||m.caption||'').trim()===CAMPAIGN_VIDEO_CAPTION.trim();
 });
 if(candidates.length===1){
  const found=candidates[0],msgId=remoteId(found);
  // The approved video has an exact caption; one matching outbound message
  // inside the original send window can be identified without duplicating it.
  // Audio has no content hash in the gateway database: treat it as POSSIBLE.
  if(record.kind==='VIDEO'&&validId(msgId)&&
    String(found.content||found.caption||'').trim()===CAMPAIGN_VIDEO_CAPTION.trim())
   return {state:'EXACT_CAPTION',message:found};
  return {state:'POSSIBLE',message:found};
 }
 return {state:candidates.length>1?'AMBIGUOUS':'NOT_FOUND'};
}
function maybeAlert(record,reason){
 const elapsed=Date.now()-ageMs(record.attempted_at);
 if(record.alerted_at||terminal.has(record.status))return false;
 // Device-delivery receipts may be delayed while a phone is offline.
 const limit=reason==='NOT_DELIVERED_TO_PHONE'?15*60_000:3*60_000;
 if(elapsed<limit)return false;
 const lead=one('SELECT phone,business,stage FROM leads WHERE id=?',record.lead_id);
 if(!lead)return false;
 const message=[
  '*Prospector — conferir entrega '+(record.kind==='AUDIO'?'do áudio':'do vídeo')+'*',
  'Empresa: '+String(lead.business||'').slice(0,85),
  'Destino: '+lead.phone,
  'WhatsApp de origem: '+record.session_id,
  'Situação: '+(reason==='NOT_DELIVERED_TO_PHONE'?'WhatsApp não confirmou entrega no aparelho':reason==='POSSIBLE'?'Mídia encontrada, mas sem ID comprovado':'Envio sem confirmação conclusiva'),
  'Conversa: https://wa.me/'+lead.phone,
  'Não reenviar automaticamente: conferir ID, histórico e status de entrega para evitar duplicação.'
 ].join('\n');
 const queued=queueNotice('pitch-receipt:'+record.greeting_id+':'+record.kind,'PITCH_DELIVERY_ISSUE',message,record.lead_id);
 if(queued){run('UPDATE pitch_delivery_receipts SET alerted_at=? WHERE lead_id=? AND greeting_id=? AND kind=?',now(),record.lead_id,record.greeting_id,record.kind);return true;}
 return false;
}
let active=false;
export async function reconcilePitchDeliveries({fetchChat=waRequest,limit=4}={}){
 if(active)return {state:'BUSY'};
 active=true;
 try{
  const ordinaryBefore=new Date(Date.now()-45_000).toISOString();
  const activeBefore=new Date(Date.now()-7_000).toISOString();
  // The approved video is waiting for its audio's confirmation. Reconcile
  // these audio receipts FIRST so old unrelated media cannot starve the queue.
  const rows=all(`SELECT * FROM pitch_delivery_receipts r WHERE r.status NOT IN ('READ','CANCELLED')
   AND r.attempted_at>=?
   AND (
    (r.kind='AUDIO' AND EXISTS(
     SELECT 1 FROM prospecting_introductions p
     WHERE p.lead_id=r.lead_id AND p.greeting_id=r.greeting_id
      AND p.stage='VOICE_SENT' AND p.followup_status='WAITING'
    ) AND (r.last_checked_at IS NULL OR r.last_checked_at<?))
    OR (r.last_checked_at IS NULL OR r.last_checked_at<?)
   )
   ORDER BY CASE WHEN r.kind='AUDIO' AND EXISTS(
     SELECT 1 FROM prospecting_introductions p
     WHERE p.lead_id=r.lead_id AND p.greeting_id=r.greeting_id
      AND p.stage='VOICE_SENT' AND p.followup_status='WAITING'
    ) THEN 0 ELSE 1 END,
    COALESCE(r.last_checked_at,r.attempted_at)
   LIMIT ?`,
   new Date(Date.now()-7*86400000).toISOString(),activeBefore,ordinaryBefore,
   Math.max(1,Math.min(8,Number(limit)||4)));
  let checked=0,alerts=0;
  for(const record of rows){
   run('UPDATE pitch_delivery_receipts SET last_checked_at=? WHERE lead_id=? AND greeting_id=? AND kind=?',now(),record.lead_id,record.greeting_id,record.kind);
   let verdict='UNAVAILABLE';
   try{
    if(!isManagedSession(record.session_id)||leadSession(record.lead_id)!==record.session_id)throw Error('SESSION_MISMATCH');
    const chat=await fetchChat('/api/chat/'+encodeURIComponent(record.session_id)+'/'+encodeURIComponent(record.jid));
    if(!Array.isArray(chat?.data))throw Error('CHAT_UNAVAILABLE');
    const matched=matchPitchHistory(record,chat.data);verdict=matched.state;
    if(matched.state==='EXACT'&&chatStatus(matched.message))updateStatus(record,chatStatus(matched.message),record.provider_id);
    if(matched.state==='EXACT_CAPTION'){
     const msgId=remoteId(matched.message);
     const added=run("UPDATE pitch_delivery_receipts SET provider_id=? WHERE lead_id=? AND greeting_id=? AND kind='VIDEO' AND provider_id IS NULL",
      msgId,record.lead_id,record.greeting_id).changes;
     const state=chatStatus(matched.message)||'SENT';
     updateStatus({...record,provider_id:msgId},state,msgId);
     if(added)audit('PITCH_VIDEO_FOUND_IN_WHATSAPP',record.lead_id,{greetingId:record.greeting_id,messageId:msgId,status:state});
    }
    if(matched.state==='POSSIBLE')run("UPDATE pitch_delivery_receipts SET error='Possible match without gateway message ID; manual review' WHERE lead_id=? AND greeting_id=? AND kind=?",
     record.lead_id,record.greeting_id,record.kind);
   }catch(error){verdict='UNAVAILABLE';}
   const latest=pitchDeliveryReceipt(record.lead_id,record.greeting_id,record.kind)||record;
   const warn=latest.status==='FAILED'?'FAILED':verdict==='POSSIBLE'?'POSSIBLE':
    delivered.has(latest.status)?'':verdict==='EXACT'?'NOT_DELIVERED_TO_PHONE':'NOT_CONFIRMED';
   if(warn&&maybeAlert(latest,warn))alerts++;
   checked++;
  }
  return {state:'OK',checked,alerts};
 }finally{active=false;}
}
// Accepted answers can be stranded before the voice worker even reserves a send.
// Surface them rather than silently skipping or sending blind duplicates.
// Repair explicit, unprocessed "yes, send the audio" replies when NO media
// transport was ever attempted. History must include the original text intro
// and no intervening outbound message. Ambiguity is escalated, never retried.
export async function recoverVerifiedUnattemptedPitch({fetchChat=waRequest,limit=2}={}){
 const {ownerProspectionPaused}=await import('./prospection-pause.mjs');
 const {conversationAuthorized}=await import('./operator-outreach.mjs');
 if(ownerProspectionPaused())return {state:'PAUSED'};
 const cutoff=new Date(Date.now()-48*3600_000).toISOString();
 const minAge=new Date(Date.now()-90_000).toISOString();
 const rows=all("SELECT p.lead_id,p.greeting_id,p.session_id,p.phone,p.sent_at FROM prospecting_introductions p JOIN leads l ON l.id=p.lead_id JOIN threads t ON t.lead_id=p.lead_id WHERE p.stage='SENT' AND p.sent_at>=? AND p.sent_at<? AND t.manual_takeover=0 AND l.stage NOT IN ('INTERESTED','NO_INTEREST','CLOSED_WON') ORDER BY p.sent_at DESC LIMIT 80",cutoff,minAge);
 let queued=0,review=0;
 for(const p of rows){
  if(queued>=Math.max(1,Math.min(3,Number(limit)||2)))break;
  if(!conversationAuthorized(p.lead_id)||!isManagedSession(p.session_id)||leadSession(p.lead_id)!==p.session_id)continue;
  if(one('SELECT 1 FROM pitch_delivery_receipts WHERE lead_id=? AND greeting_id=? AND kind=\'AUDIO\'',p.lead_id,p.greeting_id))continue;
  if(one('SELECT phone FROM suppressions WHERE phone=?',p.phone))continue;
  const reply=one("SELECT provider_id,body,received_at FROM waakg_inbox WHERE lead_id=? AND session_id=? AND received_at>=? ORDER BY received_at DESC LIMIT 1",p.lead_id,p.session_id,p.sent_at);
  if(!reply||!(acceptsProposalAudio(reply.body)||wantsPortfolioPitchAudio(reply.body)))continue;
  const intro=one("SELECT m.rowid AS rowid,m.body FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.lead_id=? AND m.provider_id=? AND m.direction='out'",p.lead_id,'intro:'+p.greeting_id);
  if(!intro||!intro.body)continue;
  const newer=one("SELECT 1 FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.lead_id=? AND m.rowid>? AND m.direction='out' LIMIT 1",p.lead_id,intro.rowid);
  if(newer)continue;
  let history=null;
  try{
   const response=await fetchChat('/api/chat/'+encodeURIComponent(p.session_id)+'/'+encodeURIComponent(p.phone+'@s.whatsapp.net'));
   if(Array.isArray(response?.data))history=response.data;
  }catch{}
  if(!history){review++;continue;}
  const expected=String(intro.body).replace(/\s+/g,' ').trim();
  const sentAt=ageMs(p.sent_at);
  const confirmedIntro=history.find(m=>m.fromMe===true&&cleanStatus(m.type)==='TEXT'&&
   String(m.content||'').replace(/\s+/g,' ').trim()===expected&&Math.abs(ageMs(m.timestamp)-sentAt)<4*60_000);
  if(!confirmedIntro){review++;continue;}
  const laterOutbound=history.some(m=>m.fromMe===true&&ageMs(m.timestamp)>ageMs(confirmedIntro.timestamp)+1000);
  if(laterOutbound){review++;continue;}
  const due=new Date(Math.max(Date.now(),ageMs(reply.received_at)+30_000)).toISOString();
  // Revalidate after the remote I/O, including fresh operator takeovers/opt-outs.
  const changed=run("UPDATE prospecting_introductions SET stage='VOICE_WAITING',due_at=?,updated_at=? WHERE lead_id=? AND greeting_id=? AND session_id=? AND stage='SENT' AND EXISTS(SELECT 1 FROM threads t WHERE t.lead_id=? AND t.manual_takeover=0) AND EXISTS(SELECT 1 FROM leads l WHERE l.id=? AND l.stage NOT IN ('NO_INTEREST','INTERESTED','CLOSED_WON')) AND NOT EXISTS(SELECT 1 FROM pitch_delivery_receipts r WHERE r.lead_id=? AND r.greeting_id=? AND r.kind='AUDIO')",
   due,now(),p.lead_id,p.greeting_id,p.session_id,p.lead_id,p.lead_id,p.lead_id,p.greeting_id).changes;
  if(changed===1){
   queued++;
   audit('PITCH_CONSENT_AUTO_RECOVERED',p.lead_id,{session:p.session_id,source:'verified_whatsapp_history',dueAt:due});
  }
 }
 return {state:'CHECKED',candidates:rows.length,queued,review};
}

export function auditStuckPitchSteps(){
 const cutoff=new Date(Date.now()-3*60_000).toISOString();
 let flagged=0;
 const waiting=all("SELECT p.lead_id,p.greeting_id,p.session_id,p.stage,p.due_at,l.phone,l.business FROM prospecting_introductions p JOIN leads l ON l.id=p.lead_id JOIN threads t ON t.lead_id=p.lead_id WHERE p.stage='VOICE_WAITING' AND p.due_at<? AND t.manual_takeover=0 AND l.stage NOT IN ('NO_INTEREST','INTERESTED','CLOSED_WON') ORDER BY p.due_at LIMIT 20",cutoff);
 for(const p of waiting){
  const msg='*Prospector — áudio autorizado, mas não enviado*\nEmpresa: '+p.business+'\nDestino: '+p.phone+'\nConversa: https://wa.me/'+p.phone+'\nEnvio ainda pendente. Conferir o WhatsApp antes de qualquer recuperação.';
  if(queueNotice('pitch-voice-wait:'+p.greeting_id,'PITCH_DELIVERY_ISSUE',msg,p.lead_id))flagged++;
 }
 const sent=all("SELECT p.lead_id,p.greeting_id,p.session_id,p.sent_at,l.phone,l.business FROM prospecting_introductions p JOIN leads l ON l.id=p.lead_id JOIN threads t ON t.lead_id=p.lead_id WHERE p.stage='SENT' AND p.sent_at<? AND t.manual_takeover=0 AND l.stage NOT IN ('NO_INTEREST','INTERESTED','CLOSED_WON') ORDER BY p.sent_at DESC LIMIT 80",
 cutoff);
 for(const p of sent){
  const replies=all("SELECT body FROM waakg_inbox WHERE lead_id=? AND session_id=? AND received_at>=? AND state='REVIEW' ORDER BY received_at DESC LIMIT 8",p.lead_id,p.session_id,p.sent_at);
  if(!replies.some(r=>acceptsProposalAudio(r.body)||wantsPortfolioPitchAudio(r.body)))continue;
  const msg='*Prospector — cliente autorizou áudio, porém o fluxo não avançou*\nEmpresa: '+p.business+'\nDestino: '+p.phone+'\nConversa: https://wa.me/'+p.phone+'\nConfirmar histórico antes de reprogramar o áudio.';
  if(queueNotice('pitch-consent-stuck:'+p.greeting_id,'PITCH_DELIVERY_ISSUE',msg,p.lead_id))flagged++;
 }
 const videos=all("SELECT p.lead_id,p.greeting_id,p.session_id,p.followup_status,p.reason,l.phone,l.business FROM prospecting_introductions p JOIN leads l ON l.id=p.lead_id JOIN threads t ON t.lead_id=p.lead_id WHERE p.stage='VOICE_SENT' AND p.sent_at<? AND p.reason IN ('PITCH_AUDIO_550','FOLLOWUP_WINDOW_EXPIRED') AND (p.followup_status IN ('CANCELLED','UNKNOWN') OR (p.followup_status='WAITING' AND p.followup_due_at<?)) AND t.manual_takeover=0 AND l.stage NOT IN ('NO_INTEREST','INTERESTED','CLOSED_WON') ORDER BY p.sent_at DESC LIMIT 60",cutoff,cutoff);
 for(const p of videos){
  const msg='*Prospector — verificar vídeo após áudio*\nEmpresa: '+p.business+'\nDestino: '+p.phone+'\nEstado: '+p.followup_status+'\nConversa: https://wa.me/'+p.phone+'\nNão enviar segunda cópia sem verificar a primeira.';
  if(queueNotice('pitch-missing-video:'+p.greeting_id,'PITCH_DELIVERY_ISSUE',msg,p.lead_id))flagged++;
 }
 return {flagged,waiting:waiting.length,consentCandidates:sent.length,videoCandidates:videos.length};
}
export function pitchDeliverySummary(){
 const rows=all('SELECT kind,status,COUNT(*) AS total FROM pitch_delivery_receipts GROUP BY kind,status');
 return {statuses:rows,unconfirmed:rows.filter(r=>!['READ','DELIVERED','CANCELLED'].includes(r.status)).reduce((s,r)=>s+r.total,0),meaning:'SENT is not a handset-delivery guarantee'};
}
