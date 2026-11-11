import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'owner-voice-private-recovery-'));
process.env.PROSPECTOR_OWNER_VOICE_RECOVERY_ENABLED='true';
process.env.WA_AKG_SESSION_ID='consecom-principal';
delete process.env.PROSPECTOR_TENANT_ID;

const db=await import('../dashboard/db.mjs');
const {eligibleOriginalVoiceMessage,recoverApprovedWesleyVoice,
 WESLEY_APPROVED_VOICE_SHA256,WESLEY_APPROVED_VOICE_BYTES}=await import('../dashboard/owner-audio-whatsapp-recovery.mjs');

test('owner fingerprint matches the approved original, not a synthetic voice',()=>{
 assert.equal(WESLEY_APPROVED_VOICE_SHA256,'9579652b25cf3c29aaff0c2972f2452bb847d00c697abdcfc9601f510c30a389');
 assert.equal(WESLEY_APPROVED_VOICE_BYTES,154890);
});
test('only a human-sent AUDIO near the exact user-approved WhatsApp time qualifies',()=>{
 const msg={id:'message_id_123456789',fromMe:true,type:'AUDIO',
  timestamp:'2026-11-10T14:49:33.000Z',
  mediaUrl:'/api/media/consecom-principal-example.ogg'};
 assert.equal(eligibleOriginalVoiceMessage(msg),true);
 assert.equal(eligibleOriginalVoiceMessage({...msg,fromMe:false}),false);
 assert.equal(eligibleOriginalVoiceMessage({...msg,type:'TEXT',mediaUrl:''}),false);
 assert.equal(eligibleOriginalVoiceMessage({...msg,timestamp:'2026-11-11T14:49:33.000Z'}),false);
});
test('private recovery uses authenticated GET history and declines any wrong file without approving',async()=>{
 const queried=[];
 let registrations=0;
 const request=async p=>{
  queried.push(p);
  if(p.startsWith('/api/contacts/'))
   return {data:p.includes('William')?[{jid:'5511999998765@s.whatsapp.net',name:'William-Pintura Automotiva'}]:[]};
  if(p==='/api/chat/consecom-principal')return {data:[]};
  if(p.startsWith('/api/chat/consecom-principal/'))
   return {data:[{id:'record_ABC123456',fromMe:true,type:'AUDIO',
    timestamp:'2026-11-10T14:49:33.000Z',
    mediaUrl:'/api/media/consecom-principal-record.ogg'}]};
  throw Error('Unexpected read: '+p);
 };
 const out=await recoverApprovedWesleyVoice({request,overrideSessions:['consecom-principal'],
  download:async()=>Buffer.alloc(154890),register:()=>{registrations++;throw Error('WRONG_AUDIO_REGISTERED');},
  logging:false});
 assert.equal(out.status,'NOT_FOUND');
 assert.equal(registrations,0);
 assert.equal(out.checkedAudio,1);
 assert.ok(queried.every(p=>p.startsWith('/api/contacts/')||p.startsWith('/api/chat/')));
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
