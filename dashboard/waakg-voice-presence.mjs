// WhatsApp recording presence for approved voice notes.
// Owner recording stays byte-identical; do not upload until its recording
// indicator has been held for the audio's full length (at least 71 seconds).
import {setTimeout as wait} from 'node:timers/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EXACT_APPROVED_OWNER_AUDIO_SHA256} from './owner-approved-pitch.mjs';
import {waRequest} from './waakg-control.mjs';
import {sendVoiceMedia} from './waakg-media.mjs';

const validJid=x=>/^\d{12,15}@s\.whatsapp\.net$/.test(String(x||''));
const validSession=x=>/^[A-Za-z0-9_-]{3,70}$/.test(String(x||''));
export const OWNER_RECORDING_MIN_MS=71_000;
export const PRESENCE_REFRESH_MS=7_000;
const MAX_OWNER_DURATION_MS=5*60_000;

export function ownerRecordingDurationMs(bytes,{probe=spawnSync,approvedSha=EXACT_APPROVED_OWNER_AUDIO_SHA256}={}){
 if(!Buffer.isBuffer(bytes)||bytes.length<256)throw Error('OWNER_RECORDING_INVALID_AUDIO');
 // The private exact approved OGG stream has no stable container duration
 // for ffprobe. Its SHA-256 identity is verified again here. Never bypass
 // the 71-second recording wait for this original owner-supplied clip.
 if(createHash('sha256').update(bytes).digest('hex')===approvedSha)
  return OWNER_RECORDING_MIN_MS;
 const result=probe('ffprobe',['-v','error','-show_entries','format=duration',
  '-of','default=noprint_wrappers=1:nokey=1','pipe:0'],
  {input:bytes,maxBuffer:128*1024,timeout:10000});
 const seconds=Number(String(result.stdout||'').trim());
 if(result.error||result.status!==0||!Number.isFinite(seconds)||seconds<=0||seconds>300)
  throw Error('OWNER_RECORDING_DURATION_UNAVAILABLE');
 return Math.max(OWNER_RECORDING_MIN_MS,Math.ceil(seconds*1000));
}

export async function sendVoiceWithRecording({
 jid,session,bytes,mimeType='audio/mp4',originalOwnerAudio=false,
 sendAudio=sendVoiceMedia,sendPresence=waRequest,sleep=wait,
 holdMs=4200,ownerDuration=ownerRecordingDurationMs
}={}){
 if(!validJid(jid)||!validSession(session)||!Buffer.isBuffer(bytes)||bytes.length<256)
  throw Error('VOICE_PRESENCE_INVALID_DESTINATION');
 const endpoint='/api/chat/'+encodeURIComponent(session)+'/'+encodeURIComponent(jid)+'/presence';
 const duration=originalOwnerAudio?ownerDuration(bytes):Math.min(7000,Math.max(1000,holdMs));
 let recording=false;
 try{
  const accepted=await sendPresence(endpoint,{method:'POST',data:{presence:'recording'}});
  recording=accepted?.status===true;
  if(originalOwnerAudio&&!recording)throw Error('OWNER_RECORDING_PRESENCE_UNAVAILABLE');
  if(recording){
   // Refresh every 7s: WhatsApp presence is short lived. Never send the
   // pre-recorded 71s voice note immediately after a single 4s presence.
   for(let remaining=duration;remaining>0;){
    if(process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE==='true')
     throw Error('PROSPECTOR_EMERGENCY_ALL_OUTBOUND_PAUSED');
    const chunk=Math.min(PRESENCE_REFRESH_MS,remaining);
    await sleep(chunk);
    remaining-=chunk;
    if(remaining>0){
     const renewed=await sendPresence(endpoint,{method:'POST',data:{presence:'recording'}});
     if(originalOwnerAudio&&renewed?.status!==true)
      throw Error('OWNER_RECORDING_PRESENCE_INTERRUPTED');
    }
   }
  }
  if(process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE==='true')
   throw Error('PROSPECTOR_EMERGENCY_ALL_OUTBOUND_PAUSED');
  const sent=await sendAudio({jid,session,bytes,mimeType,originalOwnerAudio});
  return {...sent,recordingPresenceAccepted:recording,recordingWaitMs:recording?duration:0};
 }finally{
  if(recording){
   try{await sendPresence(endpoint,{method:'POST',data:{presence:'paused'}});}catch{}
  }
 }
}
