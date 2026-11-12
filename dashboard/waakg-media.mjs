// Typed media bridge to WA-AKG. No arbitrary URLs or external hosts.
import {getGatewayApiKey,selectedWaSession} from './waakg-control.mjs';
const base=String(process.env.WA_AKG_BASE_URL||'https://wa-akg-production-f9f0.up.railway.app').replace(/\/$/,'');
const externalTenant=Boolean(process.env.PROSPECTOR_TENANT_ID)&&process.env.PROSPECTOR_TENANT_INTERNAL!=='true';
function tenantMediaRequest(path){
 if(!externalTenant)return null;
 const broker=String(process.env.PROSPECTOR_GATEWAY_BROKER_URL||'');
 const token=String(process.env.PROSPECTOR_GATEWAY_BROKER_TOKEN||'');
 if(!/^http:\/\/127\.0\.0\.1:\d{2,5}\/api\/internal\/tenant-gateway$/.test(broker)||token.length!==64)
  throw Error('TENANT_GATEWAY_BROKER_REQUIRED');
 return {url:broker+path,headers:{
  'X-Prospector-Tenant-Id':process.env.PROSPECTOR_TENANT_ID,
  'X-Prospector-Broker-Token':token
 }};
}

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
 if(!path||!session||!path.split('/').at(-1).startsWith(session+'-'))throw Error('INVALID_AUDIO_PATH');
 const broker=tenantMediaRequest(path);
 const key=broker?null:apiKey||await getGatewayApiKey();
 const res=await fetchFn(broker?.url||base+path,{headers:{...(broker?broker.headers:{'X-API-Key':key}),Accept:'audio/*'},signal:AbortSignal.timeout(18000),redirect:'error'});
 if(!res.ok)throw Error('MEDIA_HTTP_'+res.status);
 const type=String(res.headers.get('content-type')||'').split(';')[0].toLowerCase();
 if(type&&!(type.startsWith('audio/')||type==='application/octet-stream'))throw Error('NOT_AUDIO');
 const buffer=await readLimited(res);
 // Node and Groq understand the supplied extension (OGG/MP3/WAV/M4A).
 return {buffer,filename:path.split('/').at(-1),mimeType:type||'application/octet-stream'};
}
export async function sendVoiceMedia({jid,bytes,session=selectedWaSession(),fetchFn=fetch,apiKey,mimeType='audio/mp4',originalOwnerAudio=false}={}){
 if(process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE==='true')throw Error('PROSPECTOR_EMERGENCY_ALL_OUTBOUND_PAUSED');
 if(!jidAllowed(jid)||!session||!Buffer.isBuffer(bytes)||bytes.length<256||bytes.length>MAX_MEDIA_BYTES)throw Error('INVALID_VOICE_SEND');
 // The owner account is forbidden to send any synthetic or legacy recording.
 if(!process.env.PROSPECTOR_TENANT_ID&&!originalOwnerAudio)throw Error('OWNER_AUDIO_MUST_USE_PINNED_RECORDING');
 const opus=bytes.toString('ascii',0,4)==='OggS';
 if(originalOwnerAudio&&(!opus||mimeType!=='audio/ogg; codecs=opus'))throw Error('OWNER_AUDIO_NOT_NATIVE_OPUS');
 const form=new FormData();
 form.append('type','voice');
 form.append('file',new Blob([bytes],{type:opus?'audio/ogg; codecs=opus':'audio/mp4'}),opus?'wesley-approved.ogg':'francisca.m4a');
 const route='/api/messages/'+encodeURIComponent(session)+'/'+encodeURIComponent(jid)+'/media';
 const broker=tenantMediaRequest(route);
 const key=broker?null:apiKey||await getGatewayApiKey();
 // Multipart body is forwarded as-is by the trusted parent broker.
 const res=await fetchFn(broker?.url||base+route,{
  method:'POST',headers:{...(broker?broker.headers:{'X-API-Key':key}),Accept:'application/json'},
  body:form,signal:AbortSignal.timeout(35000)});
 const reply=await res.json().catch(()=>({}));
 if(!res.ok||reply.status!==true)throw Error('VOICE_SEND_UNKNOWN');
 return {accepted:true,verifiedOnPhone:false};
}
