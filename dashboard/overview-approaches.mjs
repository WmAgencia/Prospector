// Read-only historic first-approach reporting for the overview.
// Dates are always interpreted as calendar days in America/Sao_Paulo.
// Count only persisted accepted initial sends, never replies, media, queued
// attempts or deliveries with an uncertain outcome.
import {all} from './db.mjs';
import {daySP} from './radar.mjs';

const VALID_PERIODS=new Set(['today','7d','month','day']);
const YYYY_MM_DD=/^\d{4}-\d{2}-\d{2}$/;
const validDay=value=>{
 if(typeof value!=='string'||!YYYY_MM_DD.test(value))return false;
 const parsed=new Date(value+'T12:00:00Z');
 return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
};
export function approachPeriodRange({period='today',date='',at=new Date()}={}){
 if(!VALID_PERIODS.has(period))throw Error('Período inválido');
 const today=daySP(at);
 let from=today;
 if(period==='day'){
  if(!validDay(date)||date>today)throw Error('Selecione uma data válida até hoje');
  from=date;
 }else if(period==='7d'){
  const base=new Date(today+'T12:00:00Z');
  base.setUTCDate(base.getUTCDate()-6);
  from=base.toISOString().slice(0,10);
 }else if(period==='month')from=today.slice(0,7)+'-01';
 const until=period==='day'?date:today;
 const days=[];
 for(let cursor=new Date(from+'T12:00:00Z');cursor.toISOString().slice(0,10)<=until;cursor.setUTCDate(cursor.getUTCDate()+1)){
  days.push(cursor.toISOString().slice(0,10));
 }
 return {period,from,to:until,days,timezone:'America/Sao_Paulo'};
}
export function summarizeFirstApproaches(rows,{period='today',date='',at=new Date()}={}){
 const range=approachPeriodRange({period,date,at});
 const firstByLead=new Map();
 for(const event of rows){
  if(!event?.lead_id||!event?.at)continue;
  const stamp=new Date(event.at);
  if(!Number.isFinite(stamp.getTime())||stamp.getTime()>at.getTime())continue;
  const former=firstByLead.get(event.lead_id);
  if(!former||stamp<former)firstByLead.set(event.lead_id,stamp);
 }
 const totals=new Map(range.days.map(day=>[day,0]));
 for(const stamp of firstByLead.values()){
  const key=daySP(stamp);
  if(totals.has(key))totals.set(key,totals.get(key)+1);
 }
 const daily=range.days.map(day=>({date:day,approached:totals.get(day)}));
 return {...range,total:daily.reduce((sum,day)=>sum+day.approached,0),daily,
  unit:'unique_first_approached_leads',source:'confirmed_persisted_initial_sends'};
}
export function firstApproachHistory({period='today',date='',at=new Date()}={}){
 // Four sources cover the legacy workflow, the consent-gated batch sender,
 // the initial-contacts ledger and persisted outbound greetings. The same
 // lead may appear in all four: earliest accepted attempt wins.
 const rows=all(`
 SELECT lead_id,at FROM (
   SELECT lead_id,updated_at AS at
   FROM jobs WHERE execution_id IS NOT NULL AND step_index=0 AND status='SENT'
   UNION ALL
   SELECT lead_id,attempt_at AS at
   FROM prospecting_batch_items WHERE status='SENT' AND attempt_at IS NOT NULL
   UNION ALL
   SELECT i.lead_id,
    CASE WHEN j.status='SENT' THEN COALESCE(j.updated_at,i.created_at) ELSE i.created_at END AS at
   FROM initial_contacts i LEFT JOIN jobs j ON j.id=i.job_id
   WHERE i.status IN ('SENT','DELIVERED','READ')
   UNION ALL
   SELECT t.lead_id,m.at
   FROM messages m JOIN threads t ON t.id=m.thread_id
   WHERE m.direction='out' AND m.provider_id LIKE 'prospect-queue:%'
     AND lower(m.status) IN ('sent','delivered','read')
 ) WHERE lead_id IS NOT NULL AND at IS NOT NULL`);
 return summarizeFirstApproaches(rows,{period,date,at});
}
