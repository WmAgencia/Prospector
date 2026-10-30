import test from 'node:test';
import assert from 'node:assert/strict';
import {TurnDetector,PlaybackGate} from '../waakg-voice/turn-taking.mjs';
const frame=(amp=.0,len=320)=>new Float32Array(len).fill(amp);
function send(det,amp,count,mode='listening'){
 let last={type:'none'},events=[];
 for(let i=0;i<count;i++){last=det.push(frame(amp),mode);if(last.type!=='none')events.push(last);}
 return events;
}
test('Ends naturally within half a second of completed speech',()=>{
 const d=new TurnDetector();
 assert.deepEqual(send(d,0,15),[]);
 assert.deepEqual(send(d,.045,20),[]);
 const e=send(d,.001,27);
 assert.equal(e.length,1);
 assert.equal(e[0].type,'turn');
 assert(e[0].voiceMs>=350);
 assert(e[0].durationMs<1400);
});
test('Keeps short utterances with pre-roll and ignores noise and isolated clicks',()=>{
 const d=new TurnDetector();
 assert.deepEqual(send(d,.002,20),[]);
 assert.deepEqual(send(d,.06,1),[]);
 assert.deepEqual(send(d,.002,26),[]);
 assert.deepEqual(send(d,.045,12),[]);
 const events=send(d,.002,27);
 assert.equal(events.length,1);
 assert.equal(events[0].type,'turn');
 assert(events[0].voiceMs>=210);
});
test('Barge-in needs consecutive microphone voice and preserves interruption audio',()=>{
 const d=new TurnDetector();
 assert.deepEqual(send(d,.004,15,'speaking'),[]);
 assert.deepEqual(send(d,.08,5,'speaking'),[]);
 assert.deepEqual(send(d,.001,5,'speaking'),[]);
 const r=send(d,.05,12,'speaking');
 assert.equal(r.length,1);
 assert.equal(r[0].type,'interrupt');
 // At this point caller is speaking; gateway switches to listening immediately.
 assert.deepEqual(send(d,.04,8),[]);
 const e=send(d,.002,26);
 assert.equal(e.length,1);
 assert.equal(e[0].type,'turn');
 assert(e[0].voiceMs>=250);
});
test('Audio endpointing caps long uninterrupted utterances',()=>{
 const d=new TurnDetector({maxTurnMs:1500});
 const ev=send(d,.055,90);
 assert.equal(ev.length,1);
 assert.equal(ev[0].type,'turn');
 assert(ev[0].durationMs<=1600);
});
test('Playback gate revokes outstanding asynchronous audio on interruption and hangup',()=>{
 const p=new PlaybackGate();
 const a=p.next();
 assert(p.valid(a));
 p.cancel();
 assert(!p.valid(a));
 const b=p.next();
 assert(p.valid(b));
 p.cancel();
 assert(!p.valid(b));
});

test('Live-call voice detector tolerates a thinking pause and requires sustained barge-in',()=>{
 const d=new TurnDetector({stopSilenceMs:660,bargeVoiceMs:320,maxTurnMs:13000});
 assert.deepEqual(send(d,.055,25),[]);
 assert.deepEqual(send(d,.002,29),[]); // 580 ms: conversational pause, not end of turn
 assert.deepEqual(send(d,.06,10),[]); // caller continues same thought
 const events=send(d,.001,36);
 assert.equal(events.length,1);
 assert.equal(events[0].type,'turn');
 assert(events[0].voiceMs>=650);
 const second=new TurnDetector({stopSilenceMs:660,bargeVoiceMs:320});
 assert.deepEqual(send(second,.08,10,'speaking'),[]); // 200ms echo not enough to interrupt
 assert.deepEqual(send(second,.002,10,'speaking'),[]);
 assert.equal(send(second,.08,18,'speaking').filter(x=>x.type==='interrupt').length,1);
});

test('Malformed samples and noisy silence do not trigger a turn or interruption',()=>{
 const d=new TurnDetector();
 assert.equal(d.push(Buffer.alloc(20)).type,'none');
 assert.deepEqual(send(d,.004,90),[]);
 assert.deepEqual(send(d,.016,3,'speaking'),[]);
 assert.deepEqual(send(d,.001,30,'speaking'),[]);
});
