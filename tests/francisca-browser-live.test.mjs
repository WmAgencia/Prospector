import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createFranciscaVoiceSession} from '../dashboard/public/francisca-live.mjs';
const read=file=>fs.readFileSync(fileURLToPath(new URL('../'+file,import.meta.url)),'utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('Francisca browser VAD sends utterances after silence, re-listens and stops the microphone',async()=>{
 const prev={window:globalThis.window,document:globalThis.document,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')};
 let rms=.002,closed=0,trackStops=0,turns=0,registrations=0;
 const stream={getTracks:()=>[{stop(){trackStops++;}}]};
 class Recorder{
  static isTypeSupported(type){return type.startsWith('audio/webm');}
  constructor(){this.state='inactive';registrations++;}
  start(){this.state='recording';}
  stop(){
   if(this.state!=='recording')return;
   this.state='inactive';
   this.ondataavailable?.({data:new Blob(['voz reconhecível '.repeat(45)],{type:'audio/webm'})});
   this.onstop?.();
  }
 }
 class FakeContext{
  state='running';
  createMediaStreamSource(){return {connect(){},disconnect(){}};}
  createAnalyser(){return {fftSize:2048,smoothingTimeConstant:0,getFloatTimeDomainData(dest){dest.fill(rms);}};}
  async close(){closed++;}
 }
 globalThis.window={MediaRecorder:Recorder,AudioContext:FakeContext};
 globalThis.document={hidden:false};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>stream}}});
 const states=[],session=createFranciscaVoiceSession({
  onTurn:async blob=>{assert.ok(blob.size>200);turns++;},
  onState:state=>states.push(state),
  onError:msg=>{throw Error(msg);},
  silenceMs:235
 });
 try{
  await session.start();
  assert.equal(states.at(-1),'listening');
  for(let i=0;i<2;i++){
   rms=.075;await sleep(365);
   rms=.001;await sleep(490);
   assert.equal(turns,i+1,'a spoken phrase becomes one turn without clicking again');
   assert.equal(states.at(-1),'listening','returns automatically to listening after answer');
  }
  assert.equal(registrations,2);
  session.stop();assert.equal(session.active,false);
  assert.equal(trackStops,1);assert.equal(closed,1);
  rms=.1;await sleep(260);assert.equal(turns,2,'a stopped microphone cannot send another turn');
 }finally{
  session.stop();if(prev.window===undefined)delete globalThis.window;else globalThis.window=prev.window;
  if(prev.document===undefined)delete globalThis.document;else globalThis.document=prev.document;
  if(prev.navigator)Object.defineProperty(globalThis,'navigator',prev.navigator);else delete globalThis.navigator;
 }
});
test('text input remains text-only and the removed voice switch cannot return',()=>{
 const app=read('dashboard/public/simple-app.js');
 const widgetStart=app.indexOf('function franciscaWidget(){'),widgetEnd=app.indexOf('function renderFrancisca(){',widgetStart);
 const widget=app.slice(widgetStart,widgetEnd);
 assert.match(widget,/Encerrar conversa por voz/);
 assert.match(widget,/francisca-voice-status/);
 assert.ok(!widget.includes('francisca-sound'));
 assert.ok(!widget.includes('Voz ligada'));
 assert.match(app,/if\(isAudio&&franciscaVoiceActive\)await speakFrancisca/);
 assert.match(app,/if\(franciscaVoiceActive\)stopFranciscaVoice\(\);\s*await franciscaReply\(text,false\)/);
 assert.match(app,/import\('\.\/francisca-live\.mjs'\)/);
});
test('first paint has no blocking loading copy and toast self-dismisses after four seconds',()=>{
 const html=read('dashboard/public/index.html'),app=read('dashboard/public/simple-app.js');
 assert.ok(!html.includes('Carregando Prospector'));
 assert.match(app,/noticeTimer=setTimeout\(/);
 assert.match(app,/\},4300\)/);
 assert.match(app,/render\(\);\s*}\s*try\{\s*if\(platformContext.role==="master"/);
});
test('Master navigation performs real page load instead of same-page hash-only navigation',()=>{
 const app=read('dashboard/public/simple-app.js'),platform=read('dashboard/platform.mjs');
 assert.match(app,/location\.replace\('\/\?workspace='\+encodeURIComponent\(mode\)/);
 assert.match(platform,/if\(!primary\)\{respond\(res,403,\{error:'Troca de painéis/);
 assert.ok(!app.includes("location.assign('/'+response.next)"));
});
