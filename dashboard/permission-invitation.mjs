import {one,getSetting,setSetting,audit,run,tx} from './db.mjs';
import {CAMPAIGN_NAME,CAMPAIGN_INTRO} from './consecom-flow.mjs';
import {validateCampaignForActivation} from './campaign-selection.mjs';
import {permitsPresentation} from './automation-router.mjs';

// A política do WhatsApp exige opt-in antes do primeiro contato. O convite não
// confere consentimento, então só roda com uma decisão jurídica registrada e
// explícita no ambiente: PROSPECTOR_INVITATION_LEGAL_BASIS=true.
const invitationLegalBasis=()=>process.env.PROSPECTOR_INVITATION_LEGAL_BASIS==='true';
export function isInvitationWorkflow(workflow){
 if(!invitationLegalBasis())return false;
 if(!workflow||getSetting('invitation_campaign_id','')!==workflow.id)return false;
 let steps;try{steps=typeof workflow.steps==='string'?JSON.parse(workflow.steps):workflow.steps;}catch{return false;}
 return steps?.[0]?.type==='message'&&steps[0].text===CAMPAIGN_INTRO&&steps[1]?.type==='wait_reply'&&steps[2]?.type==='delay'&&steps[3]?.type==='audio';
}
export function invitationEnabled(){
 if(!invitationLegalBasis())return false;
 const selected=getSetting('autonomous_campaign_id','');
 return !!selected&&isInvitationWorkflow(one('SELECT * FROM workflows WHERE id=? AND enabled=1',selected));
}
export function isInvitationJob(job){
 if(job.type!=='message'||job.step_index!==0||!job.execution_id)return false;
 const execution=one('SELECT workflow_id,steps FROM executions WHERE id=?',job.execution_id);
 return !!execution&&isInvitationWorkflow({id:execution.workflow_id,steps:execution.steps});
}
export function acceptPresentation(leadId,messageId,text){
 if(!messageId)return false;
 // Só uma resposta afirmativa explícita libera mídia e grava consentimento.
 const execution=one("SELECT steps,next_step FROM executions WHERE lead_id=? AND state='WAIT_REPLY'",leadId);
 let steps=null,nextStep=-1;
 if(execution){try{steps=JSON.parse(execution.steps);nextStep=execution.next_step;}catch{return false;}}
 if(!permitsPresentation(steps,nextStep,text))return false;
 run('UPDATE leads SET contact_permission=1 WHERE id=?',leadId);
 audit('CONSENT_UPDATED',leadId,{permitted:true,method:'whatsapp_presentation_acceptance',messageId,evidence:String(text).slice(0,1000)});
 return true;
}
export function enableInvitationCampaign(){
 const rollout='consecom_invitation_rollout_20261016';
 if(!invitationLegalBasis())return {status:'DISABLED_POLICY',enabled:false};
 if(getSetting(rollout,false))return {status:'CONFIGURED',enabled:invitationEnabled()};
 const campaign=one('SELECT * FROM workflows WHERE id=? AND enabled=1',getSetting('autonomous_campaign_id',''));
 if(campaign?.name!==CAMPAIGN_NAME)return {status:'WAITING_SELECTED_CAMPAIGN'};
 try{validateCampaignForActivation(campaign);}catch(error){return {status:'WAITING_MEDIA',error:error.message};}
 return tx(()=>{
  setSetting('invitation_campaign_id',campaign.id);
  if(!invitationEnabled())throw Error('A campanha não possui o convite e a espera de aceite esperados');
  setSetting('paused',false);setSetting('auto_initial',true);setSetting('automation_enabled',true);
  setSetting(rollout,true);
  audit('INVITATION_CAMPAIGN_ENABLED',null,{campaignId:campaign.id,requiresAcceptanceBeforeMedia:true});
  return {status:'ENABLED',enabled:true,campaignId:campaign.id};
 });
}
