import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-group-agent-'));
process.env.PROSPECTOR_DATA_DIR=directory;
process.env.PROSPECTOR_TENANT_ID='tenant-group-assistant-test';
process.env.AUDIO_TRANSCRIPTION_ENABLED='true';
const db=await import('../dashboard/db.mjs');
const group=await import('../dashboard/prospector-private-group.mjs');
const assistant=await import('../dashboard/prospector-group-assistant.mjs');
const avatar=await import('../dashboard/prospector-group-avatar.mjs');
const owner='5515999997336',partner='5515999992994',outsider='5515999991888';
const jid='120363415632875112@g.us',session='prospector-test-owner';
const reply={status:true,data:{key:{id:'accepted-id'}}};
function metadata(numbers=[owner,partner,outsider]){
 return {id:jid,subject:'Meu Prospector',participants:numbers.map(id=>({id:id+'@s.whatsapp.net'}))};
}
const calls=[];
const request=async (url,opts)=>{
 calls.push({url,opts});
 if(url.includes('/send'))return reply;
 if(url.includes('/webhooks/'))return {data:[]};
 return metadata();
};
test.beforeEach(()=>{
 db.run('DELETE FROM prospector_owner_group');
 db.run('DELETE FROM prospector_group_commands');
 db.run('DELETE FROM prospector_group_audio');
 db.run('DELETE FROM prospector_group_daily_reports');
 db.run('DELETE FROM prospector_group_confirmations');
 db.run('DELETE FROM prospector_group_outgoing_guard');
 db.run('DELETE FROM prospector_private_group_avatar');
 db.setSetting('paused',false);
 db.run("INSERT INTO prospector_owner_group(singleton,owner_session,owner_number,group_jid,state,updated_at) VALUES(1,?,?,?,?,?)",
  session,owner,jid,'READY',db.now());
 calls.length=0;
});
test('any CURRENT group participant including invited partner can request reports',async()=>{
 const result=await assistant.verifyGroupMember({sessionId:session,groupId:jid,
  sender:[outsider+'@s.whatsapp.net'],request});
 assert.equal(result.ok,true);
 assert.match(assistant.reportForGroup('2026-11-07'),/Mensagens enviadas/);
});
test('unknown sender and other group are denied before reading customer information',async()=>{
 assert.equal((await assistant.verifyGroupMember({sessionId:session,groupId:jid,
  sender:['5515999900000@s.whatsapp.net'],request})).ok,false);
 assert.equal((await assistant.verifyGroupMember({sessionId:session,groupId:'120363415632875199@g.us',
  sender:[partner+'@s.whatsapp.net'],request})).ok,false);
});
test('a participant removed from the live group immediately loses command access',async()=>{
 const removed=await assistant.verifyGroupMember({sessionId:session,groupId:jid,
  sender:[partner+'@s.whatsapp.net'],request:async()=>metadata([owner,outsider])});
 assert.equal(removed.ok,false);
});
test('group pauses immediately; resuming requires a one-time confirmation code',async()=>{
 const paused=await assistant.commandReply('pausa a prospecção',{sender:partner+'@s.whatsapp.net'});
 assert.match(paused,/pausada/i);assert.equal(db.getSetting('paused',false),true);
 const needed=await assistant.commandReply('retoma a prospecção',{sender:partner+'@s.whatsapp.net'});
 const code=needed.match(/CONFIRMAR (\d{6})/)?.[1];
 assert.ok(code);assert.equal(db.getSetting('paused',false),true);
 const confirmed=await assistant.commandReply('CONFIRMAR '+code,{sender:outsider+'@s.whatsapp.net'});
 assert.match(confirmed,/retomada/i);assert.equal(db.getSetting('paused',true),false);
 assert.match(await assistant.commandReply('CONFIRMAR '+code,{sender:owner+'@s.whatsapp.net'}),/inválido|utilizada/i);
});
test('operations and campaign-status request never invents advertising campaigns',async()=>{
 const text=await assistant.commandReply('quais campanhas estão ativas?',{sender:partner+'@s.whatsapp.net'});
 assert.match(text,/Prospector/);assert.match(text,/não campanhas de anúncios/);
});
test('webhook accepts a new human group member but never treats group as a prospect',async()=>{
 const event={isGroup:true,key:{id:'AAAA11111',remoteJid:jid,fromMe:false,participant:outsider+'@s.whatsapp.net'},
  type:'TEXT',sender:outsider+'@s.whatsapp.net',content:'relatório de hoje'};
 const accepted=await assistant.receivePrivateGroupWebhook({sessionId:session,data:event,request});
 assert.equal(accepted.queued,true);
 assert.equal(db.one('SELECT COUNT(*) n FROM leads').n,0);
 const duplicate=await assistant.receivePrivateGroupWebhook({sessionId:session,data:event,request});
 assert.equal(duplicate.duplicate,true);
 const record=db.one("SELECT group_jid FROM prospector_group_commands WHERE event_id=?",[jid+':AAAA11111'][0]);
 assert.equal(record.group_jid,jid);
});
test('messages sent by an owned number are ignored rather than answering the assistant itself',async()=>{
 const event={isGroup:true,key:{id:'AAAA22222',remoteJid:jid,fromMe:true,participant:owner+'@s.whatsapp.net'},
  type:'TEXT',sender:owner+'@s.whatsapp.net',content:'relatório'};
 const received=await assistant.receivePrivateGroupWebhook({sessionId:session,data:event,request});
 assert.equal(received.handled,false);
});
test('first WhatsApp creator can command in a one-person group through human message.sent',async()=>{
 const fromMe={isGroup:true,key:{id:'MANUAL444444',remoteJid:jid,fromMe:true},
  type:'TEXT',fromMe:true,from:owner+'@s.whatsapp.net',sender:'ME',content:'pausa a prospecção'};
 const answer=await assistant.receivePrivateGroupWebhook({sessionId:session,data:fromMe,event:'message.sent',request,
  getSessions:async()=>({items:[{sessionId:session,number:owner,connected:true}]})});
 assert.equal(answer.queued,true);
 assert.equal(db.one('SELECT COUNT(*) n FROM prospector_group_commands').n,1);
});
test('bot group replies cannot cause a message.sent feedback loop',async()=>{
 await assistant.sendGroupMessage({sessionId:session,groupId:jid,text:'Relatório da Francisca',request});
 const fromMe={isGroup:true,key:{id:'BOTMSG44444',remoteJid:jid,fromMe:true},
  type:'TEXT',fromMe:true,from:owner+'@s.whatsapp.net',sender:'ME',content:'Relatório da Francisca'};
 const answer=await assistant.receivePrivateGroupWebhook({sessionId:session,data:fromMe,event:'message.sent',request,
  getSessions:async()=>({items:[{sessionId:session,number:owner,connected:true}]})});
 assert.equal(answer.ignored,true);
 assert.equal(answer.reason,'BOT_OUTGOING');
 assert.equal(db.one('SELECT COUNT(*) n FROM prospector_group_commands').n,0);
});
test('audio in the group is accepted only from a current participant, with safe media path',async()=>{
 const event={isGroup:true,key:{id:'AAAA33333',remoteJid:jid,fromMe:false,participant:partner+'@s.whatsapp.net'},
  type:'AUDIO',sender:partner+'@s.whatsapp.net',fileUrl:'/api/media/prospector-test-owner-audio.ogg'};
 const received=await assistant.receivePrivateGroupWebhook({sessionId:session,data:event,request});
 assert.equal(received.audioQueued,true);
 const processed=await assistant.processGroupAudio({
  request,download:async()=>({buffer:Buffer.alloc(512),filename:'prospector-test-owner-audio.ogg'}),
  transcribe:async()=>({text:'quantas prospecções fizemos hoje'})
 });
 assert.equal(processed.state,'DONE');
 assert.equal(db.one('SELECT COUNT(*) n FROM prospector_group_commands').n,1);
});
test('at 8am daily report targets group not any personal number; no duplicate sends',async()=>{
 const sent=await assistant.scheduledGroupReport(new Date('2026-11-07T11:05:00Z'),{request});
 assert.equal(sent.state,'SENT');
 assert.equal(sent.reportDay,'2026-11-06');
 const send=calls.find(x=>x.url.endsWith('/send'));
 assert.ok(send);
 assert.match(send.url,/%40g\.us/);
 assert.match(send.opts.data.message.text,/2026-11-06/);
 const again=await assistant.scheduledGroupReport(new Date('2026-11-07T11:10:00Z'),{request});
 assert.equal(again.state,'ALREADY_ATTEMPTED');
 assert.equal(calls.filter(x=>x.url.endsWith('/send')).length,1);
});
test('a gateway timeout is UNKNOWN and never blindly sends the report again',async()=>{
 const time=new Date('2026-11-07T11:05:00Z');
 const failed=await assistant.scheduledGroupReport(time,{request:async()=>{throw Error('timeout')}});
 assert.equal(failed.state,'UNKNOWN');
 const retry=await assistant.scheduledGroupReport(time,{request});
 assert.equal(retry.state,'ALREADY_ATTEMPTED');
});
test('8am Sao Paulo schedule excludes 7am and 9am',async()=>{
 assert.equal((await assistant.scheduledGroupReport(new Date('2026-11-07T10:59:00Z'),{request})).state,'OUTSIDE_REPORT_HOUR');
 assert.equal((await assistant.scheduledGroupReport(new Date('2026-11-07T12:00:00Z'),{request})).state,'OUTSIDE_REPORT_HOUR');
});
test('avatar is a valid PNG and multipart updater runs exactly once',async()=>{
 const image=avatar.defaultProspectorAvatar();
 assert.deepEqual([...image.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 assert.equal(image.readUInt32BE(16),256);
 assert.equal(image.readUInt32BE(20),256);
 let count=0;
 const upload=async({png})=>{count++;assert.ok(png.length>1000);};
 assert.equal((await avatar.applyDefaultGroupAvatar({sessionId:session,groupJid:jid,upload})).status,'DONE');
 assert.equal((await avatar.applyDefaultGroupAvatar({sessionId:session,groupJid:jid,upload})).status,'ALREADY_SET');
 assert.equal(count,1);
});
test.after(()=>{db.db.close();fs.rmSync(directory,{force:true,recursive:true});});
