import test from 'node:test';
import assert from 'node:assert/strict';
import {createFranciscaVoiceSession} from '../dashboard/public/francisca-live.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('microphone remains active while Francisca speaks and interrupts playback on user speech',async()=>{
 const oldWindow=globalThis.window,oldDocument=globalThis.document;
 const oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 let rms=.001,stops=0,turns=0,interrupted=0,speaking=false,releaseFirst;
 const stream={getTracks:()=>[{stop(){stops++;}}]};
 class Recorder{
  static isTypeSupported(x){return x.startsWith('audio/webm');}
  state='inactive';
  start(){this.state='recording';}
  stop(){
   if(this.state!=='recording')return;
   this.state='inactive';
   this.ondataavailable?.({data:new Blob(['fala '.repeat(70)],{type:'audio/webm'})});
   this.onstop?.();
  }
 }
 class AudioContextMock{
  state='running';
  createMediaStreamSource(){return {connect(){},disconnect(){}};}
  createAnalyser(){return {fftSize:2048,getFloatTimeDomainData(array){array.fill(rms);}};}
  async close(){}
 }
 globalThis.window={MediaRecorder:Recorder,AudioContext:AudioContextMock};
 globalThis.document={hidden:false};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>stream}}});
 const session=createFranciscaVoiceSession({
  silenceMs:400,
  onTurn:async()=>{
   turns++;
   if(turns===1){speaking=true;await new Promise(resolve=>{releaseFirst=resolve;});}
  },
  canInterrupt:()=>speaking,
  onInterrupt:()=>{interrupted++;speaking=false;releaseFirst?.();},
  onError:msg=>{throw Error(msg);}
 });
 try{
  await session.start();
  rms=.15;await sleep(340);
  rms=.001;await sleep(630);
  assert.equal(turns,1,'first phrase should be processed');
  assert.equal(session.active,true);
  rms=.15;await sleep(450);
  assert.equal(interrupted,1,'new speech interrupts Francisca playback');
  assert.equal(session.active,true,'barge-in must not disconnect the microphone');
  rms=.001;await sleep(650);
  assert.equal(turns,2,'interrupted turn should be recorded without a second click');
  session.stop();assert.equal(stops,1);
 }finally{
  session.stop();
  if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;
  if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;
  if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;
 }
});
