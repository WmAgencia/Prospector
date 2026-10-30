// Conservative in-process PCM conditioner for 16-kHz phone audio.
// Avoids overaggressive noise cancellation and preserves speech dynamics.
// Playback correlation is only a high-confidence echo hint, not biometric ID.
export class VoiceAudioConditioner{
 constructor({minGate=.0025,echoSimilarity=.94}={}){
  this.floor=.002;this.gain=1;this.minGate=minGate;
  this.echoSimilarity=echoSimilarity;this.played=[];
 }
 rememberPlayback(frame){
  if(!(frame instanceof Float32Array)||!frame.length)return;
  const copy=new Float32Array(frame);
  this.played.push(copy);
  if(this.played.length>25)this.played.shift();
 }
 process(frame,{playing=false}={}){
  if(!(frame instanceof Float32Array)||!frame.length)return {frame:new Float32Array(),echo:false,rms:0};
  let energy=0,peak=0;
  for(const s of frame){energy+=s*s;peak=Math.max(peak,Math.abs(s));}
  const rms=Math.sqrt(energy/frame.length);
  if(rms<this.floor*2.2)this.floor=Math.max(.001,Math.min(.012,this.floor*.985+rms*.015));
  const out=new Float32Array(frame);
  const low=rms<Math.max(this.minGate,this.floor*1.3);
  if(low){out.fill(0);return {frame:out,echo:false,rms};}
  if(playing&&rms>.008&&this.played.length){
   for(const p of this.played){
    if(p.length!==frame.length)continue;
    let dot=0,aa=0,bb=0;
    for(let i=0;i<frame.length;i++){dot+=frame[i]*p[i];aa+=frame[i]**2;bb+=p[i]**2;}
    const corr=dot/Math.sqrt(aa*bb||1);
    const ratio=Math.sqrt(aa/(bb||1));
    if(corr>this.echoSimilarity&&ratio>.18&&ratio<3.2){
     out.fill(0);return {frame:out,echo:true,rms};
    }
   }
  }
  // Gentle, slow AGC; cap boosted amplitude to avoid clipping and distortion.
  // Gentle extra gain for quiet phone microphones. Never amplify gated silence.
  const desired=Math.max(.83,Math.min(2.2,.055/Math.max(.018,rms)));
  this.gain=this.gain*.9+desired*.1;
  const limit=peak>0?Math.min(this.gain,.92/peak):this.gain;
  for(let i=0;i<frame.length;i++)out[i]=Math.max(-.95,Math.min(.95,out[i]*limit));
  return {frame:out,echo:false,rms};
 }
 reset(){this.floor=.002;this.gain=1;this.played=[];}
}
