import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-emergency-'));
process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE='true';
const {waRequest}=await import('../dashboard/waakg-control.mjs');
const {sendVoiceMedia}=await import('../dashboard/waakg-media.mjs');
const {tickApproachQueue}=await import('../dashboard/prospecting-queue.mjs');
const {tickIntroductions}=await import('../dashboard/prospecting-introduction.mjs');
test('all outbound messages blocked by emergency flag without contacting provider',async()=>{
 for(const route of ['/api/messages/consecom-principal/5511988880000@s.whatsapp.net/send',
 '/api/messages/consecom-principal/5511988880000@s.whatsapp.net/media']){
 await assert.rejects(waRequest(route,{method:'POST',data:{message:{text:'hello'}}}),/EMERGENCY_ALL_OUTBOUND_PAUSED/);
 }
 await assert.rejects(sendVoiceMedia({session:'consecom-principal',jid:'5511988880000@s.whatsapp.net',bytes:Buffer.alloc(1280)}),/EMERGENCY_ALL_OUTBOUND_PAUSED/);
 assert.equal((await tickApproachQueue()).status,'PAUSED_EMERGENCY');
 assert.equal((await tickIntroductions()).state,'PAUSED_EMERGENCY');
});
test.after(async()=>{const {db}=await import('../dashboard/db.mjs');db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
