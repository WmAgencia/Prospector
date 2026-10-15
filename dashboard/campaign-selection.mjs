// The only selected campaign determines automatic outreach.
// Preparation and selection are separate so drafts never send on save.
import fs from 'node:fs';
import path from 'node:path';
import {one,run,tx,now,getSetting,setSetting,audit} from './db.mjs';
const MEDIA_DIR=path.resolve(process.env.PROSPECTOR_DATA_DIR||'data','media');
export function validateCampaignForActivation(workflow){
 if(!workflow)throw Error('Campanha não encontrada');
 let steps;
 try{steps=JSON.parse(workflow.steps);}catch{throw Error('Etapas da campanha inválidas');}
 if(!Array.isArray(steps)||steps[0]?.type!=='message'||!String(steps[0].text||'').trim())throw Error('A abordagem inicial é obrigatória');
 if(steps.filter(x=>x.type==='wait_reply').length<2||!steps.some(x=>x.type==='decision'))throw Error('Campanha precisa aguardar autorização e decisão final');
 const audio=steps.filter(x=>x.type==='audio'),video=steps.filter(x=>x.type==='video');
 if(!audio.length||!video.length)throw Error('Inclua um áudio e um vídeo na campanha');
 for(const step of [...audio,...video]){
  const media=one('SELECT * FROM media WHERE id=?',step.media_id||'');
  if(!media||media.kind!==step.type)throw Error('A mídia "'+step.type+'" não está disponível na biblioteca');
  const file=String(media.filename||'');
  if(!/^[a-z0-9-]+\.(ogg|opus|mp3|m4a|mp4)$/i.test(file)||!fs.existsSync(path.join(MEDIA_DIR,file)))throw Error('Arquivo de '+step.type+' indisponível no servidor');
 }
 return steps;
}
export function selectedCampaign(){
 const id=String(getSetting('autonomous_campaign_id','')||'');
 if(!id)return null;
 const w=one('SELECT id,name,enabled,version,is_default,steps FROM workflows WHERE id=?',id);
 if(!w||!w.enabled)return null;
 return {id:w.id,name:w.name,enabled:true,version:w.version,isDefault:!!w.is_default};
}
export function activateCampaign(workflowId){
 if(typeof workflowId!=='string'||!workflowId||workflowId.length>100)throw Error('Selecione uma campanha válida');
 const w=one('SELECT * FROM workflows WHERE id=?',workflowId);
 validateCampaignForActivation(w);
 const previousId=String(getSetting('autonomous_campaign_id','')||'');
 return tx(()=>{
  run('UPDATE workflows SET is_default=0');
  run('UPDATE workflows SET enabled=1,is_default=1,updated_at=? WHERE id=?',now(),workflowId);
  setSetting('autonomous_campaign_id',workflowId);
  setSetting('auto_initial',true);
  audit('CAMPAIGN_SELECTED',null,{workflowId,previousId,preservedPaused:getSetting('paused',true)});
  return {ok:true,id:workflowId,name:w.name,previousId,paused:getSetting('paused',true)};
 });
}
export function rejectActiveCampaignEdit(input){
 if(!input?.id||input.id!==getSetting('autonomous_campaign_id',''))return;
 if(!getSetting('paused',true))throw Error('Pause as abordagens antes de editar a campanha ativa.');
 if(input.enabled!==true)throw Error('A edição da campanha ativa deve manter a campanha habilitada.');
 // O motor salva os passos no snapshot de cada execução; edições valem
 // apenas para novos contatos, preservando conversas já iniciadas.
}
