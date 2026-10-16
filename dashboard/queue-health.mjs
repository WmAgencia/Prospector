// Diagnóstico da fila, sem PII, sem executar nem reenviar mensagens.
// Nunca reprocessar UNKNOWN ou SENDING: o provedor pode ter aceitado o envio.
import {all,one,run,audit,now,getSetting} from './db.mjs';
import {initialBudget,hourSP,canSendInitial} from './radar.mjs';
import {automaticCandidateSql} from './outreach-queue.mjs';

export const INITIAL_PENDING_MAX_AGE_MINUTES=8;
export function queueHealth({at=new Date(),waStatus='DISCONNECTED',busy=false}={}){
 const b=initialBudget(at),hour=hourSP(at);
 const selected=String(getSetting('autonomous_campaign_id','')||'');
 const campaign=selected?one('SELECT id,name,enabled FROM workflows WHERE id=?',selected):null;
 const jobStates=Object.fromEntries(all('SELECT status,COUNT(*) n FROM jobs GROUP BY status').map(x=>[x.status,x.n]));
 const initial=all("SELECT j.id,j.status,j.created_at,j.updated_at,j.execution_id,e.state AS execution_state,t.manual_takeover FROM jobs j LEFT JOIN executions e ON e.id=j.execution_id LEFT JOIN threads t ON t.lead_id=j.lead_id WHERE j.execution_id IS NOT NULL AND j.step_index=0 AND j.status IN ('PENDING','SENDING','UNKNOWN') ORDER BY j.created_at ASC LIMIT 100");
 const pending=initial.filter(x=>x.status==='PENDING'||x.status==='SENDING');
 const firstPending=pending[0]||null;
 const pendingAge=firstPending?Math.max(0,Math.floor((at.getTime()-(Date.parse(firstPending.created_at)||at.getTime()))/60000)):null;
 const eligible=one(automaticCandidateSql());
 const last=one("SELECT MAX(updated_at) at FROM jobs WHERE execution_id IS NOT NULL AND step_index=0 AND status='SENT'");
 const lastConfirmedInitialAt=last?.at||null;
 const lastConfirmedMinutes=lastConfirmedInitialAt?Math.max(0,Math.floor((at.getTime()-Date.parse(lastConfirmedInitialAt))/60000)):null;
 let reason='READY';
 if(getSetting('paused',true))reason='PAUSED';
 else if(waStatus!=='CONNECTED')reason='WHATSAPP_OFFLINE';
 else if(!getSetting('auto_initial',false))reason='AUTOMATION_DISABLED';
 else if(!campaign||!campaign.enabled)reason='NO_ACTIVE_CAMPAIGN';
 else if(hour<b.start||hour>=b.end)reason='OUTSIDE_WINDOW';
 else if(b.counted>=b.limit)reason='DAILY_CAP_REACHED';
 else if(b.nextAt&&Date.parse(b.nextAt)>at.getTime())reason='WAITING_CADENCE';
 else if(firstPending)reason='INITIAL_JOB_PENDING';
 else if(!eligible)reason='NO_ELIGIBLE_LEADS';
 else if(busy)reason='WORKER_BUSY';
 const dormant=reason==='INITIAL_JOB_PENDING'&&pendingAge>=INITIAL_PENDING_MAX_AGE_MINUTES;
 const invalidPending=initial.filter(x=>x.status==='PENDING'&&(x.execution_state!=='SENDING'||x.manual_takeover===1));
 return {
  at:at.toISOString(),reason,alert:dormant?'STALE_INITIAL_PENDING':null,
  allowedNow:reason==='READY',campaignSelected:!!campaign?.enabled,waConnected:waStatus==='CONNECTED',
  paused:getSetting('paused',true),autoInitial:getSetting('auto_initial',false),
  initialToday:{sent:b.confirmed,uncertain:b.uncertain,inFlight:b.sending,counted:b.counted,limit:b.limit,nextAt:b.nextAt},
  eligibleWaiting:!!eligible,initialPending:pending.length,oldestPendingMinutes:pendingAge,
  invalidPending:invalidPending.length,unknownInitial:initial.filter(x=>x.status==='UNKNOWN').length,
  lastConfirmedInitialAt,lastConfirmedMinutes,
  jobs:jobStates,
  decryptionNote:'Erros de descriptografia não autorizam reenvio automático nem recriação da sessão'
 };
}
// Somente jobs definitivamente impossíveis de entregar pelo fluxo corrente
// são encerrados. PENDING válido, SENDING e UNKNOWN permanecem inalterados.
export function reconcileOrphanPending({at=new Date()}={}){
 const cutoff=new Date(at.getTime()-INITIAL_PENDING_MAX_AGE_MINUTES*60000).toISOString();
 const stale=all("SELECT j.id,j.lead_id,j.execution_id,e.state AS execution_state,t.manual_takeover FROM jobs j LEFT JOIN executions e ON e.id=j.execution_id LEFT JOIN threads t ON t.lead_id=j.lead_id WHERE j.status='PENDING' AND j.execution_id IS NOT NULL AND j.updated_at<? LIMIT 100",cutoff);
 let repaired=0;
 for(const j of stale){
  if(j.execution_state==='SENDING'&&!j.manual_takeover)continue;
  const reason=j.manual_takeover?'HUMAN_TAKEOVER':j.execution_state||'MISSING_EXECUTION';
  const update=run("UPDATE jobs SET status='CANCELLED',error=?,updated_at=? WHERE id=? AND status='PENDING'",'Fluxo inválido: '+reason,now(),j.id);
  if(update.changes){
   audit('ORPHAN_PENDING_CANCELLED',j.lead_id,{jobId:j.id,reason});
   repaired++;
  }
 }
 return {examined:stale.length,repaired};
}
