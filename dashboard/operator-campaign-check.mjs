import {one,all,getSetting,setSetting,addLead,phone,audit} from './db.mjs';
import {connection,startWorkflow,drive,bindLeadPeer,requestStoredReply,incoming,isRelevantBufferedReply} from './runtime.mjs';
import {validateCampaignForActivation} from './campaign-selection.mjs';
import {retryMessage} from './whatsapp-recovery.mjs';
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

let refreshing=false,lastRefresh=0,identityBound=false,lastReport='';
const requestedResends=new Set();
export async function refreshOperatorReplies(){
 if(refreshing||Date.now()-lastRefresh<15000||connection().status!=='CONNECTED')return;
 if(Date.parse(getSetting('operator_test_expires_at',''))<=Date.now())return;
 const leadId=getSetting('operator_test_lead_id','');if(!leadId)return;
 refreshing=true;lastRefresh=Date.now();
 try{
  if(!identityBound)identityBound=await bindLeadPeer(leadId);
  const rows=all(`SELECT r.jid,r.message_id,r.key_json FROM whatsapp_retry_messages r
   JOIN whatsapp_peer_aliases a ON a.jid=r.jid
   WHERE a.lead_id=? AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.provider_id=r.message_id)
   AND r.at>=COALESCE((SELECT MIN(strftime('%s',created_at)*1000) FROM jobs WHERE lead_id=?),r.at)
   ORDER BY r.at DESC LIMIT 10`,leadId,leadId);
  const B=await import('@whiskeysockets/baileys');
  const unlinked=[];
  for(const row of rows){
   const key={remoteJid:row.jid,id:row.message_id,fromMe:false};
   const message=retryMessage(key,B.proto.Message);
   const metadata=row.key_json?JSON.parse(row.key_json):null;
   if(!message){
    if(metadata?.key?.fromMe===false&&!requestedResends.has(row.message_id)&&requestedResends.size<5){requestedResends.add(row.message_id);await requestStoredReply(metadata.key);}
    continue;
   }
   const envelope={key:metadata?.key||key,message,messageTimestamp:metadata?.timestamp};
   if(metadata?.key?.fromMe===false&&isRelevantBufferedReply(envelope)){await incoming(envelope);continue;}
   if(metadata?.key?.fromMe===true)continue;
   const text=message.conversation||message.extendedTextMessage?.text||'';
   if(text)unlinked.push({text:text.slice(0,500),senderMetadataKnown:!!metadata});
   // Recover old buffered messages through the provider; never infer who sent them.
   if(!metadata&&!requestedResends.has(row.message_id)&&requestedResends.size<5){
    requestedResends.add(row.message_id);await requestStoredReply(key);
   }
  }
  const messages=all("SELECT m.body,m.type,m.at FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.lead_id=? AND m.direction='in' ORDER BY m.at DESC LIMIT 5",leadId);
  const execution=one('SELECT state,next_step FROM executions WHERE lead_id=?',leadId);
  const report=JSON.stringify({status:'REPLY_DIAGNOSTIC',identityBound,execution,replies:messages.map(m=>({text:m.body.slice(0,500),type:m.type,at:m.at})),unlinked});
  if(report!==lastReport){lastReport=report;console.info('[campaign test]',report);}
 }finally{refreshing=false;}
}
