// Bind the approved original R$550 audio and site demonstration to current
// Consecom workflows. Existing workflow selections and in-flight snapshots stay intact.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {all,run,now,id,setSetting} from './db.mjs';
import {PITCH_AUDIO_ORIGINAL_SHA256,PITCH_AUDIO_SECONDS} from './portfolio-pitch-audio.mjs';
import {readPitchVideo} from './prospecting-introduction.mjs';
import {CAMPAIGN_NAME,buildConsecomSteps} from './consecom-flow.mjs';

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

function readOriginalAudio(){
 const n=Number(process.env.PROSPECTOR_PITCH_AUDIO_PARTS);
 if(!Number.isInteger(n)||n<1||n>48)throw Error('PITCH_AUDIO_PARTS_NOT_CONFIGURED');
 const pieces=Array.from({length:n},(_,i)=>process.env['PROSPECTOR_PITCH_AUDIO_B64_'+String(i).padStart(2,'0')]);
 if(pieces.some(s=>!s||!/^[A-Za-z0-9+/=]+$/.test(s)))throw Error('PITCH_AUDIO_PART_MISSING');
 const bytes=Buffer.from(pieces.join(''),'base64');
 if(bytes.length<100000||bytes.length>2*1024*1024||bytes.toString('ascii',0,4)!=='OggS'||
   sha(bytes)!==PITCH_AUDIO_ORIGINAL_SHA256||
   process.env.PROSPECTOR_PITCH_AUDIO_SOURCE_SHA256!==PITCH_AUDIO_ORIGINAL_SHA256)
  throw Error('PITCH_AUDIO_SOURCE_INVALID');
 return bytes;
}
function registerAsset({name,kind,mime,ext,bytes,duration}){
 const root=path.resolve(process.env.PROSPECTOR_DATA_DIR||'data','media');
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const digest=sha(bytes);
 for(const row of all('SELECT * FROM media WHERE name=? AND kind=? ORDER BY created_at DESC',name,kind)){
  if(path.basename(row.filename)!==row.filename)continue;
  try{
   const file=path.join(root,row.filename);
   const st=fs.lstatSync(file);
   if(st.isFile()&&!st.isSymbolicLink()&&st.size===bytes.length&&sha(fs.readFileSync(file))===digest)return row.id;
  }catch{}
 }
 const mediaId=id(),filename=mediaId+'.'+ext,target=path.join(root,filename);
 fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600});
 try{
  run('INSERT INTO media VALUES(?,?,?,?,?,?,?,?)',
   mediaId,name,kind,mime,filename,duration,bytes.length,now());
 }catch(error){try{fs.unlinkSync(target);}catch{}throw error;}
 return mediaId;
}
export function bootstrapConsecomCampaign(){
 if(process.env.PROSPECTOR_TENANT_ID&&process.env.PROSPECTOR_TENANT_INTERNAL!=='true')
  return {skipped:true,reason:'TENANT_ISOLATION'};
 const audio=readOriginalAudio(),video=readPitchVideo().bytes;
 const audioId=registerAsset({name:'Consecom proposta original R$550 2026-11-19',
  kind:'audio',mime:'audio/ogg',ext:'ogg',bytes:audio,duration:PITCH_AUDIO_SECONDS});
 const videoId=registerAsset({name:'Consecom video demonstrativo 2026-11-19',
  kind:'video',mime:'video/mp4',ext:'mp4',bytes:video,duration:44.166667});
 let updated=0;
 for(const workflow of all('SELECT * FROM workflows WHERE name=? OR name=?',
  CAMPAIGN_NAME,'Consecom | Site profissional R$ 350 | Áudio + vídeo')){
  const steps=buildConsecomSteps({audioId,videoId,existingSteps:JSON.parse(workflow.steps)});
  const serialized=JSON.stringify(steps);
  if(workflow.name!==CAMPAIGN_NAME||workflow.steps!==serialized){
   run('UPDATE workflows SET name=?,steps=?,version=version+1,updated_at=? WHERE id=?',
    CAMPAIGN_NAME,serialized,now(),workflow.id);
   updated++;
  }
 }
 setSetting('consecom_550_audio_media_id',audioId);
 setSetting('consecom_550_video_media_id',videoId);
 return {ready:true,audioReady:true,videoReady:true,updatedWorkflows:updated,offerBRL:550,videoDelaySeconds:10};
}
