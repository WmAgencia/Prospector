import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/prospector-chat-handoff-');
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.PROSPECTOR_OWNER_PHONE='5515981817336';
process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED='true';
process.env.GROQ_API_KEY='mock-for-unit-tests';
const db=await import('../dashboard/db.mjs');
const {conversationHandoffStatus,changeConversationHandoff}=await import('../dashboard/conversation-handoff.mjs');
const j='5515988887777@s.whatsapp.net',chatId='wa:'+j;
const deps={status:async()=>({connected:true}),listChats:async()=>({items:[{id:chatId,jid:j}]})};

test('Remote customer chat can be assumed by a human and returned to the IA',async()=>{
 const initial=conversationHandoffStatus(chatId);
 assert.equal(initial.manualTakeover,false);
 assert.equal(initial.canTakeover,true);
 assert.equal(initial.canDeliverToAi,true);
 const human=await changeConversationHandoff({chatId,manual:true},deps);
 assert.equal(human.status,200);
 assert.equal(human.body.manualTakeover,true);
 const lead=db.one("SELECT id,phone FROM leads WHERE phone='5515988887777'");
 const thread=db.one('SELECT id,manual_takeover FROM threads WHERE lead_id=?',lead.id);
 assert.equal(thread.manual_takeover,1);
 const again=await changeConversationHandoff({chatId,manual:true},deps);
 assert.equal(again.status,200);
 assert.equal(conversationHandoffStatus(chatId).manualTakeover,true);
 const ai=await changeConversationHandoff({chatId,manual:false},deps);
 assert.equal(ai.status,200);
 assert.equal(ai.body.manualTakeover,false);
 assert.equal(db.one('SELECT manual_takeover FROM threads WHERE id=?',thread.id).manual_takeover,0);
});
test('Disabling IA blocks return while permitting an operator to assume the chat',async()=>{
 const lead=db.addLead({business:'Conversa real',phone:'5515988887775',source:'WHATSAPP_INBOUND'}).lead;
 const thread=db.getThread(lead.id,lead.phone+'@s.whatsapp.net');
 const key=thread.id;
 const prior=process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED;
 const other=process.env.AI_CONVERSATION_AUTOSEND;
 try{
  process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED='false';
  process.env.AI_CONVERSATION_AUTOSEND='false';
  const on=conversationHandoffStatus(key);
  assert.equal(on.canTakeover,true);
  assert.equal(on.canDeliverToAi,false);
  const human=await changeConversationHandoff({chatId:key,manual:true});
  assert.equal(human.status,200);
  const back=await changeConversationHandoff({chatId:key,manual:false});
  assert.equal(back.status,409);
  assert.equal(db.one('SELECT manual_takeover FROM threads WHERE id=?',key).manual_takeover,1);
 }finally{
  process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED=prior;
  if(other===undefined)delete process.env.AI_CONVERSATION_AUTOSEND;
  else process.env.AI_CONVERSATION_AUTOSEND=other;
 }
});
test('Owner and opt-outs are not converted to ordinary customer IA chats',async()=>{
 const owner=conversationHandoffStatus('wa:5515981817336@s.whatsapp.net');
 assert.equal(owner.canTakeover,false);
 assert.equal(owner.canDeliverToAi,false);
 const denied=await changeConversationHandoff({chatId:'wa:5515981817336@s.whatsapp.net',manual:true},deps);
 assert.equal(denied.status,403);
 const l=db.addLead({business:'Recusou',phone:'5515988887772',source:'WHATSAPP_INBOUND'}).lead;
 db.run('INSERT INTO suppressions(phone,reason,created_at) VALUES(?,?,?)',l.phone,'OPT_OUT',db.now());
 const state=conversationHandoffStatus('wa:'+l.phone+'@s.whatsapp.net');
 assert.equal(state.canTakeover,false);
 assert.equal(state.canDeliverToAi,false);
});
test('Cannot assume an arbitrary WhatsApp number that is absent from remote conversation list',async()=>{
 const missing='wa:5515988887771@s.whatsapp.net';
 const reply=await changeConversationHandoff({chatId:missing,manual:true},deps);
 assert.equal(reply.status,404);
 assert.equal(db.one("SELECT COUNT(*) n FROM leads WHERE phone='5515988887771'").n,0);
});
test('Invalid chat IDs, unsupported JIDs and invalid mode are rejected without writes',async()=>{
 assert.equal(conversationHandoffStatus('wa:123@g.us').canTakeover,false);
 assert.equal((await changeConversationHandoff({chatId:'wa:123@g.us',manual:true},deps)).status,403);
 assert.equal((await changeConversationHandoff({chatId,manual:'yes'},deps)).status,400);
 assert.equal(db.one("SELECT COUNT(*) n FROM leads WHERE phone='123'").n,0);
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
