import test from 'node:test';
import assert from 'node:assert/strict';
import {createPulse} from '../dashboard/prospector-pulse.mjs';
test('only managed sessions are checked and no full phone number is exposed',async()=>{
 const checked=[];const p=createPulse({list:async()=>[{session_id:'own',label:'Meu WhatsApp'}],check:async id=>{checked.push(id);return {ok:true,connected:true,number:'5511999999999'};}});
 const s=await p.refresh();assert.deepEqual(checked,['own']);assert.equal(s.items[0].state,'ONLINE');assert.equal('number' in s.items[0],false);
});
test('failed and stale checks are unknown, not disconnection',async()=>{
 let time=0;const p=createPulse({clock:()=>time,list:async()=>[{session_id:'a'},{session_id:'b'}],check:async id=>id==='a'?{ok:false}:{ok:true,connected:false}});
 const s=await p.refresh();assert.equal(s.items[0].state,'UNKNOWN');assert.equal(s.items[1].state,'OFFLINE');time=400000;assert.equal(p.snapshot().items[1].state,'UNKNOWN');
});
test('transport stale is unstable and last online evidence survives failure',async()=>{
 let status={ok:true,connected:true};const p=createPulse({list:async()=>[{session_id:'a'}],check:async()=>status});
 const first=await p.refresh();status={ok:true,connected:false,transportStale:true};const second=await p.refresh();assert.equal(second.items[0].state,'UNSTABLE');assert.equal(second.items[0].lastOnlineAt,first.items[0].lastOnlineAt);
});
