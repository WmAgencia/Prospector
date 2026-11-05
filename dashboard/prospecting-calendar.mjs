import {all,one} from './db.mjs';

const ZONE='America/Sao_Paulo';
export function localDate(date){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
export function validMonth(value){
 const m=/^(20\d\d)-(0[1-9]|1[0-2])$/.exec(String(value||''));
 if(!m||Number(m[1])>2099)throw Error('Mês inválido: use AAAA-MM');
 return m[0];
}
const tableExists=name=>!!one("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",name);
// Do not invent an event time: use accepted batch timestamp, sent job timestamp,
// or the original first-contact timestamp as a fallback, marked in the API.
export function monthlyProspectingCalendar(month){
 const value=validMonth(month);
 const begin=new Date(value+'-01T00:00:00-03:00');
 const next=new Date(Date.UTC(Number(value.slice(0,4)),Number(value.slice(5)),1,3,0,0));
 const from=new Date(begin.getTime()-24*3600000).toISOString(),to=new Date(next.getTime()+24*3600000).toISOString();
 const hasBatch=tableExists('prospecting_batch_items');
 const approachSql=hasBatch
 ? "SELECT i.lead_id,l.business,l.city,l.segment,l.phone,COALESCE(CASE WHEN b.status='SENT' THEN b.updated_at END,CASE WHEN j.status='SENT' THEN j.updated_at END,i.created_at) AS at, CASE WHEN b.status='SENT' OR j.status='SENT' THEN 1 ELSE 0 END AS confirmed_time FROM initial_contacts i JOIN leads l ON l.id=i.lead_id LEFT JOIN prospecting_batch_items b ON b.id=i.job_id LEFT JOIN jobs j ON j.id=i.job_id WHERE i.status='SENT'"
 : "SELECT i.lead_id,l.business,l.city,l.segment,l.phone,COALESCE(CASE WHEN j.status='SENT' THEN j.updated_at END,i.created_at) AS at, CASE WHEN j.status='SENT' THEN 1 ELSE 0 END AS confirmed_time FROM initial_contacts i JOIN leads l ON l.id=i.lead_id LEFT JOIN jobs j ON j.id=i.job_id WHERE i.status='SENT'";
 const approaches=all(approachSql);
 const closed=tableExists('sales_outcomes')?all(
  "SELECT s.lead_id,s.updated_at AS at,l.business,l.city,l.segment,l.phone FROM sales_outcomes s JOIN leads l ON l.id=s.lead_id WHERE s.status='CLOSED_WON' AND s.updated_at>=? AND s.updated_at<?",from,to
 ):[];
 const days=new Map();
 const slot=day=>{if(!days.has(day))days.set(day,{date:day,approached:[],closed:[],conversionRate:0});return days.get(day);};
 for(const row of approaches){
  if(!row.at)continue;
  const day=localDate(new Date(row.at));if(!day.startsWith(value))continue;
  slot(day).approached.push({id:row.lead_id,business:row.business,city:row.city,segment:row.segment,phone:row.phone,date:row.at,confirmedTime:row.confirmed_time===1});
 }
 for(const row of closed){
  const day=localDate(new Date(row.at));if(!day.startsWith(value))continue;
  slot(day).closed.push({id:row.lead_id,business:row.business,city:row.city,segment:row.segment,phone:row.phone,date:row.at});
 }
 const output=[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(day=>({
  ...day,approachedCount:day.approached.length,closedCount:day.closed.length,
  // Cohort conversion counts companies approached on this day that *now*
  // have a registered sale, regardless of when the sale was confirmed.
  conversionRate:day.approached.length?Math.round(1000*day.approached.filter(x=>one("SELECT 1 FROM sales_outcomes WHERE lead_id=? AND status='CLOSED_WON'",x.id)).length/day.approached.length)/10:0
 }));
 return {month:value,days:output,totals:{approached:output.reduce((n,d)=>n+d.approachedCount,0),closed:output.reduce((n,d)=>n+d.closedCount,0)},
  conversionDefinition:'Percentual das empresas abordadas naquele dia com venda confirmada registrada; os fechamentos do dia são contados separadamente.',
  timestamps:'Quando não há horário de confirmação do envio, a data de registro original é usada como aproximação.',
  timezone:ZONE};
}
