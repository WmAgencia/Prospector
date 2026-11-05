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
 {wait=pause,now=Date.now,jitter,onPreparing,preparingMs=randomInt(3000,5001)}={}){
 if(!replyPacingEnabled())return stillCurrent();
 let remaining=Math.max(0,replyDelayMs(incoming,reply,jitter)-Math.max(0,now()-startedAt));
 const visible=Math.min(5000,Math.max(3000,Number(preparingMs)||3000));
 if(onPreparing)remaining=Math.max(remaining,visible);
 let preparing=false;
 while(remaining>0){
  if(!stillCurrent())return false;
  if(onPreparing&&!preparing&&remaining<=visible){await onPreparing();preparing=true;if(!stillCurrent())return false;}
  const step=Math.min(750,remaining,onPreparing&&!preparing?Math.max(1,remaining-visible):remaining);
  await wait(step);
  remaining-=step;
 }
 return stillCurrent();
}
