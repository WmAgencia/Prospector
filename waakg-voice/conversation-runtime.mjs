// Tracks what fraction of a generated answer was actually played to the caller.
// Transport metadata only, never call audio, transcript, or personal data.
export class InterruptionLedger {
 constructor(){this.current=null;this.pending=null;}
 begin(replyId,totalMs){
  if(typeof replyId!=='string'||!/^[0-9a-f-]{30,45}$/i.test(replyId))return false;
  this.current={replyId,totalMs:Math.max(100,Math.min(60000,Math.round(totalMs)||100)),
   playedMs:0};
  return true;
 }
 progress(playedMs){
  if(this.current)this.current.playedMs=Math.max(this.current.playedMs,
   Math.min(this.current.totalMs,Math.max(0,Math.round(playedMs)||0)));
 }
 interrupt(){
  if(!this.current)return false;
  const {replyId,playedMs,totalMs}=this.current;
  this.pending={replyId,playedMs,totalMs};
  this.current=null;
  return true;
 }
 unseen(replyId,totalMs){
  if(!this.begin(replyId,totalMs))return false;
  return this.interrupt();
 }
 completed(){this.current=null;}
 take(){
  const result=this.pending;
  this.pending=null;
  return result;
 }
 clear(){this.pending=null;this.current=null;}
}
export class BackchannelPolicy{
 constructor({sampleRate=16000,speechMs=3200,cooldownMs=14000}={}){
  this.minSamples=sampleRate*speechMs/1000;
  this.cooldownMs=cooldownMs;
  this.acked=false;this.lastAt=-Infinity;this.count=0;
 }
 canPlay({voicedSamples,now=Date.now(),replying=false,playing=false,ended=false}={}){
  return !this.acked&&!replying&&!playing&&!ended&&
   Number(voicedSamples)>=this.minSamples&&now-this.lastAt>=this.cooldownMs;
 }
 played(now=Date.now()){
  this.acked=true;this.lastAt=now;this.count++;
  return this.count%3===0?'hum':'aham';
 }
 resetTurn(){this.acked=false;}
}


// A separate, scarce cue while Francisca transcribes/thinks/synthesizes.
// Never pretends to check external data when no lookup was actually performed.
export class ThinkingCuePolicy{
 constructor({delayMs=950,cooldownMs=4000}={}){
  this.delayMs=delayMs;this.cooldownMs=cooldownMs;this.lastAt=-Infinity;
  this.turnId=0;this.claimed=false;this.total=0;this.startedAt=0;
 }
 start(now=Date.now()){
  this.turnId++;this.startedAt=now;this.claimed=false;
  return this.turnId;
 }
 due({turnId,now=Date.now(),replying=false,playing=false,ackBusy=false,ended=false,userSpeaking=false}={}){
  return turnId===this.turnId&&!this.claimed&&replying&&!playing&&!ackBusy&&!ended&&!userSpeaking&&
   now-this.startedAt>=this.delayMs&&now-this.lastAt>=this.cooldownMs;
 }
 claim(now=Date.now()){
  if(this.claimed)return null;
  this.claimed=true;this.lastAt=now;
  return ['consultar','pensar','instante'][this.total++%3];
 }
}
