import {one,getSetting,setSetting,addLead,phone,audit} from './db.mjs';
import {connection,startWorkflow,drive} from './runtime.mjs';
import {validateCampaignForActivation} from './campaign-selection.mjs';
import {isInvitationWorkflow} from './permission-invitation.mjs';

// Private, expiring deployment instruction. No public test endpoint or recipient in source.
export function queueOperatorTest(config=null){
 if(config===null){
  if(!process.env.PROSPECTOR_CAMPAIGN_TEST)return null;
  try{config=JSON.parse(process.env.PROSPECTOR_CAMPAIGN_TEST);}catch{return {status:'INVALID_CONFIG'};}
 }
 if(!config?.requestId||getSetting('operator_test_request_id','')===config.requestId)return null;
 if(!Number.isFinite(Date.parse(config.expiresAt))||Date.parse(config.expiresAt)<=Date.now())return {status:'EXPIRED'};
 const target=phone(config.phone),senderSuffix=String(config.senderSuffix||'');
 if(!target||!/^\d{4}$/.test(senderSuffix))throw Error('Configuração do teste inválida');
 const connected=connection();
 if(connected.status!=='CONNECTED')return {status:'WAITING_CONNECTION'};
 const sender=String(connected.user||'').split(':')[0].split('@')[0];
 if(!sender.endsWith(senderSuffix)||sender===target)throw Error('Número conectado diferente do remetente solicitado para o teste');
 const campaign=one('SELECT * FROM workflows WHERE id=? AND enabled=1',getSetting('autonomous_campaign_id',''));
 validateCampaignForActivation(campaign);
 if(!isInvitationWorkflow(campaign))throw Error('Campanha de convite não está ativa');
 let lead=one('SELECT * FROM leads WHERE phone=?',target);
 if(!lead)lead=addLead({phone:target,business:'Teste de campanha solicitado pelo operador',source:'OPERATOR_TEST'}).lead;
 if(one('SELECT phone FROM suppressions WHERE phone=?',target))throw Error('O destinatário de teste está na lista de recusa');
 let execution=one('SELECT * FROM executions WHERE lead_id=?',lead.id);
 if(!execution){const executionId=startWorkflow(lead.id,campaign.id);drive(executionId);execution=one('SELECT * FROM executions WHERE id=?',executionId);}
 const first=one("SELECT id FROM jobs WHERE execution_id=? AND step_index=0 AND status='PENDING'",execution.id);
 setSetting('operator_test_request_id',config.requestId);
 setSetting('operator_test_lead_id',lead.id);
 setSetting('operator_test_job_id',first?.id||'');
 setSetting('operator_test_expires_at',config.expiresAt);
 audit('OPERATOR_CAMPAIGN_TEST_REQUESTED',lead.id,{requestId:config.requestId,executionId:execution.id});
 const result={status:first?'QUEUED':execution.state,senderSuffix,targetSuffix:target.slice(-4),requestId:config.requestId};
 console.info('[campaign test]',JSON.stringify(result));
 return result;
}
