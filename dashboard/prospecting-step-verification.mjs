// Consolidated proof of every step of the Consecom prospecting sequence.
// Reads durable receipts only; actual WhatsApp evidence is reconciled by the
// text/media verifiers before this monitor runs. NEVER sends to a prospect.
import {all,getSetting} from './db.mjs';
import {queueNotice} from './notifications.mjs';
import {acceptsProposalAudio} from './prospector-sales-signals.mjs';
import {wantsPortfolioPitchAudio} from './portfolio-pitch-audio.mjs';

const stepNames={GREETING:'Primeira abordagem',INTRO:'Pedido de autorização',AUDIO:'Áudio da proposta',VIDEO:'Vídeo do portfólio',PERMISSION:'Autorização do cliente'};
const confirmed=new Set(['DELIVERED','READ']);
const sent=new Set(['SENT','DELIVERED','READ']);
const resultStep=()=>({total:0,confirmedOnDevice:0,sentOnWhatsApp:0,acceptedOnly:0,unverified:0,needsReview:0,byStatus:{}});
const stamp=value=>{const n=Date.parse(value||'');return Number.isFinite(n)?n:0;};
const ageMinutes=(at,time)=>Math.max(0,Math.round((time-stamp(at))/60000));
const safeCount=x=>Math.min(150,Math.max(1,Number(x)||50));

