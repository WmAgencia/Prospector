// Read-only continuity checks: notify the owner, NEVER resend uncertain steps.
import {one,all,getSetting,now} from './db.mjs';
import {queueNotice} from './notifications.mjs';
import {brazilDay} from './kanban-period.mjs';
import {insideApproachWindow,saoPauloClock} from './outreach-window.mjs';
import {approachQueueStatus,autonomousReadyCount} from './prospecting-queue.mjs';

export function auditProspectingWorkflow({at=new Date()}={}){
 const date=brazilDay(at);
 let alerts=0;
 const afterStart=saoPauloClock(at)>=8*60+20;
 if(afterStart&&insideApproachWindow(at)&&getSetting('autonomous_outreach_enabled',false)===true&&getSetting('paused',true)===false){
  const queue=approachQueueStatus();
  const started=one("SELECT COUNT(*) AS n FROM prospecting_batch_items WHERE attempt_at>=? AND status IN ('SENDING','SENT','UNKNOWN')",
   new Date(Date.parse(date+'T00:00:00Z')+3*3600000).toISOString())?.n||0;
  const waiting=queue.waiting;
  if(started===0&&(waiting>0||autonomousReadyCount(at)>0)){
   const msg='*Prospector — fila não começou a abordar*\nDia: '+date+
    '\nA fila contém contatos elegíveis, mas nenhuma tentativa foi registrada até depois das 08h20.'+
    '\nVerifique sessões, autorização e o trabalhador de envio antes de tentar novas mensagens.';
   if(queueNotice('prospector-stalled-queue:'+date,'PITCH_DELIVERY_ISSUE',msg))alerts++;
  }
 }
 const threshold=new Date(at.getTime()-4*60000).toISOString();
 const pending=all(`SELECT p.lead_id,p.greeting_id,p.phone,p.stage,p.due_at,p.followup_due_at,p.followup_status,l.business
  FROM prospecting_introductions p JOIN leads l ON l.id=p.lead_id
  LEFT JOIN threads t ON t.lead_id=p.lead_id
  WHERE COALESCE(t.manual_takeover,0)=0 AND l.stage NOT IN ('NO_INTEREST','INTERESTED','CLOSED_WON')
   AND (
    (p.stage IN ('WAITING','VOICE_WAITING') AND p.due_at<?)
    OR (p.stage='VOICE_SENT' AND p.followup_status='WAITING' AND p.followup_due_at<?)
   ) ORDER BY p.updated_at LIMIT 25`,threshold,threshold);
 for(const item of pending){
  const step=item.stage==='WAITING'?'pergunta de autorização do áudio':
   item.stage==='VOICE_WAITING'?'envio do áudio aprovado':'envio do vídeo após o áudio';
  const text='*Prospector — etapa aguardando conferência*\nEtapa: '+step+
   '\nEmpresa: '+String(item.business||'').slice(0,80)+'\nDestino: '+item.phone+
   '\nWhatsApp: https://wa.me/'+item.phone+
   '\nNão repetir mídia sem verificar o histórico e o identificador da mensagem.';
  if(queueNotice('prospector-stuck:'+item.greeting_id+':'+item.stage,'PITCH_DELIVERY_ISSUE',text,item.lead_id))alerts++;
 }
 return {alerts,stalledSteps:pending.length,checkedAt:now()};
}
