import test from 'node:test';
import assert from 'node:assert/strict';
import {findSentTextInHistory,loadProspectorHistory,preflightNewStep} from '../dashboard/prospecting-chat-history.mjs';
const time='2026-11-24T11:00:00.000Z';
const msg=(id,text,at=time,fromMe=true)=>({fromMe,type:'TEXT',keyId:id,content:text,timestamp:at,status:'DELIVERED'});
test('read WhatsApp history by the exact outgoing message ID',()=>{
 const items=[msg('a-matching-but-other-id','Oi'),msg('WA_PROSPECT_SEND_ID','Oi')];
 assert.equal(findSentTextInHistory({messages:items,providerId:'WA_PROSPECT_SEND_ID'}).state,'EXACT_ID');
 assert.equal(findSentTextInHistory({messages:items,providerId:'WA_MISSING_ID'}).state,'NOT_FOUND');
});
test('unique outgoing message text and attempt time can recover a missing response ID',()=>{
 const items=[msg('RECEIPT_22222','  Posso   mandar o áudio? '),
  msg('INBOUND_33333','Posso mandar o áudio?',time,false),
  msg('OLD_44444','Posso mandar o áudio?','2026-11-22T11:00:00Z')];
 const x=findSentTextInHistory({messages:items,expectedText:'Posso mandar o áudio?',attemptedAt:time});
 assert.equal(x.state,'UNIQUE_CONTENT');assert.equal(x.message.keyId,'RECEIPT_22222');
});
test('two matching sends are ambiguous and never justify an automated resend',()=>{
 const x=findSentTextInHistory({messages:[msg('RECEIPT_22222','Oi'),msg('RECEIPT_33333','Oi')],
  expectedText:'Oi',attemptedAt:time});
 assert.equal(x.state,'AMBIGUOUS');
});
test('missing history and missing message are not proof of non-delivery',async()=>{
 const offline=await loadProspectorHistory({sessionId:'sender-1',jid:'5515999995555@s.whatsapp.net',fetchChat:async()=>{throw Error('offline');}});
 assert.equal(offline.state,'UNAVAILABLE');
 const ready=await loadProspectorHistory({sessionId:'sender-1',jid:'5515999995555@s.whatsapp.net',fetchChat:async()=>({status:true,data:[]})});
 assert.equal(ready.state,'AVAILABLE');
 assert.equal(findSentTextInHistory({messages:ready.messages,expectedText:'Olá',attemptedAt:time}).state,'NOT_FOUND');
});

test('before first send, lookup decides clear, previously sent or unknown',async()=>{
 const jid='5515999995555@s.whatsapp.net',sessionId='sender-1';
 const check=messages=>preflightNewStep({sessionId,jid,kind:'TEXT',text:'Oi!',at:new Date(time),
  fetchChat:async()=>({status:true,data:messages})});
 assert.equal((await check([])).state,'CLEAR');
 assert.equal((await check([msg('HISTORY_12345','Oi!')])).state,'EXISTS');
 assert.equal((await preflightNewStep({sessionId,jid,kind:'TEXT',text:'Oi!',at:new Date(time),
  fetchChat:async()=>{throw Error('gateway unavailable');}})).state,'UNAVAILABLE');
});
test('video caption can be matched, generic audio cannot identify original recording',async()=>{
 const sessionId='sender-1',jid='5515999995555@s.whatsapp.net',caption='Vídeo demonstrativo e link';
 const check=(kind,messages)=>preflightNewStep({sessionId,jid,kind,text:caption,at:new Date(time),
  fetchChat:async()=>({status:true,data:messages})});
 assert.equal((await check('VIDEO',[])).state,'CLEAR');
 assert.equal((await check('VIDEO',[{fromMe:true,type:'VIDEO',keyId:'VIDEO_22222',content:caption,timestamp:time}])).state,'EXISTS');
 assert.equal((await check('AUDIO',[{fromMe:true,type:'AUDIO',keyId:'AUDIO_33333',timestamp:time}])).state,'POSSIBLE_EXISTING');
});
