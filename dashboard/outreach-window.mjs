// São Paulo business-hour gate for every new WhatsApp prospecting approach.
// End is exclusive: Consecom stops at 17:40; other tenants keep 17:30.
import {getSetting} from './db.mjs';
import {isConsecomOwner} from './approach-cadence.mjs';
export const FIRST_APPROACH_START_MINUTES=8*60;
export const FIRST_APPROACH_END_MINUTES=isConsecomOwner()?17*60+40:17*60+30;
export const FIRST_APPROACH_WINDOW_LABEL=isConsecomOwner()?'08:00–17:40 America/Sao_Paulo':'08:00–17:30 America/Sao_Paulo';
export function saoPauloClock(at=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(at).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
 return Number(parts.hour)*60+Number(parts.minute);
}
export function insideApproachWindow(at=new Date()){
 const start=process.env.PROSPECTOR_APPROACH_START_DATE;
 if(start){
  // A deployment may be prepared today for tomorrow's first approach.
  // Invalid configuration fails closed; inbound replies remain independent.
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!Number.isFinite(Date.parse(start+'T00:00:00Z'))||new Date(start+'T00:00:00Z').toISOString().slice(0,10)!==start)return false;
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at).map(p=>[p.type,p.value]));
  if(parts.year+'-'+parts.month+'-'+parts.day<start)return false;
 }
 const minutes=saoPauloClock(at);
 const selected=getSetting('client_outreach_hours',null);
 const parse=value=>{const m=/^(\d\d):([0-5]\d)$/.exec(String(value||''));return m?Number(m[1])*60+Number(m[2]):NaN;};
 const selectedStart=parse(selected?.start),selectedEnd=parse(selected?.end);
 // Per-account hours may NARROW but never widen the existing WhatsApp gate.
 const startMinute=Number.isInteger(selectedStart)&&selectedStart>=FIRST_APPROACH_START_MINUTES&&selectedStart<FIRST_APPROACH_END_MINUTES?selectedStart:FIRST_APPROACH_START_MINUTES;
 const endMinute=Number.isInteger(selectedEnd)&&selectedEnd>startMinute&&selectedEnd<=FIRST_APPROACH_END_MINUTES?selectedEnd:FIRST_APPROACH_END_MINUTES;
 return minutes>=startMinute&&minutes<endMinute;
}
