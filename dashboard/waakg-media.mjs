// Typed media bridge to WA-AKG. No arbitrary URLs or external hosts.
import {getGatewayApiKey,selectedWaSession} from './waakg-control.mjs';
const base='https://wa-akg-production-f9f0.up.railway.app';
export const MAX_MEDIA_BYTES=15*1024*1024;
const mediaFile=/^\/api\/media\/[A-Za-z0-9_-]{3,140}\.(?:mp3|m4a|mp4|ogg|opus|wav|webm)$/i;
const jidAllowed=j=>/^\d{10,15}@s\.whatsapp\.net$/.test(j);
export function safeMediaPath(value){return typeof value==='string'&&mediaFile.test(value)?value:null;}
async function readLimited(response,limit=MAX_MEDIA_BYTES){
 const length=Number(response.headers.get('content-length')||0);
 if(length>limit)throw Error('AUDIO_TOO_LARGE');
 const reader=response.body?.getReader();
 if(!reader)throw Error('EMPTY_MEDIA');
 let size=0;const parts=[];
 try{
  for(;;){
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.byteLength;
   if(size>limit){await reader.cancel();throw Error('AUDIO_TOO_LARGE');}
   parts.push(Buffer.from(value));
  }
 }finally{reader.releaseLock();}
 if(size<100)throw Error('EMPTY_MEDIA');
 return Buffer.concat(parts,size);
}
export async function fetchPrivateAudio(urlPath,{fetchFn=fetch,apiKey,session=selectedWaSession()}={}){
 const path=safeMediaPath(urlPath);
 if(!path||!session)throw Error('INVALID_AUDIO_PATH');
 const key=apiKey||await getGatewayApiKey();
 const res=await fetchFn(base+path,{headers:{'X-API-Key':key,Accept:'audio/*'},signal:AbortSignal.timeout(18000),redirect:'error'});
 if(!res.ok)throw Error('MEDIA_HTTP_'+res.status);
 const type=String(res.headers.get('content-type')||'').split(';')[0].toLowerCase();
 if(type&&!(type.startsWith('audio/')||type==='application/octet-stream'))throw Error('NOT_AUDIO');
 const buffer=await readLimited(res);
 // Node and Groq understand the supplied extension (OGG/MP3/WAV/M4A).
 return {buffer,filename:path.split('/').at(-1),mimeType:type||'application/octet-stream'};
}
export async function sendVoiceMedia({jid,bytes,session=selectedWaSession(),fetchFn=fetch,apiKey}={}){
 if(!jidAllowed(jid)||!session||!Buffer.isBuffer(bytes)||bytes.length<256||bytes.length>MAX_MEDIA_BYTES)throw Error('INVALID_VOICE_SEND');
 const form=new FormData();
 form.append('type','voice');
 form.append('file',new Blob([bytes],{type:'audio/mp4'}),'francisca.m4a');
 const key=apiKey||await getGatewayApiKey();
 // WA-AKG's own handler expects multipart form data, not JSON, and uses
 // type=voice to send a WhatsApp push-to-talk message.
 const res=await fetchFn(base+'/api/messages/'+encodeURIComponent(session)+'/'+encodeURIComponent(jid)+'/media',{
  method:'POST',headers:{'X-API-Key':key,Accept:'application/json'},body:form,signal:AbortSignal.timeout(30000)});
 const reply=await res.json().catch(()=>({}));
 if(!res.ok||reply.status!==true)throw Error('VOICE_SEND_UNKNOWN');
 return {accepted:true,verifiedOnPhone:false};
}
