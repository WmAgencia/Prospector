// Compact sales Kanban, derived only from persisted WhatsApp and CRM facts.
import {all,one} from './db.mjs';
import {threeMonthsAfter,latestOutreachAt} from './prospecting-recontact.mjs';

export const KANBAN_STAGES=['approaching','no_interest','interested','conversing'];

function cardStatus(row){
 if(row.stage==='CLOSED_WON')return null;
 if(row.stage==='NO_INTEREST')return 'no_interest';
 const manual=Boolean(row.manually_replied);
 if(manual||row.stage==='CONVERSING')return 'conversing';
 if(row.hot_notice)return 'interested';
 if(row.initial_at||row.last_out_at||row.last_batch_at)return 'approaching';
 return null;
}
export function kanbanSnapshot({limit=120,at=Date.now()}={}){
 // Query uses a single lead row per card. A lead cannot appear in two columns.
 const rows=all(`SELECT l.id,l.business,l.city,l.phone,l.stage,l.last_activity_at,
  t.jid,t.manual_takeover,
  (SELECT MAX(created_at) FROM initial_contacts i WHERE i.lead_id=l.id OR i.phone=l.phone) initial_at,
  (SELECT MAX(m.at) FROM messages m JOIN threads x ON x.id=m.thread_id WHERE x.lead_id=l.id AND m.direction='out') last_out_at,
  (SELECT MAX(attempt_at) FROM prospecting_batch_items q WHERE q.lead_id=l.id AND q.status IN ('SENT','SENDING','UNKNOWN')) last_batch_at,
  EXISTS(SELECT 1 FROM owner_notices n WHERE n.lead_id=l.id AND n.kind='GROQ_HOT_LEAD') hot_notice,
  EXISTS(SELECT 1 FROM messages m JOIN threads x ON x.id=m.thread_id WHERE x.lead_id=l.id
   AND m.direction='out' AND (m.provider_id LIKE 'operator:%' OR m.provider_id LIKE 'remote-operator:%' OR m.provider_id LIKE 'waakg-out:%')) manually_replied,
  EXISTS(SELECT 1 FROM suppressions s WHERE s.phone=l.phone) opted_out
 FROM leads l LEFT JOIN threads t ON t.lead_id=l.id
 WHERE l.stage IN ('NO_INTEREST','INTERESTED','CLOSED_WON','CONVERSING')
    OR EXISTS(SELECT 1 FROM initial_contacts i WHERE i.lead_id=l.id)
    OR EXISTS(SELECT 1 FROM messages m JOIN threads x ON x.id=m.thread_id WHERE x.lead_id=l.id AND m.direction='out')
    OR EXISTS(SELECT 1 FROM owner_notices n WHERE n.lead_id=l.id AND n.kind='GROQ_HOT_LEAD')
    OR EXISTS(SELECT 1 FROM prospecting_batch_items q WHERE q.lead_id=l.id AND q.status IN ('SENT','UNKNOWN'))
 ORDER BY COALESCE(l.last_activity_at,l.created_at) DESC LIMIT 3000`);
 const columns=Object.fromEntries(KANBAN_STAGES.map(k=>[k,[]]));
 const counts=Object.fromEntries(KANBAN_STAGES.map(k=>[k,0]));
 for(const row of rows){
  const type=cardStatus(row);if(!type)continue;
  counts[type]++;
  if(columns[type].length>=Math.max(1,Math.min(250,Number(limit)||120)))continue;
  const last=latestOutreachAt(row.id,row.phone);
  let nextContactAt=last?threeMonthsAfter(last):null;
  if(type==='no_interest'){
   const stageAt=one("SELECT MAX(at) at FROM audit WHERE lead_id=? AND action='STAGE' AND json_extract(detail,'$.to')='NO_INTEREST'",row.id)?.at;
   if(stageAt&&(!nextContactAt||Date.parse(stageAt)>last))nextContactAt=threeMonthsAfter(stageAt);
  }
  const noResponse=type==='approaching'&&!one("SELECT 1 FROM threads t JOIN messages m ON m.thread_id=t.id WHERE t.lead_id=? AND m.direction='in' LIMIT 1",row.id);
  columns[type].push({
   id:row.id,business:row.business,city:row.city||'',phone:row.phone||'',jid:row.jid||'',
   stage:type,lastActivityAt:row.last_activity_at||row.last_out_at||row.initial_at||null,
   noResponse,blocked:!!row.opted_out,nextEligibleAt:['approaching','no_interest'].includes(type)&&!row.opted_out?nextContactAt:null,
   eligibleAgain:!!nextContactAt&&Date.parse(nextContactAt)<=at&&!row.opted_out&&['approaching','no_interest'].includes(type)
  });
 }
 return {columns,counts,total:Object.values(counts).reduce((x,y)=>x+y,0),
  monthsBetweenContacts:3,onlyPersistedActivity:true,manualMessagesMoveToConversing:true,
  hotLeadsRequireNotification:true};
}
