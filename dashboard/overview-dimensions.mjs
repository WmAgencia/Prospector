// Real, distinct prospecting results by city and business segment.
// These metrics are read-only; no new outreach or conversation automation.
import {all} from './db.mjs';
import {prospectorLeadEligible} from './whatsapp-roles.mjs';
import './sales-outcomes.mjs';

const safeLabel=(value,fallback)=>String(value||'').replace(/\s+/g,' ').trim()||fallback;
const groupingKey=(label)=>label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
export function aggregateOutreachDimensions(rows=[]){
 const groups={cities:new Map(),niches:new Map()};
 const totals={approached:0,interested:0,converted:0};
 for(const lead of rows){
  if(!lead.approached)continue;
  const interested=lead.sale_status==='INTERESTED'||lead.sale_status==='CLOSED_WON'||lead.stage==='INTERESTED'||lead.stage==='CLOSED_WON';
  const converted=lead.sale_status==='CLOSED_WON'||lead.stage==='CLOSED_WON';
  totals.approached++;
  if(interested||converted)totals.interested++;
  if(converted)totals.converted++;
  for(const [dimension,value,fallback] of [['cities',lead.city,'Cidade não informada'],['niches',lead.segment,'Nicho não informado']]){
   const label=safeLabel(value,fallback),key=groupingKey(label);
   let entry=groups[dimension].get(key);
   if(!entry){entry={key,label,approached:0,interested:0,converted:0};groups[dimension].set(key,entry);}
   entry.approached++;
   if(interested||converted)entry.interested++;
   if(converted)entry.converted++;
  }
 }
 const result={totals};
 for(const dimension of ['cities','niches']){
  result[dimension]=Array.from(groups[dimension].values()).map(item=>({
   ...item,conversionRate:item.approached?Number((item.converted/item.approached*100).toFixed(1)):0,
   interestRate:item.approached?Number((item.interested/item.approached*100).toFixed(1)):0
  })).sort((a,b)=>b.approached-a.approached||a.label.localeCompare(b.label,'pt-BR'));
 }
 totals.conversionRate=totals.approached?Number((totals.converted/totals.approached*100).toFixed(1)):0;
 return result;
}
export function outreachDimensionSnapshot(){
 // A contact counts only after a persisted sent initial contact, confirmed
 // batch send, or outbound thread message. Pending/unknown attempts do not count.
 const rows=all(`SELECT l.id,l.city,l.segment,l.stage,s.status AS sale_status,
 CASE WHEN EXISTS(SELECT 1 FROM initial_contacts i WHERE i.lead_id=l.id AND i.status IN ('SENT','DELIVERED','READ'))
 OR EXISTS(SELECT 1 FROM prospecting_batch_items b WHERE b.lead_id=l.id AND b.status='SENT')
 OR EXISTS(SELECT 1 FROM threads t JOIN messages m ON m.thread_id=t.id WHERE t.lead_id=l.id AND m.direction='out' AND m.status NOT IN ('FAILED','UNKNOWN','PENDING'))
 THEN 1 ELSE 0 END AS approached
 FROM leads l LEFT JOIN sales_outcomes s ON s.lead_id=l.id
 WHERE l.stage IN ('INTERESTED','CLOSED_WON')
 OR s.status IS NOT NULL
 OR EXISTS(SELECT 1 FROM initial_contacts i WHERE i.lead_id=l.id)
 OR EXISTS(SELECT 1 FROM prospecting_batch_items b WHERE b.lead_id=l.id AND b.status='SENT')
 OR EXISTS(SELECT 1 FROM threads t JOIN messages m ON m.thread_id=t.id WHERE t.lead_id=l.id AND m.direction='out')`);
 return {...aggregateOutreachDimensions(rows.filter(lead=>prospectorLeadEligible(lead.id))),source:'persisted',unit:'unique_leads'};
}
