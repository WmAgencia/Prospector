// Exactly one owner-approved recording. No synthetic TTS and no legacy
// 350/550 recordings are implicit fallbacks. Source fingerprint is persisted.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {getSetting,setSetting,now,audit} from './db.mjs';

export const OWNER_PREVIEW_FOLLOWUP='Se você quiser, posso te enviar uma prévia de como ficaria o site. O que você acha?';
export const OWNER_PREVIEW_DELAY_MS=10_000;
const ownerOnly=()=>!process.env.PROSPECTOR_TENANT_ID;
const root=()=>path.resolve(process.env.PROSPECTOR_DATA_DIR||'data','owner-approved-pitch');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function approvedOwnerRecordingStatus(){
 const meta=getSetting('owner_approved_pitch_recording',null);
 if(!ownerOnly())return {enabled:false,ready:false,reason:'OWNER_ACCOUNT_ONLY'};
 if(!meta?.sha256||!/^[a-f0-9]{64}$/.test(meta.sha256)||meta.active!==true)
  return {enabled:false,ready:false,reason:'AWAITING_OWNER_AUDIO_FILE'};
 const file=path.join(root(),meta.sha256+'.ogg');
 try{
  const bytes=fs.readFileSync(file);
  const valid=bytes.length>1024&&bytes.length<9*1024*1024&&bytes.toString('ascii',0,4)==='OggS'&&sha(bytes)===meta.outputSha256;
  return valid?{enabled:true,ready:true,sourceSha256:meta.sha256,outputSha256:meta.outputSha256,
    bytes:bytes.length,registeredAt:meta.registeredAt}
   :{enabled:false,ready:false,reason:'OWNER_RECORDING_CORRUPTED'};
 }catch{return {enabled:false,ready:false,reason:'OWNER_RECORDING_MISSING'};}
}
export function loadApprovedOwnerRecording(){
 const state=approvedOwnerRecordingStatus();
 if(!state.ready)throw Error(state.reason||'OWNER_RECORDING_NOT_APPROVED');
 const bytes=fs.readFileSync(path.join(root(),state.sourceSha256+'.ogg'));
 if(sha(bytes)!==state.outputSha256||bytes.toString('ascii',0,4)!=='OggS')
  throw Error('OWNER_RECORDING_HASH_MISMATCH');
 return {bytes,sourceSha256:state.sourceSha256,outputSha256:state.outputSha256,
  mimetype:'audio/ogg; codecs=opus',type:'voice',source:'OWNER_APPROVED_RECORDING'};
}
export function registerOwnerRecording(raw){
 if(!ownerOnly())throw Error('OWNER_ACCOUNT_ONLY');
 if(!Buffer.isBuffer(raw)||raw.length<6000||raw.length>12*1024*1024)
  throw Error('Envie o arquivo de áudio original com até 12 MB');
 const digest=sha(raw);
 // Byte-level identity of the original is retained, and audio content is only
 // transcoded to native WhatsApp Opus. No speech synthesis is performed.
 // When the user provides a genuine OGG/Opus WhatsApp voice note, keep
 // the exact original bytes. Re-encoding would unnecessarily alter the audio
 // and make source/transport file hashes differ.
 const verified=spawnSync('ffprobe',[
  '-v','error','-select_streams','a:0','-show_entries',
  'stream=codec_name','-of','default=noprint_wrappers=1:nokey=1','pipe:0'
 ],{input:raw,maxBuffer:128*1024,timeout:15000});
 const alreadyNative=raw.toString('ascii',0,4)==='OggS'&&
  verified.status===0&&verified.stdout.toString('utf8').trim()==='opus';
 let fileBytes=raw;
 if(!alreadyNative){
  const result=spawnSync('ffmpeg',[
   '-nostdin','-hide_banner','-loglevel','error','-i','pipe:0','-vn','-map','0:a:0',
   '-ac','1','-ar','48000','-c:a','libopus','-application','voip','-b:a','32k',
   '-map_metadata','-1','-f','ogg','pipe:1'
  ],{input:raw,maxBuffer:12*1024*1024,timeout:60000});
  if(result.error||result.status!==0||!Buffer.isBuffer(result.stdout))
   throw Error('Arquivo incompatível: envie o áudio original em OGG, MP3, M4A ou WAV');
  fileBytes=result.stdout;
 }
 if(fileBytes.length<1024||fileBytes.length>9*1024*1024||fileBytes.toString('ascii',0,4)!=='OggS')
  throw Error('Áudio não é compatível com OGG/Opus');
 const dir=root();fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const filename=path.join(dir,digest+'.ogg'),temp=filename+'.'+process.pid+'.tmp';
 try{
  fs.writeFileSync(temp,fileBytes,{mode:0o600,flag:'wx'});
  fs.renameSync(temp,filename);
  const verified=fs.readFileSync(filename);
  if(sha(verified)!==sha(fileBytes))throw Error('OWNER_RECORDING_WRITE_MISMATCH');
  const meta={sha256:digest,outputSha256:sha(fileBytes),active:true,registeredAt:now()};
  setSetting('owner_approved_pitch_recording',meta);
  audit('OWNER_RECORDING_APPROVED',null,{sourceShaPrefix:digest.slice(0,12),bytes:raw.length});
  return approvedOwnerRecordingStatus();
 }finally{try{fs.unlinkSync(temp);}catch{}}
}
// Secure one-time transfer from owner-protected Railway variables into
// /data/owner-approved-pitch. The raw 63-second audio NEVER enters GitHub.
// Reject missing, mixed or tampered chunks before writing anything.
export const EXACT_APPROVED_OWNER_AUDIO_SHA256='9579652b25cf3c29aaff0c2972f2452bb847d00c697abdcfc9601f510c30a389';
export const EXACT_APPROVED_OWNER_AUDIO_BYTES=154890;
export function bootstrapApprovedOwnerAudioFromEnv({environ=process.env,register=registerOwnerRecording}={}){
 if(!ownerOnly())return {status:'OTHER_TENANT_UNCHANGED'};
 const existing=approvedOwnerRecordingStatus();
 if(existing.ready&&existing.sourceSha256===EXACT_APPROVED_OWNER_AUDIO_SHA256&&
    existing.outputSha256===EXACT_APPROVED_OWNER_AUDIO_SHA256)
  return {status:'ALREADY_READY',ready:true,shaPrefix:EXACT_APPROVED_OWNER_AUDIO_SHA256.slice(0,12)};
 const declaredSha=String(environ.PROSPECTOR_OWNER_APPROVED_AUDIO_SHA256||'');
 if(declaredSha!==EXACT_APPROVED_OWNER_AUDIO_SHA256)return {status:'NOT_PROVISIONED',ready:false};
 const count=Number(environ.PROSPECTOR_OWNER_APPROVED_AUDIO_B64_PARTS);
 if(!Number.isInteger(count)||count<1||count>40)return {status:'INVALID_PART_COUNT',ready:false};
 const chunks=[];
 for(let i=0;i<count;i++){
  const part=environ['PROSPECTOR_OWNER_APPROVED_AUDIO_B64_'+String(i).padStart(2,'0')];
  if(typeof part!=='string'||!/^[A-Za-z0-9+/=]{1,20000}$/.test(part))
   return {status:'PART_MISSING_OR_INVALID',ready:false,part:i};
  chunks.push(part);
 }
 const encoded=chunks.join('');
 if(encoded.length>500000||encoded.length<150000||encoded.length%4!==0)
  return {status:'INVALID_AUDIO_LENGTH',ready:false};
 const bytes=Buffer.from(encoded,'base64');
 // Node's base64 decoder is permissive: demand canonical round-trip as well as
 // a cryptographic identity check to avoid mixed/truncated environment chunks.
 if(bytes.toString('base64')!==encoded||bytes.length!==EXACT_APPROVED_OWNER_AUDIO_BYTES||
    bytes.toString('ascii',0,4)!=='OggS'||sha(bytes)!==EXACT_APPROVED_OWNER_AUDIO_SHA256)
  return {status:'AUDIO_HASH_MISMATCH',ready:false};
 try{
  const stored=register(bytes);
  if(!stored.ready||stored.sourceSha256!==EXACT_APPROVED_OWNER_AUDIO_SHA256||
     stored.outputSha256!==EXACT_APPROVED_OWNER_AUDIO_SHA256||
     stored.bytes!==EXACT_APPROVED_OWNER_AUDIO_BYTES)
   return {status:'PERSISTENCE_VALIDATION_FAILED',ready:false};
  audit('OWNER_APPROVED_AUDIO_IMPORTED',null,{source:'RAILWAY_PRIVATE_ENV',bytes:bytes.length,shaPrefix:EXACT_APPROVED_OWNER_AUDIO_SHA256.slice(0,12)});
  return {status:'READY',ready:true,bytes:bytes.length,shaPrefix:EXACT_APPROVED_OWNER_AUDIO_SHA256.slice(0,12),persistent:true};
 }catch(error){
  return {status:'PERSISTENCE_ERROR',ready:false,reason:String(error?.message||error).slice(0,130)};
 }
}

export function deactivateOwnerRecording(){
 if(!ownerOnly())throw Error('OWNER_ACCOUNT_ONLY');
 const meta=getSetting('owner_approved_pitch_recording',null);
 if(meta)setSetting('owner_approved_pitch_recording',{...meta,active:false});
 return approvedOwnerRecordingStatus();
}
