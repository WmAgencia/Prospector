import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';

const dir=fs.mkdtempSync(os.tmpdir()+'/francisca-voice-approval-');
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.PROSPECTOR_OWNER_PHONE='5515981817336';
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.PROSPECTOR_LIVE_TEST_ENABLED='false';
process.env.WA_AKG_CALL_LAB_ENABLED='true';
const owner={jid:'5515981817336@s.whatsapp.net',sessionId:'consecom-principal'};
const wrong={jid:'5515999990000@s.whatsapp.net',sessionId:'consecom-principal'};
const {newVoiceDirectMessageFlow,interpretVoiceSend}=await import('../dashboard/francisca-owner-voice-messages.mjs');
const {newFranciscaCallSession}=await import('../dashboard/francisca-call-lab.mjs');
const {one,run,now}=await import('../dashboard/db.mjs');
const phone='5515999992244';

test('Natural spoken request is parsed into exact recipient/text without sending',()=>{
 const a=interpretVoiceSend('Envia uma mensagem para o número 15 99999-2244 falando que olá, tudo bem?');
 assert.equal(a.phone,phone);
 assert.equal(a.text,'olá, tudo bem?');
 const b=interpretVoiceSend('Envia uma mensagem pro número 15 9811 8173 36');
 assert.equal(b.invalidPhone,true);
 assert.equal(b.phone,null);
 assert.equal(interpretVoiceSend('Qual é o status do sistema?'),null);
});
test('Single turn full request requires explicit spoken preview and sends exactly once',async()=>{
 const sent=[];
 const flow=newVoiceDirectMessageFlow({send:async args=>{sent.push(args);return true;}});
 const answer=await flow.turn('Manda uma mensagem para 15 99999 2244 falando olá, tudo bem?',owner);
 assert.match(answer,/15 999992244/);
 assert.match(answer,/olá, tudo bem\?/);
 assert.match(answer,/Posso enviar\?/);
 assert.equal(sent.length,0);
 assert.match(await flow.turn('pode enviar',wrong)||'',/^$/);
 assert.equal(sent.length,0);
 // An unverified identity clears the pending request.
 assert.equal(flow.state,null);
 const fresh=await flow.turn('Manda uma mensagem para 15 99999 2244 falando olá, tudo bem?',owner);
 assert.match(fresh,/Posso enviar/);
 assert.match(await flow.turn('pode enviar',owner),/WhatsApp aceitou/);
 assert.equal(sent.length,1);
 assert.equal(sent[0].jid,phone+'@s.whatsapp.net');
 assert.equal(sent[0].text,'olá, tudo bem?');
 assert.equal(flow.state,null);
 assert.equal(one("SELECT COUNT(*) n FROM francisca_voice_manual_sends WHERE state='ACCEPTED'")?.n,1);
});
test('Multi-turn phone first, text second, spoken yes third',async()=>{
 const sent=[];
 const flow=newVoiceDirectMessageFlow({send:async args=>{sent.push(args);return true;}});
 assert.match(await flow.turn('Envia uma mensagem para o número 15 99999 2244',owner),/Qual é a mensagem/);
 assert.equal(flow.state.stage,'text');
 assert.match(await flow.turn('a mensagem é Olá, tudo bem?',owner),/Olá, tudo bem\?/);
 assert.equal(sent.length,0);
 assert.match(await flow.turn('sim, pode enviar',owner),/WhatsApp aceitou/);
 assert.equal(sent.length,1);
 assert.equal(sent[0].text,'Olá, tudo bem?');
});
test('Text first, then phone: ask for only the missing information',async()=>{
 const sent=[];
 const flow=newVoiceDirectMessageFlow({send:async args=>{sent.push(args);return true;}});
 assert.match(await flow.turn('Envia uma mensagem falando bom dia, ficou tudo certo',owner),/telefone completo/);
 assert.equal(flow.state.stage,'phone');
 assert.match(await flow.turn('15 99999 2244',owner),/bom dia, ficou tudo certo/);
 assert.match(await flow.turn('pode mandar',owner),/WhatsApp aceitou/);
 assert.equal(sent.length,1);
});
test('Missing text, unclear approval, edit and cancel never send',async()=>{
 let sent=0;
 const flow=newVoiceDirectMessageFlow({send:async()=>{sent++;return true;}});
 await flow.turn('Envia mensagem para o número 15 99999 2244',owner);
 assert.match(await flow.turn('a mensagem é ficou pronto',owner),/ficou pronto/);
 assert.match(await flow.turn('quando puder, vamos ver',owner),/Ainda não enviei/);
 assert.equal(sent,0);
 assert.match(await flow.turn('não, altera para ficou aprovado',owner),/ficou aprovado/);
 assert.match(await flow.turn('cancela',owner),/cancelei/);
 assert.equal(sent,0);
});
test('Wrong length phone requires new number; no sending',async()=>{
 const flow=newVoiceDirectMessageFlow({send:async()=>{throw Error('SHOULD_NOT_SEND');}});
 assert.match(await flow.turn('Envie mensagem para 15 9811 8173 36',owner),/telefone completo/);
 assert.match(await flow.turn('15 9811 8173 36',owner),/quantidade de dígitos/);
 flow.end();
});
test('Suppressions prevent verbal one-to-one delivery, even after preview',async()=>{
 const flow=newVoiceDirectMessageFlow({send:async()=>{throw Error('FORBIDDEN');}});
 run('INSERT INTO suppressions(phone,reason,created_at) VALUES(?,?,?)',phone,'Opt out',now());
 await flow.turn('Envie uma mensagem para 15 99999 2244 falando certo',owner);
 assert.match(await flow.turn('pode enviar',owner),/bloqueado/);
 assert.equal(flow.state,null);
 run('DELETE FROM suppressions WHERE phone=?',phone);
});
test('Provider unknown result is consumed without retry',async()=>{
 let count=0;
 const flow=newVoiceDirectMessageFlow({send:async()=>{count++;throw Error('NETWORK');}});
 await flow.turn('Envie uma mensagem para 15 99999 2244 falando tudo bem',owner);
 assert.match(await flow.turn('autorizo',owner),/Não consegui confirmar/);
 assert.equal(count,1);
 assert.equal(flow.state,null);
});
test('Real voice session routes number, text, and approval without Groq or owner WhatsApp code',async()=>{
 const spoken=[
  'Francisca, envie uma mensagem para o número 15 99999 2244',
  'a mensagem é olá, tudo bem?',
  'pode enviar'
 ];
 const outgoing=[];
 let chats=0;
 const session=newFranciscaCallSession(owner,{
  transcribe:async()=>({text:spoken.shift()}),
  chat:async()=>{chats++;throw Error('GROQ_MUST_NOT_BE_CALLED');},
  sendDirectMessage:async a=>{outgoing.push(a);return true;},
  synthesize:async()=>({bytes:Buffer.alloc(512),voice:'test'}),
  convert:async()=>Buffer.alloc(640)
 });
 try{
  const one=await session.reply(Buffer.alloc(32000));
  const two=await session.reply(Buffer.alloc(32000));
  const three=await session.reply(Buffer.alloc(32000));
  assert.match(one.spoken,/Qual é a mensagem/);
  assert.match(two.spoken,/olá, tudo bem\?/);
  assert.match(two.spoken,/Posso enviar/);
  assert.match(three.spoken,/WhatsApp aceitou/);
  assert.equal(chats,0);
  assert.equal(outgoing.length,1);
  assert.equal(outgoing[0].text,'olá, tudo bem?');
 }finally{session.end();}
});
test('Voice user can check the last message receipt later without sending again',async()=>{
 const id='3EB0VOICE999';
 let sent=0;
 const flow=newVoiceDirectMessageFlow({send:async()=>{sent++;return {state:'ACCEPTED',providerId:id};},deliveryLookup:async()=> 'O último envio ainda não possui comprovante de entrega.'});
 const preview=await flow.turn('Envia uma mensagem para 15 99999 2244 falando olá',owner);
 assert.match(preview,/Posso enviar/);
 const ack=await flow.turn('pode enviar',owner);
 assert.match(ack,/NÃO confirmou a entrega/);
 assert.equal(sent,1);
 const report=await flow.turn('verifica a última mensagem',owner);
 // The regular send path cannot assert receipt, but the read-only follow-up can.
 assert.match(report,/comprovante de entrega|confirm|entrega/);
 assert.equal(sent,1);
 const {lastVoiceDirectDelivery}=await import('../dashboard/francisca-owner-voice-messages.mjs');
 const delivered=await lastVoiceDirectDelivery(owner,{request:async()=>({status:true,data:[{
  keyId:id,remoteJid:phone+'@s.whatsapp.net',fromMe:true,status:'DELIVERED'
 }]})});
 assert.match(delivered,/confirma a entrega/);
 assert.equal(sent,1);
});

test.after(async()=>{
 const {db}=await import('../dashboard/db.mjs');db.close();
 fs.rmSync(dir,{recursive:true,force:true});
});
