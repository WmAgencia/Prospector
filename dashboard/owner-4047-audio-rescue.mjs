// Recovery for the one clearly consented 4047 voice proposal after the
// customer replied "Boa tarde Wesley, pode sim." to Wesley's sent question.
// Conservative: read provider history, never repeat accepted or uncertain sends.
import {one,run,now,audit,getSetting,setSetting} from './db.mjs';
import {conversationAuthorized} from './operator-outreach.mjs';
import {conversationFinished} from './prospect-terminal-conversation.mjs';
import {leadSession,isManagedSession} from './waakg-session-registry.mjs';
import {classifyContact} from './whatsapp-roles.mjs';
import {classifyOwnerProposalIntent,OWNER_PROPOSAL_INTENT} from './owner-proposal-interest.mjs';
import {ownerPitchStatus,enqueueOwnerPitch} from './owner-pitch-sequence.mjs';
import {approvedOwnerRecordingStatus} from './owner-approved-pitch.mjs';
import {waRequest} from './waakg-control.mjs';
const PHONE='5511948384047';
const SESSION='prospector-f5997b3d-687c-4d31-9878-d416369ad45a';
const MARKER='owner_4047_yes_audio_rescue_20261112_v1';
const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z ]/g,' ').replace(/\s+/g,' ').trim();
const timestamp=x=>typeof x==='number'?(x<1e12?x*1000:x):Date.parse(String(x||''));

export async function resumeConsented4047Audio({request=waRequest}={}){
 if(process.env.PROSPECTOR_TENANT_ID)return {state:'OTHER_TENANT'};
 if(process.env.RUN_OWNER_4047_AUDIO_RESCUE_ONCE!=='true')return {state:'DISABLED'};
 if(process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE==='true'||getSetting('paused',false)===true)return {state:'PAUSED'};
 if(getSetting(MARKER,false)===true)return {state:'ALREADY_RECOVERED'};
 const lead=one('SELECT id,phone,stage,contact_permission FROM leads WHERE phone=?',PHONE);
 if(!lead||lead.contact_permission!==1)return {state:'CONTACT_NOT_AUTHORIZED'};
 const intro=one('SELECT stage,session_id,greeting_id,sent_at FROM prospecting_introductions WHERE lead_id=?',lead.id);
 if(!intro||!['SENT','CONVERSING'].includes(intro.stage)||intro.session_id!==SESSION||!intro.sent_at)
  return {state:'INTRO_NOT_CONFIRMED',stage:intro?.stage||null};
 const existing=ownerPitchStatus(lead.id);
 if(existing)return {state:'PITCH_ALREADY_PRESENT',stage:existing.stage};
 if(!approvedOwnerRecordingStatus().ready)return {state:'OWNER_AUDIO_NOT_READY'};
 if(!isManagedSession(SESSION)||leadSession(lead.id)!==SESSION||
    classifyContact({jid:PHONE+'@s.whatsapp.net',sessionId:SESSION}).role!=='PROSPECT_APPROACHED'||
    !conversationAuthorized(lead.id)||conversationFinished(lead.id,SESSION)||
    one('SELECT 1 FROM suppressions WHERE phone=?',PHONE)||
    one('SELECT 1 FROM threads WHERE lead_id=? AND manual_takeover=1',lead.id)||
    ['NO_INTEREST','INTERESTED','CLOSED_WON'].includes(lead.stage))
  return {state:'CONTACT_NOT_ELIGIBLE'};
 const confirmedIntro=one("SELECT 1 FROM messages m JOIN threads t ON m.thread_id=t.id WHERE t.lead_id=? AND m.provider_id=? AND m.direction='out' AND lower(m.status) IN ('sent','delivered','read')",
  lead.id,'intro:'+intro.greeting_id);
 if(!confirmedIntro)return {state:'WESLEY_INTRO_NOT_RECORDED'};
 const inbound=one('SELECT provider_id,body,state,received_at,session_id FROM waakg_inbox WHERE lead_id=? ORDER BY rowid DESC LIMIT 1',lead.id);
 if(!inbound||inbound.state!=='REVIEW'||inbound.session_id!==SESSION||
    clean(inbound.body)!=='boa tarde wesley pode sim'||
    classifyOwnerProposalIntent(inbound.body)!==OWNER_PROPOSAL_INTENT.ACCEPT||
    Date.parse(inbound.received_at)<=Date.parse(intro.sent_at))
  return {state:'NO_LATEST_EXPLICIT_CONSENT'};
 const age=Date.now()-Date.parse(inbound.received_at);
 if(!Number.isFinite(age)||age<0||age>90*60_000)return {state:'CONSENT_NEEDS_FRESH_REVIEW'};
 const laterOutbound=one("SELECT 1 FROM messages m JOIN threads t ON m.thread_id=t.id WHERE t.lead_id=? AND m.direction='out' AND m.at>=? LIMIT 1",lead.id,inbound.received_at);
 if(laterOutbound)return {state:'ALREADY_ANSWERED_LOCALLY'};
 let msgs=[];
 try{
  const reply=await request('/api/chat/'+encodeURIComponent(SESSION)+'/'+encodeURIComponent(PHONE+'@s.whatsapp.net'));
  if(reply.status===false||!Array.isArray(reply.data))return {state:'PROVIDER_HISTORY_NOT_VERIFIABLE'};
  msgs=reply.data;
 }catch(e){return {state:'PROVIDER_HISTORY_UNAVAILABLE',reason:String(e.message).slice(0,80)}}
 if(!msgs.length||msgs.at(-1)?.fromMe!==false)return {state:'PROVIDER_LAST_NOT_INBOUND'};
 if(msgs.some(m=>m.fromMe===true&&/audio|voice|ptt/i.test(String(m.type||''))))
  return {state:'PROVIDER_ALREADY_HAS_VOICE'};
 const when=Date.parse(inbound.received_at);
 if(msgs.some(m=>m.fromMe===true&&Number.isFinite(timestamp(m.timestamp||m.createdAt))&&timestamp(m.timestamp||m.createdAt)>=when-5_000))
  return {state:'PROVIDER_ALREADY_REPLIED'};
 const result=enqueueOwnerPitch({leadId:lead.id,sessionId:SESSION,providerId:inbound.provider_id,receivedAt:inbound.received_at});
 if(result.state!=='PENDING_AUDIO')return {state:'NOT_ENQUEUED',reason:result.state};
 run("UPDATE prospecting_introductions SET stage='VOICE_REVIEW',reason='OWNER_AUDIO_QUEUED',due_at=NULL,updated_at=? WHERE lead_id=? AND stage IN ('SENT','CONVERSING')",now(),lead.id);
 setSetting(MARKER,true);
 audit('OWNER_4047_EXPLICIT_AUDIO_CONSENT_RESCUED',lead.id,{
  suffix:'4047',senderSuffix:'2994',sameInbound:true,originalAudio:true,
  providerChecked:msgs.length,alreadySent:false,noDuplicateSend:true
 });
 return {state:'PENDING_AUDIO',suffix:'4047',senderSuffix:'2994',deliveryVerified:false};
}
