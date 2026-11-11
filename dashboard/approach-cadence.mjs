import {randomInt} from 'node:crypto';
// Consecom owner: 580 minutes (08:00–17:40), divided into 80 equal slots.
// This is an upper bound and never forces sends when there are no eligible
// contacts. A previous attempt's end and its persisted timestamp are honored.
export const OWNER_DAILY_FIRST_APPROACH_MAX=80;
export const OWNER_FIRST_APPROACH_WINDOW_MINUTES=580;
export const OWNER_APPROACH_INTERVAL_MS=OWNER_FIRST_APPROACH_WINDOW_MINUTES*60_000/OWNER_DAILY_FIRST_APPROACH_MAX;
export const isConsecomOwner=()=>!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true';
export const APPROACH_CADENCE=Object.freeze(isConsecomOwner()?
 {mode:'uniform',minSeconds:OWNER_APPROACH_INTERVAL_MS/1000,maxSeconds:OWNER_APPROACH_INTERVAL_MS/1000,
  window:'08:00–17:40',maxPerDay:80,measuredFrom:'previous_attempt_finished'}:
 {mode:'random',minSeconds:90,maxSeconds:180,minDifferenceSeconds:5,measuredFrom:'previous_attempt_finished'});
export function chooseApproachInterval(previousMs=0,pick=randomInt){
 if(isConsecomOwner())return OWNER_APPROACH_INTERVAL_MS;
 const candidates=Array.from({length:91},(_,i)=>(90+i)*1000).filter(ms=>Math.abs(ms-previousMs)>=5000);
 return candidates[pick(candidates.length)];
}
export const approachDueAt=clock=>
 Math.max(clock.last_attempt_ms||0,clock.last_finished_ms||0)+
 (isConsecomOwner()?Math.max(OWNER_APPROACH_INTERVAL_MS,clock.interval_ms||0):clock.interval_ms);
