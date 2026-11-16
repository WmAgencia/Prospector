// Read-only targeted rescue preflight. Never sends or changes a lead.
import {all,one} from './db.mjs';
import {waSessionList,waRequest} from './waakg-control.mjs';
import {boundLeadSession} from './waakg-session-registry.mjs';
import {conversationAuthorized} from './operator-outreach.mjs';
import {wantsPortfolioPitchAudio} from './portfolio-pitch-audio.mjs';
import {acceptsProposalAudio} from './prospector-sales-signals.mjs';
import {asksAboutProposal,PITCH_PREVIEW_TEXT} from './prospecting-introduction.mjs';

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
  if(leads.length!==1){out.push({...obj,status:'AMBIGUOUS_OR_MISSING'});continue;}
  const lead=leads[0],session=active[0];
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
  if(!accepted){out.push({...obj,status:'NO_CLEAR_REQUEST_FOR_AUDIO'});continue;}
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
   safeText(m.content)!==PITCH_PREVIEW_TEXT);
  const localAudio=one("SELECT 1 FROM messages WHERE thread_id=? AND direction='out' AND (provider_id LIKE 'intro-voice:%' OR type='audio' OR body LIKE '%Áudio original%' OR provider_id LIKE 'owner-whatsapp:%') LIMIT 1",lead.thread_id);
  obj.remoteMessages=recent.length;obj.remoteAudio=audio.length;obj.remotePreview=preview.length;obj.extraOutboundAfterLatestReply=recentManual.length;obj.localAudioRecord=!!localAudio;
  obj.canSendAudio=audio.length===0&&!localAudio&&recentManual.length===0;
  obj.canSendPreview=preview.length===0&&recentManual.length===0;
  obj.status=audio.length||localAudio?'AUDIO_ALREADY_EXISTS':recentManual.length?'OWNER_OR_AUTOMATION_ALREADY_REPLIED':'ELIGIBLE_MISSING_AUDIO';
  out.push(obj);
 }
 return {sender7336Connected:active.length===1,registered7336Matches:active.length,results:out};
}
