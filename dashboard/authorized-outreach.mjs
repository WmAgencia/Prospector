// Ativação única solicitada pelo operador. Não inicia mensagens para leads coletados
// da internet: o motor exige opt-in DOCUMENTADO e respeita horários/limites.
import {getSetting,setSetting,audit,one} from './db.mjs';
import {validateCampaignForActivation} from './campaign-selection.mjs';
import {outreachQueueSnapshot} from './outreach-queue.mjs';
const ROLLOUT_KEY='automatic_authorized_outreach_rollout_20261015';
export function enableAuthorizedOutreach(){
 const queue=outreachQueueSnapshot();
 if(getSetting(ROLLOUT_KEY,false))return {status:'CONFIGURED',paused:getSetting('paused',true),autoInitial:getSetting('auto_initial',false),...queue};
 const id=getSetting('autonomous_campaign_id','');
 const campaign=id?one('SELECT * FROM workflows WHERE id=? AND enabled=1',id):null;
 try{validateCampaignForActivation(campaign);}catch(err){
  return {status:'WAITING_VALID_CAMPAIGN',error:String(err.message).slice(0,160),...queue};
 }
 // As buscas já cadastram as descobertas no Kanban automaticamente.
 // O envio continua condicionado à autorização documentada por destinatário.
 for(const [key,value] of Object.entries({
  paused:false,auto_initial:true,automation_enabled:true,
  daily_limit:150,business_start:8,business_end:18,initial_interval_seconds:240,
  discovery_auto_enabled:true,discovery_target_daily:150,discovery_start_hour:5
 }))setSetting(key,value);
 setSetting(ROLLOUT_KEY,true);
 audit('AUTHORIZED_OUTREACH_ENABLED',null,{campaignId:id,limit:150,hours:'08:00-18:00',intervalSeconds:240,
  requiresDocumentedOptIn:true,ready:queue.ready,waiting:queue.awaitingConsent});
 return {status:'ENABLED',paused:false,campaignId:id,...queue};
}
