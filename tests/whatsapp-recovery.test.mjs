import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-recovery-'));
process.env.PROSPECTOR_DATA_DIR=directory;
const recovery=await import('../dashboard/whatsapp-recovery.mjs');
const {proto,DEFAULT_CONNECTION_CONFIG}=await import('@whiskeysockets/baileys');
test('real protobuf message survives persistent retry store, keyed by conversation',()=>{
 const original={key:{id:'original-id',remoteJid:'5515999887766@s.whatsapp.net'},message:{audioMessage:{url:'https://example.com/audio',mimetype:'audio/ogg',fileSha256:Buffer.from([1,2,3])}}};
 assert.equal(recovery.rememberMessage(original,proto.Message),true);
 const restored=recovery.retryMessage(original.key,proto.Message);
 assert.equal(restored.audioMessage.url,original.message.audioMessage.url);
 assert.deepEqual(Buffer.from(restored.audioMessage.fileSha256),Buffer.from([1,2,3]));
 assert.equal(recovery.retryMessage({...original.key,remoteJid:'another@s.whatsapp.net'},proto.Message),undefined);
 assert.equal(recovery.retryMessage({id:'missing'},proto.Message),undefined);
 assert.equal(typeof DEFAULT_CONNECTION_CONFIG.makeSignalRepository,'function');
});
test('retry limit survives socket restarts and expires instead of looping indefinitely',()=>{
 let now=0;const cache=recovery.createRetryCache(()=>now);
 cache.set('message',5);cache.del('message');assert.equal(cache.get('message'),5);
 now=3600001;assert.equal(cache.get('message'),undefined);
});
test('repeated failures renew only the affected peer with backup and a cooldown',async()=>{
 const changes=[];let failed=0,success=0;
 const auth={creds:{secret:'never changed'},keys:{get:async()=>({'peer.0':{record:'old-session'}}),set:async value=>changes.push(value)}};
 const factory=()=>({jidToSignalProtocolAddress:()=> 'peer.0',decryptMessage:async input=>{if(input.valid)return Buffer.from('ok');throw Error('No matching sessions found for message');}});
 const repo=recovery.recoveryRepository(factory,{folder:directory,onFailure:()=>failed++,onSuccess:()=>success++})(auth);
 for(let i=0;i<4;i++)await assert.rejects(()=>repo.decryptMessage({jid:'peer@s.whatsapp.net',type:'msg'}),/No matching/);
 assert.deepEqual(changes,[{session:{'peer.0':null}}]);
 assert.equal(auth.creds.secret,'never changed');assert.equal(failed,4);
 const backups=fs.readdirSync(path.join(directory,'session-recovery'));
 assert.equal(backups.length,1);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'session-recovery',backups[0]),'utf8')),{record:'old-session'});
 await repo.decryptMessage({jid:'peer@s.whatsapp.net',valid:true});assert.equal(success,1);
});
test('unrelated errors and identity failures never reset a session',async()=>{
 let changes=0;
 const repo=recovery.recoveryRepository(()=>({decryptMessage:async()=>{throw Error('Untrusted identity key');}}),{folder:directory})({keys:{set:async()=>changes++}});
 await assert.rejects(()=>repo.decryptMessage({jid:'peer'}),/Untrusted/);assert.equal(changes,0);
});
test('delivery receipts update only outgoing messages, remain monotonic and tolerate other updates',async()=>{
 const db=await import('../dashboard/db.mjs');
 const lead=db.addLead({phone:'5515999008877',business:'Receipt regression test',source:'TEST'}).lead;
 const thread=db.getThread(lead.id);
 const message=db.addMessage({threadId:thread.id,providerId:'receipt-test',direction:'out',type:'text',body:'Teste',status:'sent'});
 assert.equal(recovery.recordDeliveryReceipt({key:{id:'receipt-test'},update:{}}),null);
 assert.equal(recovery.recordDeliveryReceipt({key:{id:'receipt-test'},update:{status:3}}).next,'delivered');
 assert.equal(recovery.recordDeliveryReceipt({key:{id:'receipt-test'},update:{status:4}}).next,'read');
 assert.equal(recovery.recordDeliveryReceipt({key:{id:'receipt-test'},update:{status:3}}),null);
 assert.equal(db.one('SELECT status FROM messages WHERE id=?',message.id).status,'read');
 db.addMessage({threadId:thread.id,providerId:'inbound-receipt',direction:'in',body:'Oi'});
 assert.equal(recovery.recordDeliveryReceipt({key:{id:'inbound-receipt'},update:{status:3}}),null);
});
test.after(async()=>{const {db}=await import('../dashboard/db.mjs');db.close();fs.rmSync(directory,{recursive:true,force:true});});
