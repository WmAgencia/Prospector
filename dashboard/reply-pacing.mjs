import {randomInt} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';

export const replyPacingEnabled=()=>process.env.PROSPECTOR_REPLY_PACING_ENABLED!=='false';
export function replyDelayMs(incoming,reply,jitter=randomInt(0,4001)){
 const read=Math.min(1500,String(incoming||'').length)*22;
 const compose=Math.min(2000,String(reply||'').length)*38;
 return Math.min(35000,8000+read+compose+Math.min(4000,Math.max(0,Number(jitter)||0)));
}
// Model and TTS time already count toward the delay. Check every 750ms so a
// newer message, opt-out or human takeover cancels the pending response early.
export async function waitForReplyPacing({incoming,reply,startedAt,stillCurrent},
 {wait=pause,now=Date.now,jitter}={}){
 if(!replyPacingEnabled())return stillCurrent();
 let remaining=Math.max(0,replyDelayMs(incoming,reply,jitter)-Math.max(0,now()-startedAt));
 while(remaining>0){
  if(!stillCurrent())return false;
  const step=Math.min(750,remaining);
  await wait(step);
  remaining-=step;
 }
 return stillCurrent();
}
