// A single original, approved Wesley recording followed by one exact text
// 10 seconds after the WhatsApp gateway ACK. Fail-closed on ambiguous sends.
import {db,one,run,now,audit,addMessage} from './db.mjs';
import {loadApprovedOwnerRecording,approvedOwnerRecordingStatus,
 OWNER_PREVIEW_FOLLOWUP,OWNER_PREVIEW_DELAY_MS} from './owner-approved-pitch.mjs';
import {conversationFinished} from './prospect-terminal-conversation.mjs';
import {conversationAuthorized} from './operator-outreach.mjs';
import {classifyContact} from './whatsapp-roles.mjs';
import {isManagedSession,leadSession} from './waakg-session-registry.mjs';
import {waControlStatus,waRequest} from './waakg-control.mjs';
import {sendVoiceWithRecording} from './waakg-voice-presence.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS owner_pitch_sequences (
 lead_id TEXT PRIMARY KEY REFERENCES leads(id),
 session_id TEXT NOT NULL,
 request_provider_id TEXT NOT NULL,
 stage TEXT NOT NULL,
 due_at TEXT,
 audio_sha256 TEXT NOT NULL,
 audio_sent_at TEXT,
 followup_sent_at TEXT,
 attempt_at TEXT,
 last_error TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
)`);
db.exec("CREATE INDEX IF NOT EXISTS idx_owner_pitch_due ON owner_pitch_sequences(stage,due_at)");
run("UPDATE owner_pitch_sequences SET stage='UNKNOWN',last_error='Interrupted send; verify WhatsApp before any retry',updated_at=? WHERE stage IN ('SENDING_AUDIO','SENDING_TEXT')",now());

const ownerOnly=()=>!process.env.PROSPECTOR_TENANT_ID;
export const ownerPitchStatus=leadId=>one('SELECT * FROM owner_pitch_sequences WHERE lead_id=?',leadId)||null;
export const ownerPitchActive=leadId=>!!one("SELECT 1 FROM owner_pitch_sequences WHERE lead_id=? AND stage IN ('PENDING_AUDIO','SENDING_AUDIO','AUDIO_ACCEPTED','SENDING_TEXT','UNKNOWN')",leadId);
export function enqueueOwnerPitch({leadId,sessionId,providerId,receivedAt=now()}={}){
 if(!ownerOnly()||!leadId||!sessionId||!providerId)return {state:'NOT_OWNER'};
 const asset=approvedOwnerRecordingStatus();
 if(!asset.ready)return {state:'ASSET_NOT_READY',reason:asset.reason};
 if(!isManagedSession(sessionId)||leadSession(leadId)!==sessionId||conversationFinished(leadId,sessionId)||
  !conversationAuthorized(leadId)||one('SELECT 1 FROM suppressions WHERE phone=(SELECT phone FROM leads WHERE id=?)',leadId))
  return {state:'NOT_ELIGIBLE'};
 const prior=ownerPitchStatus(leadId);
 if(prior)return {state:prior.stage,alreadyExists:true};
 // Only a persisted inbound from this same contact may request an original
 // owner voice message. Never bulk-trigger by finding a phone online.
 const original=one('SELECT lead_id,state FROM waakg_inbox WHERE provider_id=?',providerId);
 if(!original||original.lead_id!==leadId||original.state!=='REVIEW')return {state:'NO_APPROVED_INBOUND'};
 const received=new Date(receivedAt);
 const due=new Date(Math.max(Date.now(),Number.isFinite(received.getTime())?received.getTime():Date.now())).toISOString();
 const saved=run("INSERT OR IGNORE INTO owner_pitch_sequences(lead_id,session_id,request_provider_id,stage,due_at,audio_sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
  leadId,sessionId,providerId,'PENDING_AUDIO',due,asset.sourceSha256,now(),now());
 if(saved.changes)audit('OWNER_PITCH_AUDIO_QUEUED',leadId,{recordingShaPrefix:asset.sourceSha256.slice(0,12),sessionId});
 return {state:saved.changes?'PENDING_AUDIO':'ALREADY_QUEUED'};
}
function allowed(item,{beforeAudio=false}={}){
 if(!ownerOnly()||!isManagedSession(item.session_id)||leadSession(item.lead_id)!==item.session_id||
  conversationFinished(item.lead_id,item.session_id)||!conversationAuthorized(item.lead_id))return false;
 const phone=one('SELECT phone,stage FROM leads WHERE id=?',item.lead_id);
 if(!phone||['NO_INTEREST','CLOSED_WON'].includes(phone.stage)||
  one('SELECT 1 FROM suppressions WHERE phone=?',phone.phone)||
  one('SELECT 1 FROM threads WHERE lead_id=? AND manual_takeover=1',item.lead_id))return false;
 const jid=phone.phone+'@s.whatsapp.net';
 if(classifyContact({jid,sessionId:item.session_id}).role!=='PROSPECT_APPROACHED')return false;
 // Do not auto-send into a thread with an operator's newer message.
 const latest=one(`SELECT 1 FROM messages m JOIN threads t ON t.id=m.thread_id
  WHERE t.lead_id=? AND m.direction='out' AND m.at>=?
    AND m.provider_id NOT LIKE 'owner-voice:%'
    AND m.provider_id NOT LIKE 'owner-preview:%' LIMIT 1`,item.lead_id,
    beforeAudio?item.created_at:item.audio_sent_at||item.created_at);
 if(latest)return false;
 // For a 10-second follow-up, a newer inbound question/decline supersedes the
 // scheduled CTA; owner can review it without a second automated nudge.
 if(!beforeAudio&&one(`SELECT 1 FROM messages m JOIN threads t ON t.id=m.thread_id
  WHERE t.lead_id=? AND m.direction='in' AND m.at>? LIMIT 1`,item.lead_id,item.audio_sent_at||item.created_at))return false;
 return true;
}
let working=false;
export async function tickOwnerPitch({clock=()=>Date.now(),status=waControlStatus,
 sendAudio=sendVoiceWithRecording,sendText=waRequest,load=loadApprovedOwnerRecording}={}){
 if(working)return {state:'BUSY'};
 working=true;
 try{
  const due=new Date(clock()).toISOString();
  const item=one("SELECT * FROM owner_pitch_sequences WHERE stage IN ('PENDING_AUDIO','AUDIO_ACCEPTED') AND due_at<=? ORDER BY due_at LIMIT 1",due);
  if(!item)return {state:'IDLE'};
  const audioStep=item.stage==='PENDING_AUDIO';
  if(!allowed(item,{beforeAudio:audioStep})){
   run("UPDATE owner_pitch_sequences SET stage='CANCELLED',last_error='Conversation changed or ended',updated_at=? WHERE lead_id=? AND stage=?",now(),item.lead_id,item.stage);
   return {state:'CANCELLED'};
  }
  if(audioStep&&(!approvedOwnerRecordingStatus().ready||approvedOwnerRecordingStatus().sourceSha256!==item.audio_sha256)){
   run("UPDATE owner_pitch_sequences SET stage='NEEDS_REVIEW',last_error='Audio original not approved',updated_at=? WHERE lead_id=? AND stage=?",now(),item.lead_id,item.stage);
   return {state:'NEEDS_REVIEW'};
  }
  const phone=one('SELECT phone FROM leads WHERE id=?',item.lead_id)?.phone;
  const live=await status(item.session_id);
  if(!live.connected)return {state:'GATEWAY_OFFLINE'};
  if(!allowed(item,{beforeAudio:audioStep}))return {state:'CANCELLED'};
  const sending=audioStep?'SENDING_AUDIO':'SENDING_TEXT';
  if(!run("UPDATE owner_pitch_sequences SET stage=?,attempt_at=?,updated_at=? WHERE lead_id=? AND stage=?",sending,now(),now(),item.lead_id,item.stage).changes)return {state:'BUSY'};
  try{
   if(audioStep){
    const asset=load();
    if(asset.sourceSha256!==item.audio_sha256||asset.mimetype!=='audio/ogg; codecs=opus'||asset.bytes.toString('ascii',0,4)!=='OggS')
     throw Error('RECORDING_IDENTITY_MISMATCH');
    const ack=await sendAudio({jid:phone+'@s.whatsapp.net',session:item.session_id,
      bytes:asset.bytes,mimeType:'audio/ogg; codecs=opus',originalOwnerAudio:true});
    if(ack?.accepted!==true)throw Error('VOICE_GATEWAY_UNKNOWN');
    const acceptedAt=now();
    const nextDue=new Date(Date.parse(acceptedAt)+OWNER_PREVIEW_DELAY_MS).toISOString();
    run("UPDATE owner_pitch_sequences SET stage='AUDIO_ACCEPTED',audio_sent_at=?,due_at=?,updated_at=? WHERE lead_id=? AND stage='SENDING_AUDIO'",
      acceptedAt,nextDue,now(),item.lead_id);
    const thread=one('SELECT id FROM threads WHERE lead_id=?',item.lead_id);
    if(thread)addMessage({threadId:thread.id,providerId:'owner-voice:'+item.lead_id,
      direction:'out',body:'[Gravação original aprovada do Wesley]',status:'sent'});
    audit('OWNER_PITCH_AUDIO_ACCEPTED',item.lead_id,{recordingShaPrefix:item.audio_sha256.slice(0,12),
      followupAfterSeconds:10,gatewayAccepted:true,deliveryVerified:false});
    return {state:'AUDIO_ACCEPTED',dueAt:nextDue,recipientSuffix:phone.slice(-4)};
   }
   const ack=await sendText('/api/messages/'+encodeURIComponent(item.session_id)+'/'+encodeURIComponent(phone+'@s.whatsapp.net')+'/send',
    {method:'POST',data:{message:{text:OWNER_PREVIEW_FOLLOWUP}}});
   if(ack?.status!==true)throw Error('FOLLOWUP_GATEWAY_UNKNOWN');
   run("UPDATE owner_pitch_sequences SET stage='DONE',followup_sent_at=?,due_at=NULL,updated_at=? WHERE lead_id=? AND stage='SENDING_TEXT'",
    now(),now(),item.lead_id);
   const thread=one('SELECT id FROM threads WHERE lead_id=?',item.lead_id);
   if(thread)addMessage({threadId:thread.id,providerId:'owner-preview:'+item.lead_id,direction:'out',
    body:OWNER_PREVIEW_FOLLOWUP,status:'sent'});
   // Existing first introduction is finished; future replies can be handled
   // normally until a polite final goodbye terminates the conversation.
   run("UPDATE prospecting_introductions SET stage='CONVERSING',updated_at=? WHERE lead_id=? AND stage='VOICE_REVIEW'",now(),item.lead_id);
   audit('OWNER_PREVIEW_FOLLOWUP_ACCEPTED',item.lead_id,{delaySeconds:10,deliveryVerified:false});
   return {state:'DONE',recipientSuffix:phone.slice(-4)};
  }catch(e){
   // The gateway can accept a send and then time out. Never resend blindly.
   const reason=String(e?.message||e).slice(0,100);
   run("UPDATE owner_pitch_sequences SET stage='UNKNOWN',last_error=?,updated_at=? WHERE lead_id=? AND stage=?",
    reason,now(),item.lead_id,sending);
   audit('OWNER_PITCH_DELIVERY_UNKNOWN',item.lead_id,{step:sending,reason,manualReview:true});
   return {state:'UNKNOWN',step:sending};
  }
 }finally{working=false;}
}
