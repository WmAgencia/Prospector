import {randomInt} from 'node:crypto';
export const APPROACH_CADENCE=Object.freeze({mode:'random',minSeconds:90,maxSeconds:180,minDifferenceSeconds:5,measuredFrom:'previous_attempt_finished'});
export function chooseApproachInterval(previousMs=0,pick=randomInt){
 const candidates=Array.from({length:91},(_,i)=>(90+i)*1000).filter(ms=>Math.abs(ms-previousMs)>=5000);
 return candidates[pick(candidates.length)];
}
export const approachDueAt=clock=>Math.max(clock.last_attempt_ms||0,clock.last_finished_ms||0)+clock.interval_ms;
