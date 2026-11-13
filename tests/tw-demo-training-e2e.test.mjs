import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'twco-demo-qa-'));
process.env.PROSPECTOR_DATA_DIR=temp;
process.env.PROSPECTOR_TENANT_ID=crypto.randomUUID();
process.env.PROSPECTOR_TENANT_NAME='Agência Exemplo · Demonstração';
process.env.PROSPECTOR_TENANT_INTERNAL='false';
process.env.TW_DEMO_TRAINING_MODE='APPROVE';
process.env.TW_DEMO_VERIFIED_SENDER_JID='5515981817336@s.whatsapp.net';
process.env.TW_DEMO_OWNED_SESSION_ID='prospector-'+crypto.randomUUID();
process.env.PROSP_TARGET_TEST_ONLY='true';
process.env.WA_AKG_WEBHOOK_SECRET=crypto.randomBytes(50).toString('hex');
process.env.AI_CONVERSATION_AUTOSEND='true';
process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED='true';
process.env.PROSPECTOR_REPLY_PACING_ENABLED='false';
delete process.env.PROSPECTOR_OWNER_PHONE;
delete process.env.GROQ_OWNER_WHATSAPP;

const {registerSession}=await import('../dashboard/waakg-session-registry.mjs');
const {one,getSetting}=await import('../dashboard/db.mjs');
const {approveTwDemoTraining}=await import('../dashboard/tw-demo-training-child.mjs');
const {twDemoReplyAllowed}=await import('../dashboard/tw-demo-reply-guard.mjs');
const {receiveWebhook}=await import('../dashboard/waakg-bridge.mjs');
const {handleSalesTurn}=await import('../dashboard/groq-sales-automation.mjs');
const {trainingPrompt,readActiveTrainingMarkdown}=await import('../dashboard/training.mjs');
const {configuredClosing}=await import('../dashboard/training-sales-extras.mjs');
const {prospectorChatVisible}=await import('../dashboard/whatsapp-roles.mjs');
registerSession(process.env.TW_DEMO_OWNED_SESSION_ID,'WhatsApp principal teste');
test.after(()=>fs.rmSync(temp,{recursive:true,force:true,maxRetries:20,retryDelay:100}));

function inbound({sender,body,id,validSignature=true,sessionId=process.env.TW_DEMO_OWNED_SESSION_ID}){
 const payload={event:'message.received',sessionId,
  data:{type:'TEXT',key:{id,remoteJid:sender,fromMe:false},content:body}};
 const data=Buffer.from(JSON.stringify(payload));
 const secret=validSignature?process.env.WA_AKG_WEBHOOK_SECRET:'invalid-signature';
 const signature='sha256='+crypto.createHmac('sha256',secret).update(data).digest('hex');
 const req=Readable.from([data]);req.headers={'x-webhook-signature':signature};
 return receiveWebhook(req);
}

test('TW training installs only for the real demo tenant, with exclusive allowlist and no outbound marketing',async()=>{
 await assert.rejects(approveTwDemoTraining({tenantName:'Outro cliente'}),/DEMO_CLIENT_ONLY/);
 assert.equal(readActiveTrainingMarkdown(),null);
 const result=await approveTwDemoTraining();
 assert.equal(result.status,'APPROVED',JSON.stringify(result));
 assert.equal(result.trainingApproved,true);
 assert.equal(result.testSenderAllowed,true);
 assert.equal(result.otherSendersBlocked,true);
 assert.equal(result.firstApproachEnabled,false);
 assert.equal(getSetting('paused'),true);
 assert.equal(getSetting('autonomous_outreach_enabled'),false);
 assert.equal(getSetting('training_business').name,'TW & CO Premium — demonstração');
 assert.equal(configuredClosing().mode,'handoff');
 assert.match(readActiveTrainingMarkdown(),/Rua Júlio Ribeiro, 876/);
 assert.match(readActiveTrainingMarkdown(),/câmbio automático/);
 assert.doesNotMatch(trainingPrompt(),/R\$\s*350|R\$\s*550/i);
 assert.equal(twDemoReplyAllowed({jid:process.env.TW_DEMO_VERIFIED_SENDER_JID,
  sessionId:process.env.TW_DEMO_OWNED_SESSION_ID}).allowed,true);
 assert.equal(twDemoReplyAllowed({jid:'5511999999999@s.whatsapp.net',
  sessionId:process.env.TW_DEMO_OWNED_SESSION_ID}).allowed,false);
 assert.equal((await approveTwDemoTraining()).status,'ALREADY_TRAINED_NO_OVERWRITE');
},{timeout:20000});

