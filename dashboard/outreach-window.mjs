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
 const minutes=saoPauloClock(at);
 return minutes>=FIRST_APPROACH_START_MINUTES&&minutes<FIRST_APPROACH_END_MINUTES;
}
