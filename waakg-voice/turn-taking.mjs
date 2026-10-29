// Sample-clock voice activity/turn taking for PCM float32 mono, 16 kHz.
// Pure module: no WhatsApp credentials, no audio recordings, no wall-clock timers.
export class TurnDetector {
 constructor({sampleRate=16000,minVoiceMs=210,stopSilenceMs=480,maxTurnMs=11500,
  preRollMs=240,bargeVoiceMs=240,baseRms=.010,bargeRms=.018}={}){
  this.rate=sampleRate;
  this.minVoice=Math.ceil(sampleRate*minVoiceMs/1000);
  this.stopSilence=Math.ceil(sampleRate*stopSilenceMs/1000);
  this.maxTurn=Math.ceil(sampleRate*maxTurnMs/1000);
  this.preRoll=Math.ceil(sampleRate*preRollMs/1000);
  this.bargeVoice=Math.ceil(sampleRate*bargeVoiceMs/1000);
  this.baseRms=baseRms;
  this.bargeRms=bargeRms;
  this.noise=.003;
  this.reset();
 }
 reset(){
  this.parts=[];this.samples=0;this.voiced=0;this.quiet=0;
  this.pre=[];this.preSamples=0;this.barge=[];this.bargeSamples=0;this.bargeVoiced=0;
  this.mode='listening';
 }
 get hasSpeech(){return this.voiced>=this.minVoice;}
 // Retain only enough quiet frames to avoid clipping the start of short utterances.
 _preRoll(frame){
  this.pre.push(frame);this.preSamples+=frame.length;
  while(this.pre.length>1&&this.preSamples-this.pre[0].length>=this.preRoll)
   this.preSamples-=this.pre.shift().length;
 }
 _append(frame){this.parts.push(frame);this.samples+=frame.length;}
 // Feed every decoded 16 kHz microphone frame, including while playing output.
 push(audio,mode='listening'){
  if(!(audio instanceof Float32Array)||audio.length===0||audio.length>this.rate*2)
   return {type:'none'};
  if(!['listening','speaking','thinking'].includes(mode))return {type:'none'};
  // A new speaking phase must not inherit a fragment captured before playback.
  if(mode==='speaking'&&this.mode!=='speaking'){
   this.barge=[];this.bargeSamples=0;this.bargeVoiced=0;
   this.parts=[];this.samples=0;this.voiced=0;this.quiet=0;
  }
  if(this.mode==='speaking'&&mode!=='speaking'){
   this.barge=[];this.bargeSamples=0;this.bargeVoiced=0;
  }
  this.mode=mode;
  let sum=0;
  for(let i=0;i<audio.length;i++)sum+=audio[i]*audio[i];
  const rms=Math.sqrt(sum/audio.length);
  const voiceThreshold=Math.max(this.baseRms,Math.min(.035,this.noise*2.7));
  const talking=rms>voiceThreshold;
  if(!talking&&rms<.022)this.noise=Math.max(.0015,Math.min(.012,this.noise*.97+rms*.03));
  const segment=new Float32Array(audio);
  if(mode==='speaking'){
   // Echo guard: several consecutive loud microphone frames are required
   // before we cut off Francisca, to avoid reacting to a single Opus spike.
   if(rms>Math.max(this.bargeRms,this.noise*3.7)){
    this.barge.push(segment);this.bargeSamples+=segment.length;this.bargeVoiced+=segment.length;
   }else{
    this.barge=[];this.bargeSamples=0;this.bargeVoiced=0;
   }
   if(this.bargeVoiced<this.bargeVoice)return {type:'none',rms};
   const kept=this.barge;
   this.barge=[];this.bargeSamples=0;this.bargeVoiced=0;
   this.parts=[...kept];this.samples=kept.reduce((a,b)=>a+b.length,0);
   this.voiced=this.samples;this.quiet=0;this.pre=[];this.preSamples=0;
   this.mode='listening';
   return {type:'interrupt',voiceMs:Math.round(this.voiced*1000/this.rate)};
  }
  if(!this.parts.length){
   if(!talking){this._preRoll(segment);return {type:'none',rms};}
   for(const f of this.pre)this._append(f);
   this.pre=[];this.preSamples=0;
  }
  this._append(segment);
  if(talking){this.voiced+=segment.length;this.quiet=0;}
  else this.quiet+=segment.length;
  if(this.samples>=this.maxTurn||(this.voiced>=this.minVoice&&this.quiet>=this.stopSilence)){
   const samples=this.samples, voiced=this.voiced;
   const all=this.parts;
   this.parts=[];this.samples=0;this.voiced=0;this.quiet=0;
   this.pre=[];this.preSamples=0;
   if(voiced<this.minVoice)return {type:'none'};
   return {type:'turn',frames:all,durationMs:Math.round(samples*1000/this.rate),
    voiceMs:Math.round(voiced*1000/this.rate),mode};
  }
  return {type:'none',rms};
 }
}
// A playback generation token ensures that a barge-in or hangup immediately
// invalidates all asynchronous and queued audio from the previous answer.
export class PlaybackGate{
 constructor(){this.generation=0;}
 next(){return ++this.generation;}
 cancel(){return ++this.generation;}
 valid(generation){return generation===this.generation;}
}
