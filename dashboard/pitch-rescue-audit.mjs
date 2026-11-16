// Read-only targeted rescue preflight. Never sends or changes a lead.
import {all,one,run,now,audit} from './db.mjs';
import {waSessionList,waRequest} from './waakg-control.mjs';
import {boundLeadSession} from './waakg-session-registry.mjs';
import {conversationAuthorized} from './operator-outreach.mjs';
import {wantsPortfolioPitchAudio} from './portfolio-pitch-audio.mjs';
import {acceptsProposalAudio} from './prospector-sales-signals.mjs';
import {asksAboutProposal,WESLEY_INTRO,PITCH_PREVIEW_TEXT} from './prospecting-introduction.mjs';

export const RESCUE_SUFFIXES=['4772','7156','5150','0556','3668'];
const safeText=s=>String(s||'').replace(/\s+/g,' ').trim();
const asMs=t=>{const n=Number(t);return Number.isFinite(n)&&n>1e10?n:Number.isFinite(n)&&n>1e8?n*1000:Date.parse(t)||0;};
const voiceLike=m=>/VOICE|AUDIO|PTT/i.test(String(m?.type||''))||
 /audio/i.test(String(m?.mimeType||m?.mimetype||''));
export async function auditPitchRescue(){
 const sessions=await waSessionList();
 const active=sessions.items.filter(s=>s.connected&&s.numberSuffix==='7336');
 const out=[];
 for(const suffix of RESCUE_SUFFIXES){
  const leads=all("SELECT l.id,l.phone,l.stage,l.contact_permission,t.id AS thread_id,t.manual_takeover,p.stage AS intro_stage,p.reason AS intro_reason,p.created_at AS intro_at,p.sent_at AS intro_sent,p.followup_status FROM leads l LEFT JOIN threads t ON t.lead_id=l.id LEFT JOIN prospecting_introductions p ON p.lead_id=l.id WHERE substr(l.phone,-4)=?",suffix);
  const obj={suffix,matchCount:leads.length,senderMatches:active.length};
  const session=active[0];
  const scoped=leads.filter(l=>session&&boundLeadSession(l.id)===session.session_id);
  obj.scopedMatches=scoped.length;
  if(scoped.length!==1){out.push({...obj,status:'AMBIGUOUS_OR_MISSING_7336'});continue;}
  const lead=scoped[0];
  if(!session){out.push({...obj,status:'SENDER_7336_NOT_CONNECTED'});continue;}
  obj.stage=lead.stage;obj.intro=lead.intro_stage||null;obj.manual=lead.manual_takeover===1;
  const bound=boundLeadSession(lead.id);
  if(bound!==session.session_id){out.push({...obj,status:'WRONG_SENDER_SESSION',sessionBound:!!bound});continue;}
  if(obj.manual){out.push({...obj,status:'MANUAL_TAKEOVER'});continue;}
  if(!conversationAuthorized(lead.id)){out.push({...obj,status:'NOT_AUTHORIZED_FOR_FOLLOWUP'});continue;}
  if(!lead.thread_id){out.push({...obj,status:'NO_THREAD'});continue;}
  const latestInbound=one("SELECT body,at FROM messages WHERE thread_id=? AND direction='in' ORDER BY rowid DESC LIMIT 1",lead.thread_id);
  const accepted=latestInbound&&(wantsPortfolioPitchAudio(latestInbound.body)||acceptsProposalAudio(latestInbound.body)||asksAboutProposal(latestInbound.body));
  obj.proposalRequested=!!accepted;
  const lastIntro=one("SELECT at FROM messages WHERE thread_id=? AND provider_id LIKE 'intro:%' ORDER BY rowid DESC LIMIT 1",lead.thread_id);
  obj.repliedAfterTextIntro=!!(latestInbound&&lastIntro&&asMs(latestInbound.at)>asMs(lastIntro.at));
  const jid=lead.phone+'@s.whatsapp.net';
  let messages;
  try{
   const remote=await waRequest('/api/chat/'+encodeURIComponent(session.session_id)+'/'+encodeURIComponent(jid));
   if(!Array.isArray(remote?.data))throw Error('REMOTE_CHAT_UNAVAILABLE');
   messages=remote.data;
  }catch(error){out.push({...obj,status:'REMOTE_HISTORY_UNAVAILABLE',reason:String(error?.message||'unavailable').slice(0,75)});continue;}
  const inboundAt=asMs(latestInbound.at);
  const sinceIntro=asMs(lead.intro_at);
  const recent=messages.filter(m=>asMs(m.timestamp||m.createdAt)>Math.max(sinceIntro-60000,Date.now()-21*86400000));
  const audio=recent.filter(m=>m.fromMe===true&&voiceLike(m));
  const preview=recent.filter(m=>m.fromMe===true&&safeText(m.content)===PITCH_PREVIEW_TEXT);
  const recentManual=recent.filter(m=>m.fromMe===true&&asMs(m.timestamp||m.createdAt)>inboundAt&& !voiceLike(m) &&
   safeText(m.content)!==PITCH_PREVIEW_TEXT&&safeText(m.content)!==WESLEY_INTRO);
  const localAudio=one("SELECT 1 FROM messages WHERE thread_id=? AND direction='out' AND (provider_id LIKE 'intro-voice:%' OR type='audio' OR body LIKE '%Áudio original%' OR provider_id LIKE 'owner-whatsapp:%') LIMIT 1",lead.thread_id);
  obj.remoteMessages=recent.length;obj.remoteAudio=audio.length;obj.remotePreview=preview.length;obj.extraOutboundAfterLatestReply=recentManual.length;obj.localAudioRecord=!!localAudio;
  obj.canSendAudio=audio.length===0&&!localAudio&&recentManual.length===0;
  obj.canSendPreview=preview.length===0&&recentManual.length===0;
  obj.status=audio.length||localAudio?'AUDIO_ALREADY_EXISTS':recentManual.length?'OWNER_OR_AUTOMATION_ALREADY_REPLIED':'ELIGIBLE_MISSING_AUDIO';
  out.push(obj);
 }
 return {sender7336Connected:active.length===1,registered7336Matches:active.length,results:out};
}

