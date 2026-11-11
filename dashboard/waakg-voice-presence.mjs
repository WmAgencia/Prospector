// WhatsApp's recording indicator for owner-approved voice notes.
// Presence reflects preparation of the voice note, not a claim that the owner
// is personally recording live. The audio content stays unchanged.
import {setTimeout as wait} from 'node:timers/promises';
import {waRequest} from './waakg-control.mjs';
import {sendVoiceMedia} from './waakg-media.mjs';

const validJid=x=>/^\d{12,15}@s\.whatsapp\.net$/.test(String(x||''));
const validSession=x=>/^[A-Za-z0-9_-]{3,70}$/.test(String(x||''));

export async function sendVoiceWithRecording({
 jid,session,bytes,mimeType='audio/mp4',originalOwnerAudio=false,
 sendAudio=sendVoiceMedia,
 sendPresence=waRequest,
 sleep=wait,
 holdMs=4200
}={}){
 if(!validJid(jid)||!validSession(session)||!Buffer.isBuffer(bytes)||bytes.length<256)
  throw Error('VOICE_PRESENCE_INVALID_DESTINATION');
 const endpoint='/api/chat/'+encodeURIComponent(session)+'/'+encodeURIComponent(jid)+'/presence';
 let recording=false,paused=false;
 try{
  const accepted=await sendPresence(endpoint,{method:'POST',data:{presence:'recording'}});
  recording=accepted?.status===true;
 }catch{recording=false;}
 // WhatsApp recording presence can expire quickly; keep it visible briefly.
 if(recording)await sleep(Math.min(7000,Math.max(1000,holdMs)));
 try{
  const sent=await sendAudio({jid,session,bytes,mimeType,originalOwnerAudio});
  return {...sent,recordingPresenceAccepted:recording};
 }finally{
  if(recording){
   try{
    const ack=await sendPresence(endpoint,{method:'POST',data:{presence:'paused'}});
    paused=ack?.status===true;
   }catch{paused=false;}
  }
 }
}
