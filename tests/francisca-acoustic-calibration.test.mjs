import test from 'node:test';
import assert from 'node:assert/strict';
import {TurnDetector,FRANCISCA_LIVE_TURN_CONFIG} from '../waakg-voice/turn-taking.mjs';
import {VoiceAudioConditioner} from '../waakg-voice/audio-conditioning.mjs';
const sine=(amp,length=320)=>Float32Array.from({length},(_,i)=>Math.sin(i*.29)*amp);
const frame=(amp=0)=>new Float32Array(320).fill(amp);
function push(detector,conditioner,signal,count,mode='listening'){
 const out=[];
 for(let i=0;i<count;i++){
  const conditioned=conditioner.process(signal,{playing:mode==='speaking'});
  const event=detector.push(conditioned.frame,mode);
  if(event.type!=='none')out.push(event);
 }
 return out;
}
test('Phone caller can pause to think for 800ms without Francisca cutting the turn',()=>{
 assert(FRANCISCA_LIVE_TURN_CONFIG.stopSilenceMs>=1000);
 const d=new TurnDetector(FRANCISCA_LIVE_TURN_CONFIG),c=new VoiceAudioConditioner();
 assert.equal(push(d,c,sine(.08),35).length,0);
 assert.equal(push(d,c,frame(.0005),40).length,0);
 assert.equal(push(d,c,sine(.08),20).length,0);
 const finished=push(d,c,frame(.0005),57);
 assert.equal(finished.filter(e=>e.type==='turn').length,1);
});
test('Low-volume natural speech is amplified enough to register without amplifying silence',()=>{
 const d=new TurnDetector(FRANCISCA_LIVE_TURN_CONFIG),c=new VoiceAudioConditioner();
 assert.equal(push(d,c,sine(.008),80).length,0);
 const out=push(d,c,frame(.0004),57);
 assert(out.some(e=>e.type==='turn'),'quiet speech should be captured as one user turn');
 assert(!push(d,c,frame(.0004),65).some(e=>e.type==='turn'));
});
test('Short playback echo and transient sound do not interrupt Francisca, sustained owner voice does',()=>{
 const d=new TurnDetector(FRANCISCA_LIVE_TURN_CONFIG),c=new VoiceAudioConditioner();
 const ref=sine(.24);c.rememberPlayback(ref);
 assert.equal(push(d,c,ref,19,'speaking').length,0);
 const muted=c.process(ref,{playing:true});
 assert.equal(muted.echo,true);
 assert.equal(push(d,c,frame(.0003),30,'speaking').length,0);
 assert.equal(push(d,c,sine(.15),12,'speaking').length,0);
 assert.equal(push(d,c,frame(.0003),8,'speaking').length,0);
 const result=push(d,c,sine(.15),23,'speaking');
 assert(result.some(e=>e.type==='interrupt'));
});
