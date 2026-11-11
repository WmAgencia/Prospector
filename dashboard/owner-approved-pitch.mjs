// Exactly one owner-approved recording. No synthetic TTS and no legacy
// 350/550 recordings are implicit fallbacks. Source fingerprint is persisted.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {getSetting,setSetting,now,audit} from './db.mjs';

export const OWNER_PREVIEW_FOLLOWUP='Se você quiser, posso te enviar aqui uma prévia de como ficaria o site de vocês, pode ser?';
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
 const result=spawnSync('ffmpeg',[
  '-nostdin','-hide_banner','-loglevel','error','-i','pipe:0','-vn','-map','0:a:0',
  '-ac','1','-ar','48000','-c:a','libopus','-application','voip','-b:a','32k',
  '-map_metadata','-1','-f','ogg','pipe:1'
 ],{input:raw,maxBuffer:12*1024*1024,timeout:60000});
 if(result.error||result.status!==0||!Buffer.isBuffer(result.stdout)||
  result.stdout.length<1024||result.stdout.length>9*1024*1024||
  result.stdout.toString('ascii',0,4)!=='OggS')
  throw Error('Arquivo incompatível: envie o áudio original em OGG, MP3, M4A ou WAV');
 const fileBytes=result.stdout;
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
export function deactivateOwnerRecording(){
 if(!ownerOnly())throw Error('OWNER_ACCOUNT_ONLY');
 const meta=getSetting('owner_approved_pitch_recording',null);
 if(meta)setSetting('owner_approved_pitch_recording',{...meta,active:false});
 return approvedOwnerRecordingStatus();
}
