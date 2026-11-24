// Read-only six-checkpoint view of the existing idempotent WhatsApp workflow.
// Never label HTTP acceptance as handset delivery.
import {one} from './db.mjs';
import {textReceipt} from './prospecting-text-receipts.mjs';
import {pitchDeliveryReceipt} from './pitch-delivery-verification.mjs';
const done=new Set(['SENT','DELIVERED','READ','RECEIVED']);
const valid=new Set(['QUEUED','SENDING','ACCEPTED','SENT','DELIVERED','READ','RECEIVED','UNKNOWN','FAILED','CANCELLED','WAITING']);
const step=(key,label,status='WAITING',evidence=null)=>({key,label,status:valid.has(status)?status:'WAITING',evidence:evidence||null,confirmed:done.has(status)});
export function workflowChecklist({leadId,greetingId,queueStatus}={}){
 const intro=one('SELECT * FROM prospecting_introductions WHERE lead_id=?',leadId);
 const greetId=greetingId||intro?.greeting_id||'';
 const greeting=greetId?textReceipt(leadId,greetId,'GREETING'):null;
 const permission=greetId?textReceipt(leadId,greetId,'INTRO'):null;
 const audio=greetId?pitchDeliveryReceipt(leadId,greetId,'AUDIO'):null;
 const video=greetId?pitchDeliveryReceipt(leadId,greetId,'VIDEO'):null;
 const batch=greetId?one('SELECT status,attempt_at FROM prospecting_batch_items WHERE id=? AND lead_id=?',greetId,leadId):null;
 const getGreeting=()=>{
  if(greeting)return greeting.status;
  if(batch?.status==='SENT')return 'ACCEPTED'; // older records never had WhatsApp message IDs.
  if(['QUEUED','SENDING','UNKNOWN'].includes(queueStatus))return queueStatus;
  return 'WAITING';
 };
 const gotReply=Boolean(intro?.greeting_id===greetId&&intro.first_reply_id);
 const gotPermission=Boolean(audio||intro?.greeting_id===greetId&&
  (['VOICE_WAITING','VOICE_SENT'].includes(intro.stage)||
   intro.stage==='CONVERSING'&&intro.reason==='PITCH_AUDIO_550'));
 const checklist=[
  step('GREETING','1ª abordagem',getGreeting(),greeting?.provider_id||null),
  step('REPLY','Resposta recebida',gotReply?'RECEIVED':'WAITING',gotReply?intro.first_reply_id:null),
  step('INTRO','Pedido de áudio',permission?.status||
   (intro?.greeting_id===greetId&&['SENT','VOICE_WAITING','VOICE_SENT','CONVERSING'].includes(intro.stage)?'ACCEPTED':intro?.stage==='UNKNOWN'?'UNKNOWN':'WAITING'),
   permission?.provider_id||null),
  step('PERMISSION','Aceite do áudio',gotPermission?'RECEIVED':'WAITING'),
  step('AUDIO','Áudio da proposta',audio?.status||'WAITING',audio?.provider_id||null),
  step('VIDEO','Vídeo da proposta',video?.status||
   (intro?.greeting_id===greetId&&intro.followup_status==='UNKNOWN'?'UNKNOWN':intro?.followup_status==='CANCELLED'?'CANCELLED':'WAITING'),
   video?.provider_id||null)
 ];
 const attention=checklist.some(x=>['UNKNOWN','FAILED'].includes(x.status))||
  (intro?.greeting_id===greetId&&intro.followup_status==='CANCELLED'&&intro.reason==='FOLLOWUP_WINDOW_EXPIRED');
 return {greetingId:greetId,checklist,attention,stepConfirmed:checklist.filter(x=>x.confirmed).length,
  pendingDelivery:checklist.some(x=>x.status==='ACCEPTED'||x.status==='SENDING'),
  recordedAt:batch?.attempt_at||null};
}
export function dailyScheduledSummary(){
 return one(`SELECT MAX(b.id) AS batchId,MAX(b.created_at) AS createdAt,
   COUNT(*) AS scheduled,
   SUM(CASE WHEN i.status='QUEUED' THEN 1 ELSE 0 END) AS pending,
   SUM(CASE WHEN i.status='SENT' THEN 1 ELSE 0 END) AS accepted,
   SUM(CASE WHEN i.status='SENDING' THEN 1 ELSE 0 END) AS sending,
   SUM(CASE WHEN i.status='UNKNOWN' THEN 1 ELSE 0 END) AS uncertain,
   SUM(CASE WHEN i.status='SKIPPED' THEN 1 ELSE 0 END) AS skipped
   FROM prospecting_batches b JOIN prospecting_batch_items i ON i.batch_id=b.id
   WHERE b.origin='AUTONOMOUS' AND date(b.created_at,'-3 hours')=date('now','-3 hours')
   LIMIT 1`)||
  {batchId:null,createdAt:null,scheduled:0,pending:0,accepted:0,sending:0,uncertain:0,skipped:0};
}
