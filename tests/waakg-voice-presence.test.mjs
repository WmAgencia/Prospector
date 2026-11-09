import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'voice-presence-check-'));
const {sendVoiceWithRecording}=await import('../dashboard/waakg-voice-presence.mjs');
const {db}=await import('../dashboard/db.mjs');
const jid='5511988882994@s.whatsapp.net';
const session='simulated-sender';
test('voice pitch shows recording, waits, sends push-to-talk, then closes presence',async()=>{
 const order=[];
 const result=await sendVoiceWithRecording({jid,session,bytes:Buffer.alloc(4000,1),
  sendPresence:async(_path,opt)=>{order.push(opt.data.presence);return {status:true}},
  sleep:async duration=>{assert.equal(duration,4200);order.push('wait')},
  sendAudio:async()=>{order.push('voice');return {accepted:true}}
 });
 assert.deepEqual(order,['recording','wait','voice','paused']);
 assert.equal(result.accepted,true);
 assert.equal(result.recordingPresenceAccepted,true);
});
test('presence unavailable still transmits voice only once',async()=>{
 let sends=0;
 const r=await sendVoiceWithRecording({jid,session,bytes:Buffer.alloc(4000,2),
  sendPresence:async()=>{throw Error('OFFLINE_PRESENCE')},
  sleep:async()=>{throw Error('SHOULD_NOT_WAIT')},
  sendAudio:async()=>{sends++;return {accepted:true}}
 });
 assert.equal(sends,1);assert.equal(r.recordingPresenceAccepted,false);
});
test.after(()=>{db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true})});
