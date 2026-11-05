// Tenant-local prospecting timeline. Data comes from persisted accepted sends and
// independently confirmed commercial sales, not simulated UI numbers.
import {all} from './db.mjs';

const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
export function localDay(at){const date=new Date(at);return Number.isNaN(+date)?null:fmt.format(date);}
export function validMonth(month){return typeof month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&Number(month.slice(0,4))>=2024&&Number(month.slice(0,4))<=2100;}
const range=month=>{
 const [year,m]=month.split('-').map(Number);
 const first=new Date(Date.UTC(year,m-1,1,0,0,0));
 const last=new Date(Date.UTC(year,m,1,0,0,0));
 return {start:new Date(first.getTime()-36*3600_000).toISOString(),end:new Date(last.getTime()+36*3600_000).toISOString()};
};
export function prospectingCalendar({month,day,kind}={}){
 if(!validMonth(month))throw Error('Mês inválido: use AAAA-MM');
 if(day!==undefined&&(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!day.startsWith(month+'-')||Number.isNaN(Date.parse(day+'T12:00:00Z'))))throw Error('Dia inválido');
 if(kind!==undefined&&!['approached','closed'].includes(kind))throw Error('Categoria inválida');
 const {start,end}=range(month),stats=new Map();
 const bump=(date,key,lead)=>{if(!date?.startsWith(month))return;let item=stats.get(date);if(!item){item={day:date,approached:0,closed:0};stats.set(date,item);}item[key]++;};
 const approached=all("SELECT i.lead_id,i.created_at,l.business,l.city,l.phone FROM initial_contacts i JOIN leads l ON l.id=i.lead_id WHERE i.status='SENT' AND i.created_at>=? AND i.created_at<? ORDER BY i.created_at DESC LIMIT 20000",start,end);
 const closed=all("SELECT o.lead_id,o.updated_at,l.business,l.city,l.phone FROM sales_outcomes o JOIN leads l ON l.id=o.lead_id WHERE o.status='CLOSED_WON' AND o.updated_at>=? AND o.updated_at<? ORDER BY o.updated_at DESC LIMIT 20000",start,end);
 for(const lead of approached)bump(localDay(lead.created_at),'approached',lead);
 for(const lead of closed)bump(localDay(lead.updated_at),'closed',lead);
 const days=[...stats.values()].sort((a,b)=>a.day.localeCompare(b.day)).map(x=>({...x,conversionRate:x.approached?Math.round(x.closed/x.approached*1000)/10:null}));
 const result={month,days,totals:{approached:days.reduce((a,x)=>a+x.approached,0),closed:days.reduce((a,x)=>a+x.closed,0)}};
 result.totals.conversionRate=result.totals.approached?Math.round(result.totals.closed/result.totals.approached*1000)/10:null;
 if(day!==undefined){
  const source=kind==='closed'?closed:approached;
  result.detail={day,kind,items:source.filter(l=>localDay(kind==='closed'?l.updated_at:l.created_at)===day).slice(0,500).map(l=>({id:l.lead_id,business:l.business,city:l.city,phone:l.phone,at:kind==='closed'?l.updated_at:l.created_at}))};
 }
 // Ratio is same-day closed events / approaches, not cohort attribution.
 result.definition='Eventos do dia; não mede se os fechamentos vieram das abordagens deste mesmo dia.';
 return result;
}