test('signed incoming from 7336 can get one simulated TW reply; any other sender remains manual-only',async()=>{
 const sessionId=process.env.TW_DEMO_OWNED_SESSION_ID;
 const other='5511988877777@s.whatsapp.net';
 const denied=await inbound({sender:other,body:'Vocês fazem manutenção?',id:'falsified111',validSignature:false});
 assert.equal(denied.status,401);
 const unsolicited=await inbound({sender:other,body:'Queria um orçamento',id:'signedother111'});
 assert.equal(unsolicited.body.processed,true);
 assert.equal(prospectorChatVisible({jid:other,sessionId}),true);
 assert.equal(one("SELECT COUNT(*) n FROM groq_auto_events").n,0,
   'non-whitelisted inbound must stay visible for humans but cannot queue AI');
 const legitimate=await inbound({sender:process.env.TW_DEMO_VERIFIED_SENDER_JID,
  body:'Meu carro está com a luz do motor acesa. Fazem diagnóstico?',
  id:'allowedtest111'});
 assert.equal(legitimate.body.processed,true);
 assert.equal(one("SELECT COUNT(*) n FROM groq_auto_events WHERE state='PENDING'").n,1);
 const providerId=sessionId+':allowedtest111';
 let sends=0,model=0;
 const response=await handleSalesTurn(providerId,{
  status:async()=>({connected:true,sessionId}),
  qualify:async()=>({confirmed:false,confidence:0}),
  draft:async()=>{model++;assert.match(trainingPrompt(),/TW & CO Premium/);
   return {ok:true,draft:'A TW & CO divulga diagnóstico automotivo. Qual o modelo e ano do carro, e qual luz acendeu no painel?',model:'QA_MOCK'};},
  send:async()=>{sends++;return {status:true,data:{acknowledged:true}};},
  presence:async()=>({status:true}),replyPause:async()=>{},replyJitter:()=>0
 });
 assert.equal(response.state,'SENT',JSON.stringify(response));
 assert.equal(sends,1);
 assert.equal(model,1);
 const out=one("SELECT body FROM messages WHERE direction='out' AND provider_id LIKE 'groq:%'");
 assert.match(out.body,/TW & CO/);
 assert.doesNotMatch(out.body,/Consecom|Wesley|R\$\s*(350|550)/);
 // Human takeover must halt all further automated messages.
 const human=await inbound({sender:process.env.TW_DEMO_VERIFIED_SENDER_JID,
  body:'Quero falar com um atendente humano',id:'wantperson111'});
 assert.equal(human.body.processed,true);
 const thread=one('SELECT manual_takeover FROM threads WHERE jid=?',process.env.TW_DEMO_VERIFIED_SENDER_JID);
 assert.equal(thread.manual_takeover,1);
 assert.equal(one("SELECT COUNT(*) n FROM groq_auto_events WHERE state='PENDING'").n,0);
 assert.equal(sends,1);
 // No cross-session message from this sender.
 const fake=await inbound({sender:process.env.TW_DEMO_VERIFIED_SENDER_JID,
  body:'Outra sessão',id:'sessionfake111',sessionId:'prospector-'+crypto.randomUUID()});
 assert.equal(fake.body.ignored,true);
},{timeout:35000});
