import test from 'node:test';
import assert from 'node:assert/strict';
import {ThinkingCuePolicy} from '../waakg-voice/conversation-runtime.mjs';

test('No thinking cue for quick answer or while the user is speaking',()=>{
 const p=new ThinkingCuePolicy({delayMs:1500,cooldownMs:17000});
 const t=p.start(10000);
 assert.equal(p.due({turnId:t,now:11300,replying:true}),false);
 assert.equal(p.due({turnId:t,now:11600,replying:false}),false);
 assert.equal(p.due({turnId:t,now:11600,replying:true,userSpeaking:true}),false);
 assert.equal(p.due({turnId:t,now:11600,replying:true,playing:true}),false);
 assert.equal(p.due({turnId:t,now:11600,replying:true,ackBusy:true}),false);
 assert.equal(p.due({turnId:t,now:11600,replying:true,ended:true}),false);
 assert.equal(p.due({turnId:t,now:11600,replying:true}),true);
});
test('A slow turn gets only one quiet processing acknowledgement',()=>{
 const p=new ThinkingCuePolicy({delayMs:1500,cooldownMs:17000});
 const t=p.start(10000);
 assert(p.due({turnId:t,now:11600,replying:true}));
 assert.equal(p.claim(11600),'pensar');
 assert.equal(p.claim(11800),null);
 assert(!p.due({turnId:t,now:16000,replying:true}));
});
test('Cooldown and active turn identity block repetitive or stale cues',()=>{
 const p=new ThinkingCuePolicy({delayMs:1500,cooldownMs:17000});
 const first=p.start(10000);
 p.claim(11600);
 const second=p.start(20000);
 assert(!p.due({turnId:first,now:21600,replying:true}));
 assert(!p.due({turnId:second,now:21600,replying:true}));
 const third=p.start(31000);
 assert(p.due({turnId:third,now:32500,replying:true}));
 assert.equal(p.claim(32500),'instante');
 const fourth=p.start(51000);
 assert(p.due({turnId:fourth,now:52500,replying:true}));
 assert.equal(p.claim(52500),'entendi');
});
