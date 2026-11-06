// São Paulo timezone controls ALL first WhatsApp prospecting approaches.
// Monday-Friday: 08:00-17:30, Saturday: 08:00-17:00, Sunday: no approaches.
// End is exclusive. Replies to existing conversations are independent.
import {getSetting} from './db.mjs';
export const FIRST_APPROACH_START_MINUTES=8*60;
export const FIRST_APPROACH_END_MINUTES=17*60+30;
export const SATURDAY_APPROACH_END_MINUTES=17*60;
const ZONE='America/Sao_Paulo';
function localParts(at=new Date()){
 return Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:ZONE,hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'
 }).formatToParts(at).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
}
export function saoPauloClock(at=new Date()){
 const parts=localParts(at);
 return Number(parts.hour)*60+Number(parts.minute);
}
export function saoPauloOutreachDay(at=new Date()){
 const weekday=localParts(at).weekday;
 return weekday==='Sun'?'sunday':weekday==='Sat'?'saturday':'weekday';
}
export function isOutboundBusinessDay(at=new Date()){
 return saoPauloOutreachDay(at)!=='sunday';
}
export function prospectingWindowLabel(){
 return 'Seg–Sex 08:00–17:30; Sáb 08:00–17:00; Dom sem primeiras abordagens (America/Sao_Paulo)';
}
export function insideApproachWindow(at=new Date()){
 const start=process.env.PROSPECTOR_APPROACH_START_DATE;
 if(start){
  // A deployment may be prepared today for tomorrow's first approach.
  // Invalid configuration fails closed; inbound replies remain independent.
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!Number.isFinite(Date.parse(start+'T00:00:00Z'))||new Date(start+'T00:00:00Z').toISOString().slice(0,10)!==start)return false;
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at).map(p=>[p.type,p.value]));
  if(parts.year+'-'+parts.month+'-'+parts.day<start)return false;
 }
 const day=saoPauloOutreachDay(at);
 if(day==='sunday')return false;
 const minutes=saoPauloClock(at);
 const selected=getSetting('client_outreach_hours',null);
 const parse=value=>{const m=/^(\d\d):([0-5]\d)$/.exec(String(value||''));return m?Number(m[1])*60+Number(m[2]):NaN;};
 const selectedStart=parse(selected?.start),selectedEnd=parse(selected?.end);
 const endCap=day==='saturday'?SATURDAY_APPROACH_END_MINUTES:FIRST_APPROACH_END_MINUTES;
 // Account-specific hours may NARROW, never widen, the applicable day's gate.
 if(Number.isInteger(selectedStart)&&selectedStart>=endCap)return false; // Do not widen an account's Saturday start time.
 const startMinute=Number.isInteger(selectedStart)&&selectedStart>=FIRST_APPROACH_START_MINUTES?selectedStart:FIRST_APPROACH_START_MINUTES;
 const endMinute=Number.isInteger(selectedEnd)?Math.min(selectedEnd,endCap):endCap;
 return minutes>=startMinute&&minutes<endMinute;
}
