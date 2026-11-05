import {randomInt} from 'node:crypto';
export const APPROACH_CADENCE=Object.freeze({mode:'random',minSeconds:90,maxSeconds:110,minDifferenceSeconds:5});
export function chooseApproachInterval(previousMs=0,pick=randomInt){
 const candidates=Array.from({length:21},(_,i)=>(90+i)*1000).filter(ms=>Math.abs(ms-previousMs)>=5000);
 return candidates[pick(candidates.length)];
}