let rescueBusy=false;
// The operator explicitly selected these five existing, replied-to conversations.
// Only queues the approved existing sequence. The established workers send the
// original recorded audio and the 10s preview, with manual takeover guards.
export async function queueVerifiedPitchRescue(){
 if(rescueBusy)return {state:'BUSY'};
 rescueBusy=true;
 try{
  const auditResult=await auditPitchRescue(),items=[];
  if(auditResult.sender7336Connected!==true||auditResult.registered7336Matches!==1)
   return {state:'ABORT',reason:'SENDER_7336_NOT_UNIQUE'};
  // Exact five only, no suffix fuzzy-matching; fail closed if a conversation
  // changed, was manually taken over, or WhatsApp history is inaccessible.
  const list=auditResult.results;
  const ok=list.length===5&&list.every(r=>RESCUE_SUFFIXES.includes(r.suffix)&&r.scopedMatches===1&&
    r.status==='ELIGIBLE_MISSING_AUDIO'&&r.repliedAfterTextIntro===true&&
    r.canSendAudio===true&&r.canSendPreview===true&&r.intro==='SENT');
  if(!ok)return {state:'ABORT',reason:'PREFLIGHT_NOT_ALL_ELIGIBLE',results:list.map(r=>({suffix:r.suffix,status:r.status,replied:r.repliedAfterTextIntro||false,intro:r.intro}))};
  const sessions=await waSessionList(),sender=sessions.items.find(s=>s.connected&&s.numberSuffix==='7336');
  if(!sender)return {state:'ABORT',reason:'SENDER_DISCONNECTED'};
  // Reserve in the same transaction. No worker can pick a partial batch.
  const stamp=now(),due=new Date().toISOString();
  const records=[];
  for(const suffix of RESCUE_SUFFIXES){
   const rows=all("SELECT p.lead_id,l.phone,t.manual_takeover,p.stage FROM prospecting_introductions p JOIN leads l ON l.id=p.lead_id JOIN threads t ON t.lead_id=l.id WHERE substr(l.phone,-4)=? AND p.session_id=?",suffix,sender.session_id);
   if(rows.length!==1||rows[0].stage!=='SENT'||rows[0].manual_takeover===1) return {state:'ABORT',reason:'ROW_CHANGED',suffix};
   records.push({...rows[0],suffix});
  }
  // One last guard immediately before reservation.
  if(records.some(r=>!conversationAuthorized(r.lead_id)||boundLeadSession(r.lead_id)!==sender.session_id))
   return {state:'ABORT',reason:'AUTHORIZATION_CHANGED'};
  let queued=0;
  for(const r of records){
   const written=run("UPDATE prospecting_introductions SET stage='VOICE_WAITING',due_at=?,first_reply_at=COALESCE(first_reply_at,?),reason='ONE_TIME_OWNER_RESCUE',updated_at=? WHERE lead_id=? AND stage='SENT' AND session_id=? AND EXISTS (SELECT 1 FROM threads t WHERE t.lead_id=? AND t.manual_takeover=0)",
    due,stamp,stamp,r.lead_id,sender.session_id,r.lead_id).changes;
   if(written===1){queued++;audit('OWNER_PITCH_RESCUE_QUEUED',r.lead_id,{recipientSuffix:r.suffix,senderSuffix:'7336',previewDelaySeconds:10});}
   items.push({suffix:r.suffix,queued:written===1});
  }
  return {state:queued===5?'QUEUED':'PARTIAL',queued,items};
 }finally{rescueBusy=false;}
}
export function pitchRescueLiveStatus(){
 const rows=RESCUE_SUFFIXES.map(suffix=>{
  const records=all("SELECT p.stage,p.reason,p.followup_status,p.sent_at,p.followup_sent_at FROM prospecting_introductions p JOIN leads l ON l.id=p.lead_id WHERE substr(l.phone,-4)=? AND p.session_id IN (SELECT session_id FROM managed_whatsapp_sessions UNION SELECT value FROM settings WHERE key='waakg_primary_session_id')",suffix);
  return {suffix,count:records.length,stages:records.map(r=>({stage:r.stage,reason:r.reason,followup:r.followup_status,audioAccepted:!!r.sent_at,previewAccepted:!!r.followup_sent_at}))};
 });
 return rows;
}
