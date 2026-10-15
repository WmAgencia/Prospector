// Ponte GitHub -> SQLite: escrita autenticada no GitHub, importação restrita.
// O módulo não recebe SQL, comandos, URL de download ou tokens pelo manifesto.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {one,all,run,tx,id,now,getSetting,setSetting,audit} from './db.mjs';
import {CAMPAIGN_NAME,buildConsecomSteps} from './consecom-flow.mjs';

const MANIFEST_URL='https://raw.githubusercontent.com/WmAgencia/Prospector/main/bridge/campaigns/consecom-350.json';
const MEDIA_DIR=path.resolve(process.env.PROSPECTOR_DATA_DIR||'data','media');
const AUDIO_EXT=/^[0-9a-f-]{36}\.(?:ogg|opus)$/i;
const VIDEO_EXT=/^[0-9a-f-]{36}\.mp4$/i;
const SHAS=/^[a-f0-9]{64}$/;
const MAX_MANIFEST=16000;
let syncBusy=false;
const snapshot=()=>getSetting('agent_bridge_status',{state:'NOT_SYNCED',ready:false,updatedAt:null});
export const bridgeStatus=()=>({...snapshot(),manifestUrl:MANIFEST_URL,paused:getSetting('paused',true)});

function boundedText(value,max,label){
 if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw Error('Valor de '+label+' inválido');
 return value.trim();
}
const positiveInt=(value,label,max)=>{if(!Number.isInteger(value)||value<1||value>max)throw Error('Prazo '+label+' inválido');return value;};
export function validateAgentManifest(x){
 if(!x||typeof x!=='object'||Array.isArray(x)||x.schema!=='consecom.prospector.ai-bridge/v1')throw Error('Esquema de ponte não reconhecido');
 if(x.task_id!=='consecom-campanha-sites-350'||!Number.isInteger(x.revision)||x.revision<1||x.mode!=='upsert_campaign_draft')throw Error('Tarefa de ponte não autorizada');
 if(!x.campaign||!x.media||!x.safeguards)throw Error('Campos obrigatórios ausentes');
 const g=x.safeguards;
 if(g.requires_contact_permission!==true||g.preserve_paused_state!==true||g.never_start_sending_during_sync!==true||g.daily_initial_cap!==150||g.no_automatic_example_sites!==true)throw Error('Regras de proteção não podem ser removidas');
 const c=x.campaign;
 if(c.name!==CAMPAIGN_NAME||c.wait_for_first_reply!==true||c.wait_for_final_reply!==true||c.interested_action!=='handover_to_kanban'||c.not_interested_action!=='farewell_to_no_interest')throw Error('Campanha ou destino do Kanban inválidos');
 const result={
  name:c.name,
  intro:boundedText(c.initial_message,600,'abordagem'),
  before:positiveInt(c.delay_before_audio_seconds,'antes do áudio',3600),
  after:positiveInt(c.delay_after_audio_seconds,'depois do áudio',3600),
  caption:boundedText(c.video_caption,500,'legenda'),
  farewell:boundedText(c.farewell_message,400,'despedida'),
  audio_description:boundedText(c.audio_description,1500,'descrição do áudio'),
  revision:x.revision,
  audioHash:String(x.media.audio?.sha256||''),videoHash:String(x.media.video?.sha256||'')
 };
 if(!result.intro.includes('{{greeting}}'))throw Error('Abordagem deve preservar a saudação personalizada');
 if(!SHAS.test(result.audioHash)||!SHAS.test(result.videoHash))throw Error('Hashes dos arquivos não são válidos');
 if(x.media.audio?.mime!=='audio/ogg'||x.media.video?.mime!=='video/mp4'||x.media.video?.muted!==true||x.media.video?.max_duration_seconds!==60)throw Error('Mídia incompatível com esta campanha');
 return result;
}
function safeMediaFile(row){
 const name=String(row.filename||'');
 if(!(row.kind==='audio'&&AUDIO_EXT.test(name)||row.kind==='video'&&VIDEO_EXT.test(name)))return null;
 const f=path.join(MEDIA_DIR,name);
 if(!f.startsWith(MEDIA_DIR+path.sep))return null;
 try{const st=fs.statSync(f);if(st.isFile()&&st.size>0&&st.size<70*1024*1024)return f;}catch{}
 return null;
}
function shaFile(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function isMute(file){
 const p=spawnSync('ffprobe',['-v','error','-show_entries','stream=codec_type:format=duration','-of','json',file],{encoding:'utf8',timeout:15000});
 if(p.error||p.status!==0)return false;
 try{
  const data=JSON.parse(p.stdout),duration=Number(data.format?.duration);
  return duration>0&&duration<=60&&data.streams?.some(s=>s.codec_type==='video')&&!data.streams.some(s=>s.codec_type==='audio');
 }catch{return false;}
}
export function findBridgeMedia(kind,hash){
 for(const row of all("SELECT * FROM media WHERE kind=? ORDER BY created_at DESC LIMIT 200",kind)){
  const f=safeMediaFile(row);
  if(!f)continue;
  try{if(shaFile(f)===hash&&(kind!=='video'||isMute(f)))return row;}catch{}
 }
 return null;
}
function findTarget(){
 const candidates=[getSetting('agent_bridge_workflow_id',''),getSetting('autonomous_campaign_id',''),getSetting('campaign_bundle_workflow',''),getSetting('consecom_campaign_seed_id','')].filter(Boolean);
 for(const workflowId of candidates){
  const w=one('SELECT * FROM workflows WHERE id=?',workflowId);
  if(w?.name===CAMPAIGN_NAME)return w;
 }
 return one('SELECT * FROM workflows WHERE name=? ORDER BY updated_at DESC LIMIT 1',CAMPAIGN_NAME);
}
function persistStatus(value){
 const status={...value,updatedAt:now()};
 setSetting('agent_bridge_status',status);
 return bridgeStatus();
}
export function reconcileAgentManifest(data){
 const m=validateAgentManifest(data);
 const inputHash=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
 const paused=getSetting('paused',true);
 if(!paused)return persistStatus({state:'PAUSED_REQUIRED',ready:false,revision:m.revision,message:'Pausar operação antes de aplicar alterações de campanha. Nenhum envio foi interrompido.',manifestHash:inputHash});
 const a=findBridgeMedia('audio',m.audioHash),v=findBridgeMedia('video',m.videoHash);
 const ready=!!a&&!!v;
 const prev=findTarget(),old=prev?JSON.parse(prev.steps):[];
 const steps=buildConsecomSteps({audioId:a?.id||'',videoId:v?.id||'',existingSteps:old});
 steps[0].text=m.intro;
 steps[2].seconds=m.before;
 steps[3].description=m.audio_description;
 steps[4].seconds=m.after;
 steps[5].caption=m.caption;
 steps[7].no_text=m.farewell;
 const content=JSON.stringify(steps);
 const enable=ready?1:0;
 const oldText=prev?.steps||'',needsSave=!prev||oldText!==content||Number(prev.enabled)!==enable;
 const workflowId=prev?.id||id();
 tx(()=>{
  if(!prev)run('INSERT INTO workflows(id,name,is_default,version,steps,created_at,updated_at,segments_json,enabled) VALUES(?,?,?,?,?,?,?,?,?)',workflowId,m.name,0,1,content,now(),now(),'[]',enable);
  else if(needsSave)run('UPDATE workflows SET name=?,steps=?,version=version+1,updated_at=?,enabled=? WHERE id=?',m.name,content,now(),enable,workflowId);
  setSetting('agent_bridge_workflow_id',workflowId);
  if(ready){
   run('UPDATE workflows SET is_default=0');
   run('UPDATE workflows SET is_default=1 WHERE id=?',workflowId);
   setSetting('autonomous_campaign_id',workflowId);
   // A flag auto_initial e o estado de pausa NÃO são alterados pela ponte.
  }
  if(needsSave)audit('AGENT_BRIDGE_APPLIED',null,{workflowId,revision:m.revision,ready,audio:!!a,video:!!v,manifestHash:inputHash});
 });
 return persistStatus({state:ready?'READY':'WAITING_MEDIA',ready,revision:m.revision,workflowId,manifestHash:inputHash,
  audio:{present:!!a,sha256:m.audioHash,name:data.media.audio.name},
  video:{present:!!v,muted:true,sha256:m.videoHash,name:data.media.video.name},
  message:ready?'Campanha configurada. Pausa preservada; nenhum envio iniciado.':'Campanha sincronizada. Aguardando upload privado das mídias correspondentes aos hashes.'});
}
export async function syncAgentBridge(){
 if(syncBusy)return bridgeStatus();
 syncBusy=true;
 try{
  const response=await fetch(MANIFEST_URL,{headers:{Accept:'application/json','User-Agent':'consecom-prospector-bridge/1.0','Cache-Control':'no-cache'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Repositório indisponível (HTTP '+response.status+')');
  const length=Number(response.headers.get('content-length')||0);
  if(length>MAX_MANIFEST)throw Error('Manifesto excede 16 KB');
  const bytes=await response.text();
  if(bytes.length>MAX_MANIFEST)throw Error('Manifesto excede 16 KB');
  const manifest=JSON.parse(bytes);
  return reconcileAgentManifest(manifest);
 }catch(e){
  const prev=snapshot();
  return persistStatus({...prev,state:'SYNC_ERROR',ready:false,message:String(e.message).slice(0,200)});
 }finally{syncBusy=false;}
}
export const bridgeSpec=()=>({
 schema:'consecom.prospector.ai-bridge/v1',
 githubManifest:'WmAgencia/Prospector:bridge/campaigns/consecom-350.json',
 githubBranch:'main',
 methods:{
  status:{method:'GET',path:'/api/agent-bridge/status',auth:'admin_session'},
  sync:{method:'POST',path:'/api/agent-bridge/sync',auth:'admin_session'},
  uploadPackage:{method:'POST',path:'/api/campaign/import-package',contentType:'application/zip',auth:'admin_session'},
  uploadAudio:{method:'POST',path:'/api/media?kind=audio&name=audio.ogg',contentType:'audio/ogg',auth:'admin_session'},
  uploadVideo:{method:'POST',path:'/api/media?kind=video&name=video.mp4',contentType:'video/mp4',auth:'admin_session'}
 },
 constraints:{noSQL:true,requiresConsent:true,neverUnpause:true,noSendingOnSync:true,sha256MediaMatch:true,mutedVideo:true}
});