export function prospectingStepVerification({at=new Date(),days=7,limit=50}={}){
 const nowAt=at instanceof Date?at:new Date(at);
 const ms=nowAt.getTime(),cutoff=new Date(ms-Math.max(1,Math.min(30,Number(days)||7))*86400000).toISOString();
 const counts={GREETING:resultStep(),INTRO:resultStep(),AUDIO:resultStep(),VIDEO:resultStep()};
 const issues=[], seen=new Set();
 const add=({lead_id,phone,business,session_id,step,code,status,at:when,greeting_id,manual_takeover=0,lead_stage='',urgency=2})=>{
  const dedupe=String(lead_id)+':'+step+':'+code;
  if(seen.has(dedupe))return;
  seen.add(dedupe);
  issues.push({leadId:lead_id,phone:phone||null,business:business||'Empresa',
   sessionId:session_id||null,step,stepLabel:stepNames[step],code,
   status:status||null,at:when||null,ageMinutes:ageMinutes(when,ms),
   greetingId:greeting_id||null,active:manual_takeover!==1&&
    !['NO_INTEREST','INTERESTED','CLOSED_WON'].includes(lead_stage),urgency});
 };
 const receiptSql=source=>`SELECT r.*,l.business,l.phone,l.stage AS lead_stage,
  COALESCE(t.manual_takeover,0) AS manual_takeover
  FROM ${source} r JOIN leads l ON l.id=r.lead_id
  LEFT JOIN threads t ON t.lead_id=r.lead_id
  WHERE r.attempted_at>=?`;
 for(const source of ['prospecting_text_receipts','pitch_delivery_receipts']){
  for(const record of all(receiptSql(source),cutoff)){
   const kind=String(record.kind||'');
   if(!counts[kind])continue;
   const state=String(record.status||'UNKNOWN').toUpperCase();
   const bucket=counts[kind];
   bucket.total++;
   bucket.byStatus[state]=(bucket.byStatus[state]||0)+1;
   if(confirmed.has(state))bucket.confirmedOnDevice++;
   else if(state==='SENT')bucket.sentOnWhatsApp++;
   else if(state==='ACCEPTED')bucket.acceptedOnly++;
   else bucket.unverified++;
   const age=ageMinutes(record.attempted_at,ms);
   let code=null;
   if(['UNKNOWN','FAILED'].includes(state)&&age>=3)code='DELIVERY_UNCERTAIN';
   else if(state==='SENDING'&&age>=2)code='SEND_IN_PROGRESS_TOO_LONG';
   else if(state==='ACCEPTED'&&age>=4)code='GATEWAY_ONLY';
   else if(state==='SENT'&&age>=15)code='NOT_CONFIRMED_ON_DEVICE';
   if(code){
    bucket.needsReview++;
    add({...record,step:kind,code,status:state,at:record.attempted_at,
     urgency:code==='DELIVERY_UNCERTAIN'?0:1});
   }
  }
 }
 // A first greeting can be marked SENT/UNKNOWN by a legacy worker without
 // the separate receipt. Expose that gap instead of treating CRM state as proof.
 for(const row of all(`SELECT b.id AS greeting_id,b.lead_id,b.attempt_at,
   b.status,l.phone,l.business,l.stage AS lead_stage,
   COALESCE(t.manual_takeover,0) AS manual_takeover
   FROM prospecting_batch_items b JOIN leads l ON l.id=b.lead_id
   LEFT JOIN threads t ON t.lead_id=b.lead_id
   LEFT JOIN prospecting_text_receipts r ON r.lead_id=b.lead_id
    AND r.greeting_id=b.id AND r.kind='GREETING'
   WHERE b.attempt_at>=? AND b.status IN ('SENT','SENDING','UNKNOWN')
    AND r.lead_id IS NULL`,cutoff)){
  if(stamp(row.attempt_at)>0&&stamp(row.attempt_at)<ms-4*60000)
   add({...row,step:'GREETING',code:'MISSING_SEND_RECEIPT',
    status:'NOT_VERIFIED',at:row.attempt_at,urgency:1});
 }
 const permission={awaitingReply:0,received:0,stalled:0};
 const introductions=all(`SELECT p.*,l.business,l.phone,l.stage AS lead_stage,
  COALESCE(t.manual_takeover,0) AS manual_takeover
  FROM prospecting_introductions p JOIN leads l ON l.id=p.lead_id
  LEFT JOIN threads t ON t.lead_id=p.lead_id
  WHERE p.created_at>=? ORDER BY p.updated_at DESC LIMIT 3000`,cutoff);
 const pendingCutoff=ms-4*60000;
 for(const p of introductions){
  const active=p.manual_takeover!==1&&!['NO_INTEREST','INTERESTED','CLOSED_WON'].includes(p.lead_stage);
  // Only overdue work gets an alert. A new lead waiting for a customer reply
  // is NOT an error and must never cause an unsolicited audio.
  if(p.stage==='WAITING'&&stamp(p.due_at)>0&&stamp(p.due_at)<pendingCutoff&&active)
   add({...p,step:'INTRO',code:'AUTHORIZED_STEP_NOT_ATTEMPTED',status:'WAITING',at:p.due_at,urgency:0});
  if(p.stage==='VOICE_WAITING'&&stamp(p.due_at)>0&&stamp(p.due_at)<pendingCutoff&&active)
   add({...p,step:'AUDIO',code:'AUTHORIZED_STEP_NOT_ATTEMPTED',status:'VOICE_WAITING',at:p.due_at,urgency:0});
  if(p.stage==='VOICE_SENT'&&p.followup_status==='WAITING'&&
    stamp(p.followup_due_at)>0&&stamp(p.followup_due_at)<pendingCutoff&&active)
   add({...p,step:'VIDEO',code:'AUTHORIZED_STEP_NOT_ATTEMPTED',
    status:'WAITING',at:p.followup_due_at,urgency:0});
  // A step marked sent without its own receipt is not verified, even if it
  // appears SENT in the Kanban. Check older deployments for legacy gaps.
  const hasIntro=all("SELECT 1 FROM prospecting_text_receipts WHERE lead_id=? AND greeting_id=? AND kind='INTRO'",p.lead_id,p.greeting_id).length>0;
  if(['SENT','VOICE_SENT','CONVERSING'].includes(p.stage)&&p.reason!=='MANUAL_TAKEOVER'&&
   p.sent_at&&stamp(p.sent_at)<pendingCutoff&&!hasIntro)
   add({...p,step:'INTRO',code:'MISSING_SEND_RECEIPT',status:'NOT_VERIFIED',at:p.sent_at,urgency:1});
  const hasAudio=all("SELECT 1 FROM pitch_delivery_receipts WHERE lead_id=? AND greeting_id=? AND kind='AUDIO'",p.lead_id,p.greeting_id).length>0;
  if((p.stage==='VOICE_SENT'||p.reason==='PITCH_AUDIO_550')&&
   p.sent_at&&stamp(p.sent_at)<pendingCutoff&&!hasAudio)
   add({...p,step:'AUDIO',code:'MISSING_SEND_RECEIPT',status:'NOT_VERIFIED',at:p.sent_at,urgency:1});
  const hasVideo=all("SELECT 1 FROM pitch_delivery_receipts WHERE lead_id=? AND greeting_id=? AND kind='VIDEO'",p.lead_id,p.greeting_id).length>0;
  if(p.followup_status==='SENT'&&p.followup_sent_at&&stamp(p.followup_sent_at)<pendingCutoff&&!hasVideo)
   add({...p,step:'VIDEO',code:'MISSING_SEND_RECEIPT',status:'NOT_VERIFIED',at:p.followup_sent_at,urgency:1});
  // Inbound authorization is a separate proof, not an outbound message.
  if(p.stage==='SENT'&&p.sent_at&&active){
   const replies=all("SELECT body,state,received_at FROM waakg_inbox WHERE lead_id=? AND session_id=? AND received_at>=? ORDER BY received_at DESC LIMIT 15",
    p.lead_id,p.session_id,p.sent_at);
   const yes=replies.find(r=>r.state==='REVIEW'&&(acceptsProposalAudio(r.body)||wantsPortfolioPitchAudio(r.body)));
   if(yes){
    permission.received++;
    if(stamp(yes.received_at)<pendingCutoff){
     permission.stalled++;
     add({...p,step:'PERMISSION',code:'CONSENT_RECEIVED_NOT_PROCESSED',
      status:'RECEIVED',at:yes.received_at,urgency:0});
    }
   }else permission.awaitingReply++;
  }
 }
 issues.sort((a,b)=>a.urgency-b.urgency||b.ageMinutes-a.ageMinutes);
 return {
  checkedAt:nowAt.toISOString(),days:Math.max(1,Math.min(30,Number(days)||7)),
  steps:counts,permission,
  reviewTotal:issues.length,reviewActive:issues.filter(x=>x.active).length,
  issues:issues.slice(0,safeCount(limit))
 };
}
const noticeKey=x=>{
 if(x.code==='CONSENT_RECEIVED_NOT_PROCESSED')return 'pitch-consent-stuck:'+x.greetingId;
 if(x.code==='AUTHORIZED_STEP_NOT_ATTEMPTED')return 'prospector-stuck:'+x.greetingId+':'+
  (x.step==='INTRO'?'WAITING':x.step==='AUDIO'?'VOICE_WAITING':'VOICE_SENT');
 if(x.step==='GREETING'||x.step==='INTRO')return 'text-receipt:'+x.greetingId+':'+x.step;
 return 'pitch-receipt:'+x.greetingId+':'+x.step;
};
export function alertUnverifiedProspectingSteps({at=new Date(),notify=queueNotice,limit=12}={}){
 const status=prospectingStepVerification({at,days:7,limit:150});
 let alerted=0;
 if(getSetting('paused',false)!==true){
  for(const item of status.issues){
   if(!item.active||alerted>=Math.max(1,Math.min(30,Number(limit)||12)))continue;
   const text='*Prospector — etapa sem confirmação*\\nEtapa: '+item.stepLabel+
    '\\nEmpresa: '+String(item.business).slice(0,85)+
    '\\nDestino: '+item.phone+
    '\\nSituação: '+item.code+' ('+item.status+')'+
    '\\nTempo: '+item.ageMinutes+' min'+
    '\\nConversa: https://wa.me/'+item.phone+
    '\\nConferir o ID e o histórico do WhatsApp antes de qualquer reenvio.';
   if(notify(noticeKey(item),'PITCH_DELIVERY_ISSUE',text,item.leadId))alerted++;
  }
 }
 return {checkedAt:status.checkedAt,reviewTotal:status.reviewTotal,
  reviewActive:status.reviewActive,alerts:alerted,
  steps:Object.fromEntries(Object.entries(status.steps).map(([k,v])=>[k,{
   total:v.total,confirmedOnDevice:v.confirmedOnDevice,sentOnWhatsApp:v.sentOnWhatsApp,
   needsReview:v.needsReview}])),
  permission:status.permission};
}
