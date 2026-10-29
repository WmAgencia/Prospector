// Three calendar months (not an approximation of 90 days) between
// contact attempts or renewed appearances in prospecting.
import {one} from './db.mjs';
export function threeMonthsAfter(value){
 const src=new Date(value);if(!Number.isFinite(src.getTime()))return null;
 const year=src.getUTCFullYear(),month=src.getUTCMonth(),day=src.getUTCDate();
 const out=new Date(Date.UTC(year,month+3,1,src.getUTCHours(),src.getUTCMinutes(),src.getUTCSeconds(),src.getUTCMilliseconds()));
 const last=new Date(Date.UTC(out.getUTCFullYear(),out.getUTCMonth()+1,0)).getUTCDate();
 out.setUTCDate(Math.min(day,last));
 return out.toISOString();
}
export function latestOutreachAt(leadId,phone){
 const dates=[];
 const a=one('SELECT created_at at FROM initial_contacts WHERE lead_id=? OR phone=? ORDER BY created_at DESC LIMIT 1',leadId,phone);
 if(a?.at)dates.push(a.at);
 const b=one("SELECT MAX(m.at) at FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.lead_id=? AND m.direction='out'",leadId);
 if(b?.at)dates.push(b.at);
 const c=one("SELECT name FROM sqlite_master WHERE type='table' AND name='prospecting_batch_items'")?one("SELECT MAX(attempt_at) at FROM prospecting_batch_items WHERE (lead_id=? OR phone=?) AND status IN ('SENDING','SENT','UNKNOWN')",leadId,phone):null;
 if(c?.at)dates.push(c.at);
 const d=one("SELECT last_contact_at at FROM contact_cadence WHERE phone=?",phone);
 if(d?.at)dates.push(d.at);
 return dates.map(x=>new Date(x).getTime()).filter(Number.isFinite).reduce((max,x)=>Math.max(max,x),0)||null;
}
export function recontactDecision(lead,at=Date.now()){
 if(!lead?.id)return {eligible:false,reason:'MISSING'};
 if(lead.phone&&one('SELECT phone FROM suppressions WHERE phone=?',lead.phone))return {eligible:false,reason:'OPT_OUT'};
 if(['INTERESTED','CONVERSING','CLOSED_WON'].includes(lead.stage))return {eligible:false,reason:'ACTIVE_RELATIONSHIP'};
 const thread=one('SELECT manual_takeover FROM threads WHERE lead_id=?',lead.id);
 if(thread?.manual_takeover===1)return {eligible:false,reason:'HUMAN_TAKEOVER'};
 if(one("SELECT 1 FROM owner_notices WHERE lead_id=? AND kind='GROQ_HOT_LEAD' LIMIT 1",lead.id))return {eligible:false,reason:'CONFIRMED_INTEREST'};
 if(one("SELECT name FROM sqlite_master WHERE type='table' AND name='prospecting_batch_items'")&&one("SELECT 1 FROM prospecting_batch_items WHERE lead_id=? AND status IN ('QUEUED','SENDING','UNKNOWN') LIMIT 1",lead.id))return {eligible:false,reason:'PENDING_OR_UNKNOWN'};
 const last=latestOutreachAt(lead.id,lead.phone);
 if(!last)return {eligible:lead.stage==='DISCOVERED',fresh:true,reason:lead.stage==='DISCOVERED'?'NEW':'NO_CONTACT'};
 if(lead.stage==='NO_INTEREST'){
  const recent=one("SELECT MAX(at) at FROM audit WHERE lead_id=? AND action='STAGE' AND json_extract(detail,'$.to')='NO_INTEREST'",lead.id);
  if(recent?.at){const value=Date.parse(recent.at);if(Number.isFinite(value))return withDue(Math.max(last,value),at);}
 }
 return withDue(last,at);
}
function withDue(last,at){
 const eligibleAt=threeMonthsAfter(last);
 return {eligible:!!eligibleAt&&Date.parse(eligibleAt)<=at,fresh:false,eligibleAt,reason:Date.parse(eligibleAt)<=at?'RECONTACT_DUE':'THREE_MONTH_COOLDOWN'};
}
