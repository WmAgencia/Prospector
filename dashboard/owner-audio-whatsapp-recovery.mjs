// One-time private recovery of the ORIGINAL, owner-approved WhatsApp voice
// note. No customer sends, public URLs or AI synthesis. A file must match the
// SHA-256 of the exact owner-provided 63s OGG to be approved in production.
import crypto from 'node:crypto';
import {now,getSetting,setSetting,audit} from './db.mjs';
import {managedSessions} from './waakg-session-registry.mjs';
import {waRequest,getGatewayApiKey} from './waakg-control.mjs';
import {safeMediaPath,fetchPrivateAudio} from './waakg-media.mjs';
import {registerOwnerRecording,approvedOwnerRecordingStatus} from './owner-approved-pitch.mjs';

export const WESLEY_APPROVED_VOICE_SHA256='9579652b25cf3c29aaff0c2972f2452bb847d00c697abdcfc9601f510c30a389';
export const WESLEY_APPROVED_VOICE_BYTES=154890;
const START=Date.parse('2026-11-10T14:39:00.000Z');
const END=Date.parse('2026-11-10T15:09:00.000Z');
const SESSION_ID=/^[a-zA-Z0-9_-]{3,70}$/;
const JID=/^(?:\d{10,15}@s\.whatsapp\.net|\d{10,22}@lid)$/;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const timestamp=x=>{
 const value=x instanceof Date?x.getTime():typeof x==='number'?(x<1e12?x*1000:x):Date.parse(String(x||''));
 return Number.isFinite(value)?value:NaN;
};
const state=(status,more={})=>({status,expectedShaPrefix:WESLEY_APPROVED_VOICE_SHA256.slice(0,12),at:now(),...more});
const save=x=>{setSetting('owner_approved_voice_recovery',x);return x;};
export const approvedVoiceRecoveryStatus=()=>getSetting('owner_approved_voice_recovery',null);
function candidates(record){
 const values=[record?.jid,record?.remoteJid,record?.remoteJidAlt];
 return values.filter(x=>typeof x==='string'&&JID.test(x));
}
export function eligibleOriginalVoiceMessage(msg){
 const time=timestamp(msg?.timestamp);
 const type=String(msg?.type||'').toUpperCase();
 return msg?.fromMe===true&&Number.isFinite(time)&&time>=START&&time<=END&&
  (type==='AUDIO'||type==='VOICE'||type==='PTT'||/\.(?:ogg|opus|m4a|mp3)$/.test(String(msg?.mediaUrl||'')));
}
async function downloadInternalMessage(session,msg,{fetchFn=fetch,keyFn=getGatewayApiKey,base=process.env.WA_AKG_BASE_URL||'https://wa-akg-production-f9f0.up.railway.app'}={}){
 if(safeMediaPath(msg?.mediaUrl)){
  try{return (await fetchPrivateAudio(msg.mediaUrl,{session,fetchFn})).buffer;}catch{/* private message download fallback */}
 }
 // Only the authenticated gateway's session-owned stored media ID, never a
 // caller URL, can be retrieved here. No outbound WhatsApp message is sent.
 if(!/^[A-Za-z0-9_-]{8,80}$/.test(String(msg?.id||'')))return null;
 const u=String(base).replace(/\/$/,'')+'/api/messages/'+encodeURIComponent(session)+'/download/'+encodeURIComponent(msg.id)+'/media';
 const res=await fetchFn(u,{headers:{'X-API-Key':await keyFn(),Accept:'audio/*'},
  redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!res.ok)return null;
 const mime=String(res.headers.get('content-type')||'').toLowerCase();
 if(!mime.startsWith('audio/')&&mime!=='application/octet-stream')return null;
 const length=Number(res.headers.get('content-length')||0);
 if(length>500000)return null;
 const bytes=Buffer.from(await res.arrayBuffer());
 return bytes.length<=500000?bytes:null;
}
let working=false;
export async function recoverApprovedWesleyVoice({request=waRequest,download=downloadInternalMessage,
 register=registerOwnerRecording,logging=true,overrideSessions}={}){
 if(working)return state('BUSY');
 if(process.env.PROSPECTOR_TENANT_ID)return state('OWNER_ONLY');
 if(process.env.PROSPECTOR_OWNER_VOICE_RECOVERY_ENABLED!=='true')return state('DISABLED');
 const current=approvedOwnerRecordingStatus();
 if(current.ready&&current.sourceSha256===WESLEY_APPROVED_VOICE_SHA256)
  return save(state('READY',{verified:true,bytes:current.bytes}));
 working=true;
 let checkedChats=0,checkedAudio=0,mediaMatches=0;
 try{
  const sessionIds=overrideSessions||managedSessions().map(x=>x.session_id);
  const scoped=[...new Set(['consecom-principal',...sessionIds])]
    .filter(x=>SESSION_ID.test(x)).slice(0,4);
  const seen=new Set();
  for(const session of scoped){
   const contacts=[];
   for(const query of ['William','Pintura','W.L.P']){
    try{
     const result=await request('/api/contacts/'+encodeURIComponent(session)+'?search='+encodeURIComponent(query)+'&limit=40');
     for(const contact of result.data||[])contacts.push(contact);
    }catch{/* continue other query/session */}
   }
   // A fallback includes the gateway's most recent 50 conversations when
   // a contact has no saved name; never scan arbitrary historical files.
   try{
    const chats=await request('/api/chat/'+encodeURIComponent(session));
    for(const chat of chats.data||[]){
     const display=String(chat?.name||chat?.notify||'');
     if(/william|pintura|w[.\s-]*l[.\s-]*p/i.test(display))contacts.push(chat);
    }
   }catch{/* session may be disconnected, DB routes can still work */}
   for(const contact of contacts){
    for(const jid of candidates(contact)){
     if(seen.has(session+':'+jid))continue;
     seen.add(session+':'+jid);
     if(++checkedChats>35)break;
     let entries=[];
     try{
      const data=await request('/api/chat/'+encodeURIComponent(session)+'/'+encodeURIComponent(jid));
      entries=Array.isArray(data.data)?data.data:[];
     }catch{continue;}
     for(const msg of entries){
      if(!eligibleOriginalVoiceMessage(msg))continue;
      checkedAudio++;
      let buffer=null;
      try{buffer=await download(session,msg);}catch{/* unavailable original media */}
      if(!Buffer.isBuffer(buffer)||buffer.length!==WESLEY_APPROVED_VOICE_BYTES||
       sha(buffer)!==WESLEY_APPROVED_VOICE_SHA256)continue;
      mediaMatches++;
      const result=register(buffer);
      if(!result.ready||result.sourceSha256!==WESLEY_APPROVED_VOICE_SHA256||
       result.outputSha256!==WESLEY_APPROVED_VOICE_SHA256)
       throw Error('OWNER_VOICE_VERIFICATION_FAILED');
      audit('OWNER_EXACT_WHATSAPP_AUDIO_RECOVERED',null,{shaPrefix:WESLEY_APPROVED_VOICE_SHA256.slice(0,12),bytes:buffer.length,session});
      const success=save(state('READY',{verified:true,bytes:buffer.length,source:'PRIVATE_WHATSAPP_HISTORY'}));
      if(logging)console.info('[owner voice private recovery]',JSON.stringify(success));
      return success;
     }
    }
   }
  }
  const result=save(state('NOT_FOUND',{checkedChats,checkedAudio,mediaMatches,
   instruction:'Select and upload the original WhatsApp PTT audio from Settings'}));
  if(logging)console.info('[owner voice private recovery]',JSON.stringify(result));
  return result;
 }catch(error){
  const result=save(state('ERROR',{reason:String(error?.message||error).slice(0,110),
   checkedChats,checkedAudio,mediaMatches}));
  if(logging)console.warn('[owner voice private recovery]',JSON.stringify(result));
  return result;
 }finally{working=false;}
}
