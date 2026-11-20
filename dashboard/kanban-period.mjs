// Period-specific prospecting metrics. A prospecting action is one confirmed
// first outreach (or an approved recontact) sent by the system, not discovery,
// a queued job, an incoming message, or an uncertain network attempt.
import {all} from './db.mjs';
import {prospectorLeadEligible} from './whatsapp-roles.mjs';

const TZ='America/Sao_Paulo';
const validDate=/^\d{4}-\d{2}-\d{2}$/;
const fields=new Intl.DateTimeFormat('en-CA',{
 timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
});
function localParts(date){
 return Object.fromEntries(fields.formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
}
export function brazilDay(value=new Date()){
 const x=localParts(new Date(value));
 return [x.year,String(x.month).padStart(2,'0'),String(x.day).padStart(2,'0')].join('-');
}
function validCalendarDay(value){
 if(!validDate.test(String(value||'')))return false;
 const ts=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(ts)&&new Date(ts).toISOString().slice(0,10)===value;
}
function offsetDay(value,days){
 const ts=Date.parse(value+'T00:00:00Z')+days*86400000;
 return new Date(ts).toISOString().slice(0,10);
}
// Resolve midnight in the actual IANA timezone, including historical DST
// changes (do not assume every Brazilian calendar day lasts 24 hours).
export function brazilMidnight(value){
 if(!validCalendarDay(value))throw Error('DATA_INVALIDA');
 const target=Date.parse(value+'T00:00:00Z');
 let guess=target+3*3600000;
 for(let i=0;i<4;i++){
  const p=localParts(new Date(guess));
  const localAsUTC=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
  const corrected=guess+(target-localAsUTC);
  if(corrected===guess)break;
  guess=corrected;
 }
 return new Date(guess).toISOString();
}
export function kanbanPeriodFromQuery(query,clock=new Date()){
 const get=name=>typeof query?.get==='function'?query.get(name):query?.[name];
 const key=String(get('period')||'all');
 if(!['all','today','7d','30d','custom'].includes(key))throw Error('PERIODO_INVALIDO');
 const current=brazilDay(clock);
 if(key==='all')return {key,from:null,to:null,startISO:null,endISO:null,label:'Todo o período'};
 let from=key==='today'?current:key==='7d'?offsetDay(current,-6):key==='30d'?offsetDay(current,-29):String(get('from')||'');
 let to=key==='custom'?String(get('to')||''):current;
 if(!validCalendarDay(from)||!validCalendarDay(to))throw Error('DATAS_INVALIDAS');
 const days=(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000;
 if(days<0)throw Error('DATA_INICIAL_APOS_FINAL');
 if(days>3660)throw Error('PERIODO_SUPERIOR_A_DEZ_ANOS');
 return {key,from,to,startISO:brazilMidnight(from),endISO:brazilMidnight(offsetDay(to,1)),
  label:key==='today'?'Hoje':key==='7d'?'Últimos 7 dias':key==='30d'?'Últimos 30 dias':from+' a '+to};
}
// Distinct send identifiers rather than persisted initial-contact reservations.
// Legacy initial_contacts is only a fallback when it has no matching job row.
export const PROSPECTING_EVENT_SQL=`
 SELECT lead_id FROM prospecting_batch_items WHERE status='SENT' AND attempt_at IS NOT NULL
  AND (? IS NULL OR attempt_at>=?) AND (? IS NULL OR attempt_at<?)
 UNION
 SELECT lead_id FROM jobs WHERE status='SENT' AND step_index=0 AND execution_id IS NOT NULL
  AND (? IS NULL OR updated_at>=?) AND (? IS NULL OR updated_at<?)
 UNION
 SELECT i.lead_id FROM initial_contacts i WHERE i.status='SENT'
  AND (? IS NULL OR i.created_at>=?) AND (? IS NULL OR i.created_at<?)
  AND NOT EXISTS(SELECT 1 FROM prospecting_batch_items q WHERE q.id=i.job_id)
  AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.id=i.job_id)
`;
export function prospectingEventParams(period){
 const start=period?.startISO||null,end=period?.endISO||null;
 return [start,start,end,end,start,start,end,end,start,start,end,end];
}
export function prospectingPeriodSnapshot(period){
 const rows=all(PROSPECTING_EVENT_SQL,...prospectingEventParams(period));
 // Do not expose owner/internal contacts in the UI, consistent with Kanban.
 const ids=rows.map(x=>x.lead_id).filter(id=>prospectorLeadEligible(id));
 return {total:ids.length,leadIds:ids};
}
