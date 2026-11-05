// São Paulo business-hour gate for every new WhatsApp prospecting approach.
// End is exclusive: 17:30:00 must not start another new approach.
export const FIRST_APPROACH_START_MINUTES=8*60;
export const FIRST_APPROACH_END_MINUTES=17*60+30;
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
 return minutes>=FIRST_APPROACH_START_MINUTES&&minutes<FIRST_APPROACH_END_MINUTES;
}
