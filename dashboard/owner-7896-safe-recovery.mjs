// Explicit recovery of one known pre-transport failure: ffprobe could not
// measure the approved voice file, so no recording presence or media send began.
// Never retry ambiguous gateway sends, and never affect another contact.
import {one,run,now,audit,getSetting,setSetting} from './db.mjs';
import {waRequest} from './waakg-control.mjs';
import {conversationAuthorized} from './operator-outreach.mjs';
import {conversationFinished} from './prospect-terminal-conversation.mjs';
import {isExplicitOptOut} from './sales-policy.mjs';
const MARKER='owner_7896_pretransport_duration_recovered_20261112_v1';
export async function recoverOwner7896DurationFailure({request=waRequest}={}){
 if(process.env.PROSPECTOR_TENANT_ID)return {state:'OTHER_TENANT'};
 if(process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE==='true')return {state:'PAUSED'};
 if(getSetting(MARKER,false)===true)return {state:'ALREADY_RECOVERED'};
 if(process.env.RUN_OWNER_7896_SAFE_RECOVERY_ONCE!=='true')return {state:'DISABLED'};
 const matches=one("SELECT COUNT(*) n FROM leads WHERE phone LIKE ?",'%7896')?.n||0;
 if(matches!==1)return {state:'CONTACT_NOT_UNIQUE',count:matches};
 const lead=one("SELECT id,phone,stage,contact_permission FROM leads WHERE phone LIKE ?",'%7896');
 if(!lead||!String(lead.phone).endsWith('7896'))return {state:'INVALID_CONTACT'};
 const pitch=one("SELECT stage,session_id,attempt_at,last_error,audio_sent_at,followup_sent_at FROM owner_pitch_sequences WHERE lead_id=?",lead.id);
 if(!pitch||pitch.stage!=='UNKNOWN'||pitch.last_error!=='OWNER_RECORDING_DURATION_UNAVAILABLE'||
    pitch.session_id!=='consecom-principal'||pitch.audio_sent_at||pitch.followup_sent_at)
  return {state:'NOT_PRETRANSPORT_FAILURE',pitchStage:pitch?.stage||null,error:pitch?.last_error||null};
 if(!conversationAuthorized(lead.id)||lead.contact_permission!==1||
    conversationFinished(lead.id,pitch.session_id)||
    one("SELECT 1 FROM suppressions WHERE phone=?",lead.phone)||
    one("SELECT 1 FROM threads WHERE lead_id=? AND manual_takeover=1",lead.id)||
    ['NO_INTEREST','CLOSED_WON'].includes(lead.stage))
  return {state:'NOT_ELIGIBLE'};
 const latest=one("SELECT body FROM waakg_inbox WHERE lead_id=? ORDER BY received_at DESC LIMIT 1",lead.id);
 if(latest&&isExplicitOptOut(latest.body))return {state:'LATEST_OPTOUT'};
 // Read-only provider verification. No media request or outbound messages here.
 let recent=[];
 try{
  const remote=await request('/api/chat/consecom-principal/'+encodeURIComponent(lead.phone+'@s.whatsapp.net'));
  recent=Array.isArray(remote.data)?remote.data:[];
 }catch(e){return {state:'PROVIDER_HISTORY_UNAVAILABLE',errorType:String(e.message).slice(0,55)}}
 if(!recent.length)return {state:'PROVIDER_HISTORY_EMPTY'};
 // No voice at all may have left the target conversation, including a manual
 // voice from another client. If uncertain, preserve UNKNOWN for review.
 if(recent.some(m=>m.fromMe===true&&/audio|voice|ptt/i.test(String(m.type||''))))
  return {state:'PROVIDER_HAS_VOICE_REVIEW'};
 const attempt=Date.parse(pitch.attempt_at);
 if(!Number.isFinite(attempt))return {state:'INVALID_ATTEMPT_TIME'};
 const outboundAfter=recent.some(m=>{
  if(m.fromMe!==true)return false;
  const at=typeof m.timestamp==='number'?(m.timestamp<1e12?m.timestamp*1000:m.timestamp):Date.parse(String(m.timestamp||m.createdAt||''));
  return Number.isFinite(at)&&at>=attempt-5000;
 });
 if(outboundAfter)return {state:'RECENT_OUTBOUND_REVIEW'};
 const updated=run("UPDATE owner_pitch_sequences SET stage='PENDING_AUDIO',due_at=?,attempt_at=NULL,last_error=NULL,updated_at=? WHERE lead_id=? AND stage='UNKNOWN' AND last_error='OWNER_RECORDING_DURATION_UNAVAILABLE' AND audio_sent_at IS NULL AND followup_sent_at IS NULL",
  now(),now(),lead.id);
 if(!updated.changes)return {state:'RACE_STATE_CHANGED'};
 setSetting(MARKER,true);
 audit('OWNER_7896_DURATION_SAFE_RECOVERY',lead.id,{sessionSuffix:'7336',contactSuffix:'7896',originalError:'OWNER_RECORDING_DURATION_UNAVAILABLE',provedBeforeTransport:true,providerMessagesChecked:recent.length,otherContactsModified:0});
 return {state:'REQUEUED_PRETRANSPORT_ONLY',contactSuffix:'7896',sessionSuffix:'7336',audioAlreadySent:false};
}
