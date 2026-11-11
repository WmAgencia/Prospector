import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'owner-env-audio-'));
delete process.env.PROSPECTOR_TENANT_ID;
const db=await import('../dashboard/db.mjs');
const {bootstrapApprovedOwnerAudioFromEnv,EXACT_APPROVED_OWNER_AUDIO_SHA256,
 EXACT_APPROVED_OWNER_AUDIO_BYTES,approvedOwnerRecordingStatus}=await import('../dashboard/owner-approved-pitch.mjs');
test('owner-approved exact asset fingerprint is pinned',()=>{
 assert.equal(EXACT_APPROVED_OWNER_AUDIO_SHA256,'9579652b25cf3c29aaff0c2972f2452bb847d00c697abdcfc9601f510c30a389');
 assert.equal(EXACT_APPROVED_OWNER_AUDIO_BYTES,154890);
});
test('missing or incomplete chunks never activate an audio',()=>{
 const r=bootstrapApprovedOwnerAudioFromEnv({environ:{},register:()=>{throw Error('NEVER');}});
 assert.equal(r.status,'NOT_PROVISIONED');
 const r2=bootstrapApprovedOwnerAudioFromEnv({environ:{
  PROSPECTOR_OWNER_APPROVED_AUDIO_SHA256:EXACT_APPROVED_OWNER_AUDIO_SHA256,
  PROSPECTOR_OWNER_APPROVED_AUDIO_B64_PARTS:'21'
 },register:()=>{throw Error('NEVER');}});
 assert.equal(r2.status,'PART_MISSING_OR_INVALID');assert.equal(r2.part,0);
 assert.equal(approvedOwnerRecordingStatus().ready,false);
});
test('valid-looking wrong content never changes the approved recording',()=>{
 let calls=0;
 const sample=Buffer.alloc(154890);sample.write('OggS',0,'ascii');
 const b64=sample.toString('base64');
 const vars={PROSPECTOR_OWNER_APPROVED_AUDIO_SHA256:EXACT_APPROVED_OWNER_AUDIO_SHA256,
 PROSPECTOR_OWNER_APPROVED_AUDIO_B64_PARTS:'21'};
 for(let i=0;i<21;i++)vars['PROSPECTOR_OWNER_APPROVED_AUDIO_B64_'+String(i).padStart(2,'0')]=b64.slice(i*10000,(i+1)*10000);
 const r=bootstrapApprovedOwnerAudioFromEnv({environ:vars,register:()=>{calls++;return {ready:true};}});
 assert.equal(r.status,'AUDIO_HASH_MISMATCH');assert.equal(calls,0);
 assert.equal(approvedOwnerRecordingStatus().ready,false);
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
