// One-off, owner-requested WhatsApp voice note smoke test.
// Never sends prospecting messages, never modifies lead consent or budgets.
// Strict source identity validation and persistent idempotency prevent a
// repeated send when Railway rebuilds, a gateway times out, or a job crashes.
import crypto from 'node:crypto';
import {db,one,run,now,audit} from './db.mjs';
import {waSessionList,waRequest} from './waakg-control.mjs';
import {readPortfolioPitchAudio,PITCH_AUDIO_ORIGINAL_SHA256} from './portfolio-pitch-audio.mjs';
import {sendVoiceWithRecording} from './waakg-voice-presence.mjs';
import {setTimeout as wait} from 'node:timers/promises';

db.exec("CREATE TABLE IF NOT EXISTS owner_voice_demo_delivery(id TEXT PRIMARY KEY,source_suffix TEXT NOT NULL,target_suffix TEXT NOT NULL,session_id TEXT NOT NULL,status TEXT NOT NULL,recording_presence INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,detail TEXT)");

const full=x=>/^55\d{10,11}$/.test(String(x||''))?String(x):null;
const digest=text=>crypto.createHash('sha256').update(text).digest('hex');
const short=x=>String(x||'').slice(-4);

export async function runOwnerVoiceDemo(input={},deps={}){
 if(process.env.PROSPECTOR_OWNER_VOICE_DEMO_ENABLED!=='true'&&!deps.allowTest)
  return {state:'DISABLED',attempted:false};
 const from=full(input.from||process.env.PROSPECTOR_OWNER_VOICE_DEMO_FROM);
 const to=full(input.to||process.env.PROSPECTOR_OWNER_VOICE_DEMO_TO);
 if(!from||!to||from===to)return {state:'INVALID_TEST_PHONES',attempted:false};
 const id=digest('owner-original-pitch-20261109|'+from+'|'+to+'|'+PITCH_AUDIO_ORIGINAL_SHA256);
 const already=one('SELECT status,recording_presence FROM owner_voice_demo_delivery WHERE id=?',id);
 if(already)return {state:'ALREADY_ATTEMPTED',delivery:already.status,recordingPresenceAccepted:already.recording_presence===1,
  sourceSuffix:short(from),targetSuffix:short(to),attempted:false};
 const sessions=await (deps.sessions||waSessionList)();
 const items=Array.isArray(sessions?.items)?sessions.items:[];
 // The claimed sender must be the *live authenticated WhatsApp identity*,
 // not simply a session name or number suffix.
 const matches=items.filter(x=>x.connected===true&&x.number===from);
 if(matches.length!==1)return {state:'SENDER_NOT_CONNECTED',attempted:false,
  sourceSuffix:short(from),targetSuffix:short(to),
  connectedSuffixes:items.filter(x=>x.connected).map(x=>x.numberSuffix).filter(Boolean)};
 const origin=matches[0].session_id;
 if(!/^[A-Za-z0-9_-]{3,70}$/.test(origin))return {state:'INVALID_SOURCE_SESSION',attempted:false};
 let asset;
 try{asset=await (deps.loadAudio||readPortfolioPitchAudio)();}
 catch(e){return {state:'AUDIO_NOT_READY',attempted:false,error:String(e?.message||e).slice(0,90)};}
 if(!Buffer.isBuffer(asset?.bytes)||asset.bytes.length<200000)
  return {state:'INVALID_AUDIO',attempted:false};
 const timestamp=now();
 // UNKNOWN is the initial durable state so a crash after sending does not
 // lead to an accidental duplicate.
 if(!run('INSERT OR IGNORE INTO owner_voice_demo_delivery(id,source_suffix,target_suffix,session_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
  id,short(from),short(to),origin,'UNKNOWN',timestamp,timestamp).changes)
  return {state:'ALREADY_ATTEMPTED',attempted:false};
 try{
  const sent=await (deps.sendAudio||sendVoiceWithRecording)({
   jid:to+'@s.whatsapp.net',session:origin,bytes:asset.bytes
  });
  if(sent?.accepted!==true)throw Error('GATEWAY_NOT_CONFIRMED');
  run("UPDATE owner_voice_demo_delivery SET status='ACCEPTED',recording_presence=?,updated_at=?,detail=? WHERE id=?",
   sent.recordingPresenceAccepted===true?1:0,now(),'Gateway accepted PTT audio; recipient playback unverified',id);
  audit('OWNER_VOICE_DEMO_ACCEPTED',null,{sourceSuffix:short(from),targetSuffix:short(to),recordingPresence:sent.recordingPresenceAccepted===true,delivery:'GATEWAY_ACCEPTED'});
  let historyFound=false;
  try{
   await (deps.wait||wait)(1250);
   const response=await (deps.queryHistory||waRequest)('/api/chat/'+encodeURIComponent(origin)+'/'+encodeURIComponent(to+'@s.whatsapp.net'));
   historyFound=Array.isArray(response?.data)&&response.data.some(m=>{
    if(m?.fromMe!==true)return false;
    const type=String(m.messageType||m.type||'').toLowerCase();
    const encoded=JSON.stringify(m?.message||m?.content||{}).toLowerCase();
    return type.includes('audio')||encoded.includes('audiomessage');
   });
  }catch{}
  return {state:'GATEWAY_ACCEPTED',sourceSuffix:short(from),targetSuffix:short(to),
    sessionId:origin,attempted:true,voiceNote:true,
    recordingPresenceAccepted:sent.recordingPresenceAccepted===true,
    historyAudioFound:historyFound,recipientPlaybackVerified:false};
 }catch(err){
  const reason=String(err?.message||err).slice(0,90);
  run('UPDATE owner_voice_demo_delivery SET detail=?,updated_at=? WHERE id=?',reason,now(),id);
  audit('OWNER_VOICE_DEMO_UNKNOWN',null,{sourceSuffix:short(from),targetSuffix:short(to),delivery:'UNKNOWN',reason});
  return {state:'UNKNOWN_CHECK_WHATSAPP',attempted:true,
    sourceSuffix:short(from),targetSuffix:short(to),reason,noAutoRetry:true};
 }
}
