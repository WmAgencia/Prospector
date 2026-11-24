// Compact sales Kanban, derived only from persisted WhatsApp and CRM facts.
import {all,one} from './db.mjs';
import {threeMonthsAfter,latestOutreachAt} from './prospecting-recontact.mjs';
import {prospectorLeadEligible} from './whatsapp-roles.mjs';
import {PROSPECTING_EVENT_SQL,prospectingEventParams,prospectingPeriodSnapshot} from './kanban-period.mjs';
import {workflowChecklist,dailyScheduledSummary} from './prospecting-workflow-view.mjs';

export const KANBAN_STAGES=['queued','approaching','no_interest','interested','conversing'];

function cardStatus(row){
 if(row.stage==='CLOSED_WON')return null;
 const manual=Boolean(row.manually_replied);
 if(manual||row.stage==='CONVERSING')return 'conversing';
 if(row.hot_notice||row.stage==='INTERESTED')return 'interested';
 if(row.opted_out||row.stage==='NO_INTEREST'&&!row.queue_id)return 'no_interest';
 // An unattempted or uncertain greeting stays visible in the queue, never
 // moves to Abordando solely because an initial_contacts reservation exists.
 if(row.queue_id)return 'queued';
 if(row.stage==='NO_INTEREST')return 'no_interest';
 if(row.initial_at||row.last_out_at||row.last_batch_at)return 'approaching';
 return null;
}
export function kanbanSnapshot({limit=120,at=Date.now(),period=null}={}){
 const scoped=Boolean(period?.startISO&&period?.endISO);
 const prospecting=prospectingPeriodSnapshot(period);
 // Query uses a single lead row per card. A lead cannot appear in two columns.
 const rows=all(`SELECT l.id,l.business,l.city,l.phone,l.stage,l.last_activity_at,
  t.jid,t.manual_takeover,qb.id queue_id,qb.status queue_status,qb.created_at queue_at,
  (SELECT id FROM prospecting_batch_items q WHERE q.lead_id=l.id AND q.status='SENT'
   ORDER BY q.attempt_at DESC,q.created_at DESC LIMIT 1) last_greeting_id,
  (SELECT MAX(created_at) FROM initial_contacts i WHERE i.lead_id=l.id OR i.phone=l.phone) initial_at,
  (SELECT MAX(m.at) FROM messages m JOIN threads x ON x.id=m.thread_id WHERE x.lead_id=l.id AND m.direction='out') last_out_at,
  (SELECT MAX(attempt_at) FROM prospecting_batch_items q WHERE q.lead_id=l.id AND q.status IN ('SENT','SENDING','UNKNOWN')) last_batch_at,
  EXISTS(SELECT 1 FROM owner_notices n WHERE n.lead_id=l.id AND n.kind='GROQ_HOT_LEAD') hot_notice,
  EXISTS(SELECT 1 FROM messages m JOIN threads x ON x.id=m.thread_id WHERE x.lead_id=l.id
   AND m.direction='out' AND (m.provider_id LIKE 'operator:%' OR m.provider_id LIKE 'remote-operator:%' OR m.provider_id LIKE 'waakg-out:%')) manually_replied,
  EXISTS(SELECT 1 FROM suppressions s WHERE s.phone=l.phone) opted_out
 FROM leads l LEFT JOIN threads t ON t.lead_id=l.id
 LEFT JOIN prospecting_batch_items qb ON qb.id=(
   SELECT q.id FROM prospecting_batch_items q JOIN prospecting_batches b ON b.id=q.batch_id
   WHERE q.lead_id=l.id AND q.status IN ('QUEUED','SENDING','UNKNOWN')
    AND (b.status='ACTIVE' OR
     (q.status='UNKNOWN' AND strftime('%s',q.attempt_at)>=strftime('%s','now','-7 days')))
   ORDER BY q.created_at DESC LIMIT 1)
 WHERE (l.stage IN ('NO_INTEREST','INTERESTED','CLOSED_WON','CONVERSING')
    OR EXISTS(SELECT 1 FROM initial_contacts i WHERE i.lead_id=l.id)
    OR EXISTS(SELECT 1 FROM messages m JOIN threads x ON x.id=m.thread_id WHERE x.lead_id=l.id AND m.direction='out')
    OR EXISTS(SELECT 1 FROM owner_notices n WHERE n.lead_id=l.id AND n.kind='GROQ_HOT_LEAD')
    OR EXISTS(SELECT 1 FROM prospecting_batch_items q WHERE q.lead_id=l.id AND q.status IN ('SENT','UNKNOWN'))
    OR qb.id IS NOT NULL)
 ${scoped?'AND (l.id IN ('+PROSPECTING_EVENT_SQL+') OR (qb.id IS NOT NULL AND qb.created_at>=? AND qb.created_at<?))':''}
 ORDER BY COALESCE(qb.created_at,l.last_activity_at,l.created_at) DESC LIMIT 3000`,
 ...(scoped?[...prospectingEventParams(period),period.startISO,period.endISO]:[]));
 const columns=Object.fromEntries(KANBAN_STAGES.map(k=>[k,[]]));
 const counts=Object.fromEntries(KANBAN_STAGES.map(k=>[k,0]));
 for(const row of rows){
  if(!row.queue_id&&!prospectorLeadEligible(row.id))continue;
  const type=cardStatus(row);if(!type)continue;
  counts[type]++;
  if(columns[type].length>=Math.max(1,Math.min(250,Number(limit)||120)))continue;
  const last=['approaching','no_interest'].includes(type)?latestOutreachAt(row.id,row.phone):null;
  let nextContactAt=last?threeMonthsAfter(last):null;
  if(type==='no_interest'){
   const stageAt=one("SELECT MAX(at) at FROM audit WHERE lead_id=? AND action='STAGE' AND json_extract(detail,'$.to')='NO_INTEREST'",row.id)?.at;
   if(stageAt&&(!nextContactAt||Date.parse(stageAt)>last))nextContactAt=threeMonthsAfter(stageAt);
  }
  const noResponse=type==='approaching'&&!one("SELECT 1 FROM threads t JOIN messages m ON m.thread_id=t.id WHERE t.lead_id=? AND m.direction='in' LIMIT 1",row.id);
  const workflow=workflowChecklist({leadId:row.id,greetingId:row.queue_id||row.last_greeting_id,queueStatus:row.queue_status});
  columns[type].push({
   id:row.id,business:row.business,city:row.city||'',phone:row.phone||'',jid:row.jid||'',
   stage:type,lastActivityAt:row.queue_at||row.last_activity_at||row.last_out_at||row.initial_at||null,
   queueStatus:row.queue_status||null,queuedAt:row.queue_at||null,workflow,
   noResponse,blocked:!!row.opted_out,nextEligibleAt:['approaching','no_interest'].includes(type)&&!row.opted_out?nextContactAt:null,
   eligibleAgain:!!nextContactAt&&Date.parse(nextContactAt)<=at&&!row.opted_out&&['approaching','no_interest'].includes(type)
  });
 }
 columns.queued.sort((a,b)=>Date.parse(a.queuedAt||0)-Date.parse(b.queuedAt||0));
 return {columns,counts,total:Object.values(counts).reduce((x,y)=>x+y,0),
  scheduledToday:dailyScheduledSummary(),
  prospections:prospecting.total,period:period?{key:period.key,from:period.from,to:period.to,label:period.label}:null,
  monthsBetweenContacts:3,onlyPersistedActivity:true,manualMessagesMoveToConversing:true,
  hotLeadsRequireNotification:true};
}
