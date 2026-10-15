// Um pacote local de mídias e roteiro, sem publicação dos arquivos no GitHub.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {one,run,tx,id,now,audit,getSetting,setSetting} from './db.mjs';
import {CAMPAIGN_NAME,CAMPAIGN_INTRO,CAMPAIGN_VIDEO_CAPTION,CAMPAIGN_FAREWELL,buildConsecomSteps} from './consecom-flow.mjs';
const expected=['campaign.json','audio.ogg','video.mp4'];
const mediaDir=path.resolve(process.env.PROSPECTOR_DATA_DIR||'data','media');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
export function extractStoredZip(buf){
 if(!Buffer.isBuffer(buf)||buf.length<34||buf.length>38*1024*1024)throw Error('Pacote ZIP inválido ou acima de 38 MB');
 const files=new Map();let p=0;
 while(p+4<=buf.length&&buf.readUInt32LE(p)===0x04034b50){
  if(p+30>buf.length)throw Error('ZIP incompleto');
  const flags=buf.readUInt16LE(p+6),method=buf.readUInt16LE(p+8),size=buf.readUInt32LE(p+18),uncompressed=buf.readUInt32LE(p+22);
  const n=buf.readUInt16LE(p+26),e=buf.readUInt16LE(p+28),start=p+30+n+e,end=start+size;
  if(flags&1||flags&8||method!==0||size!==uncompressed||n>100||e!==0||end>buf.length)throw Error('ZIP precisa ser o pacote oficial sem compressão');
  const name=buf.toString('utf8',p+30,p+30+n);
  if(!expected.includes(name)||files.has(name))throw Error('Arquivo duplicado ou não permitido no pacote: '+name);
  files.set(name,buf.subarray(start,end));p=end;
 }
 if(files.size!==expected.length||expected.some(k=>!files.has(k))||p+4>buf.length||buf.readUInt32LE(p)!==0x02014b50)throw Error('Pacote incompleto: campanha, áudio e vídeo obrigatórios');
 return Object.fromEntries(files);
}
// Interface compatível com o pacote ZIP v1: os textos atuais prevalecem sobre
// manifestos antigos. Áudio e vídeo originais seguem preservados por SHA-256.
export function buildCampaignSteps({audioId='',videoId=''}={}){
 return buildConsecomSteps({audioId,videoId});
}
function probe(file){
 const r=spawnSync('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name:format=duration','-of','json',file],{encoding:'utf8',timeout:15000});
 if(r.error||r.status!==0)throw Error('Não foi possível validar o áudio ou vídeo enviado');
 try{return JSON.parse(r.stdout);}catch{throw Error('FFprobe retornou dados inválidos');}
}
export function importCampaignPackage(buf){
 const parts=extractStoredZip(buf);
 const audio=parts['audio.ogg'],video=parts['video.mp4'],config=parts['campaign.json'];
 if(config.length>10000||config.length<50||audio.length>25*1024*1024||video.length>65*1024*1024||!audio.length||!video.length)throw Error('Tamanho dos arquivos inválido');
 let m;try{m=JSON.parse(config.toString('utf8'));}catch{throw Error('Manifesto da campanha inválido');}
 if(m.version!==1||m.requires_explicit_permission!==true||m.video_muted!==true)throw Error('Pacote de campanha não reconhecido');
 if(!/^[a-f0-9]{64}$/.test(m.audio_sha256||'')||!/^[a-f0-9]{64}$/.test(m.video_sha256||'')||sha(audio)!==m.audio_sha256||sha(video)!==m.video_sha256)throw Error('A integridade do áudio ou vídeo não confere');
 if(audio.toString('ascii',0,4)!=='OggS'||video.toString('ascii',4,8)!=='ftyp')throw Error('Formatos de áudio/vídeo inesperados');
 const intro=String(m.intro||'').trim(),name=String(m.campaign_name||'').trim(),description=String(m.audio_description||'').trim(),farewell=String(m.farewell||'').trim(),delay_seconds=Number(m.delay_seconds);
 if(!intro||intro.length>600||!name||name.length>140||!description||description.length>1500||!farewell||farewell.length>400||!Number.isInteger(delay_seconds)||delay_seconds<1||delay_seconds>3600)throw Error('Dados de campanha inválidos');
 if(sha(buf)===getSetting('campaign_bundle_hash','')&&one('SELECT id FROM workflows WHERE id=?',getSetting('campaign_bundle_workflow','')))return {ok:true,alreadyInstalled:true,workflowId:getSetting('campaign_bundle_workflow',''),paused:getSetting('paused',true)};
 fs.mkdirSync(mediaDir,{recursive:true});
 const audioId=id(),videoId=id();
 const seededId=getSetting('consecom_campaign_seed_id','');
 const seed=seededId?one('SELECT id,enabled FROM workflows WHERE id=?',seededId):null;
 const workflowId=seed?.enabled===0?seed.id:id();
 const audioPath=path.join(mediaDir,audioId+'.ogg'),videoPath=path.join(mediaDir,videoId+'.mp4');
 let audioWritten=false,videoWritten=false;
 try{
  fs.writeFileSync(audioPath,audio,{flag:'wx'});audioWritten=true;
  fs.writeFileSync(videoPath,video,{flag:'wx'});videoWritten=true;
  const a=probe(audioPath),v=probe(videoPath);
  const audioDuration=Number(a.format?.duration),videoDuration=Number(v.format?.duration);
  if(!a.streams?.some(s=>s.codec_type==='audio')||!Number.isFinite(audioDuration)||audioDuration<=0||audioDuration>180)throw Error('Áudio incompatível');
  if(!v.streams?.some(s=>s.codec_type==='video')||v.streams.some(s=>s.codec_type==='audio')||!Number.isFinite(videoDuration)||videoDuration<=0||videoDuration>60)throw Error('O vídeo precisa ter até 60 segundos e NÃO conter áudio');
  const steps=buildCampaignSteps({audioId,videoId});
  tx(()=>{
   run('INSERT INTO media VALUES(?,?,?,?,?,?,?,?)',audioId,String(m.audio_name||'Áudio de apresentação').slice(0,100),'audio','audio/ogg',audioId+'.ogg',audioDuration,audio.length,now());
   run('INSERT INTO media VALUES(?,?,?,?,?,?,?,?)',videoId,String(m.video_name||'Vídeo sem som').slice(0,100),'video','video/mp4',videoId+'.mp4',videoDuration,video.length,now());
   if(seed?.enabled===0){
    run('UPDATE workflows SET name=?,steps=?,version=version+1,enabled=1,updated_at=? WHERE id=?',name,JSON.stringify(steps),now(),workflowId);
   }else{
    run('INSERT INTO workflows(id,name,is_default,version,steps,created_at,updated_at,segments_json,enabled) VALUES(?,?,?,?,?,?,?,?,?)',workflowId,name,0,1,JSON.stringify(steps),now(),now(),'[]',1);
   }
   run('UPDATE workflows SET is_default=0');
   run('UPDATE workflows SET is_default=1 WHERE id=?',workflowId);
   setSetting('autonomous_campaign_id',workflowId);setSetting('auto_initial',true);
   setSetting('campaign_bundle_hash',sha(buf));setSetting('campaign_bundle_workflow',workflowId);
   audit('CONSECOM_CAMPAIGN_BUNDLE_INSTALLED',null,{workflowId,audioId,videoId,videoMuted:true,authorizationRequired:true,paused:getSetting('paused',true)});
  });
  return {ok:true,alreadyInstalled:false,workflowId,audioId,videoId,videoMuted:true,paused:getSetting('paused',true)};
 }catch(error){
  if(audioWritten)try{fs.unlinkSync(audioPath);}catch{}
  if(videoWritten)try{fs.unlinkSync(videoPath);}catch{}
  throw error;
 }
}