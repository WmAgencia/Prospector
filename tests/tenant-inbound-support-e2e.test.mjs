import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

const home=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-inbound-full-'));
test.after(()=>fs.rmSync(home,{recursive:true,force:true,maxRetries:25,retryDelay:100}));

// Each case starts in an independent process, just as real client workspaces do.
// This fixture never connects to a WA-AKG endpoint or Groq and never sends a WhatsApp.
const fixture=String.raw`
 import assert from 'node:assert/strict';
 import crypto from 'node:crypto';
 import {Readable} from 'node:stream';
 import {getSetting,setSetting,one,all,now} from './dashboard/db.mjs';
 import {registerSession} from './dashboard/waakg-session-registry.mjs';
 import {receiveWebhook} from './dashboard/waakg-bridge.mjs';
 import {prospectorChatVisible,prospectorChatEligible,tenantInboundReceiveAllowed} from './dashboard/whatsapp-roles.mjs';
 import {queueInboundTurn,handleSalesTurn} from './dashboard/groq-sales-automation.mjs';
 import {readActiveTrainingMarkdown,handleTraining,trainingPrompt} from './dashboard/training.mjs';
 import {conversationHandoffStatus,changeConversationHandoff} from './dashboard/conversation-handoff.mjs';
 const company=process.env.TEST_COMPANY,session='prospector-'+crypto.randomUUID();
 const customer='5511976540001@s.whatsapp.net';
 registerSession(session,'WhatsApp piloto');
 function request(text,id='id-'+crypto.randomUUID(),{sessionId=session,sigValid=true,fromMe=false,group=false}={}){
  const packet={event:'message.received',sessionId,data:{type:'TEXT',key:{id,remoteJid:group?'123456789@g.us':customer,fromMe},content:text}};
  const raw=Buffer.from(JSON.stringify(packet));
  const req=Readable.from([raw]);
  req.headers={'x-webhook-signature':'sha256='+crypto.createHmac('sha256',sigValid?process.env.WA_AKG_WEBHOOK_SECRET:'wrong-secret')
   .update(raw).digest('hex')};
  return receiveWebhook(req);
 }
 let sends=0,modelCalls=0;
 assert.equal(tenantInboundReceiveAllowed({jid:customer,sessionId:session}),true);
 assert.equal(prospectorChatVisible({jid:customer,sessionId:session}),false);
 assert.equal(prospectorChatEligible({jid:customer,sessionId:session}),false);
 const bad=await request('Olá','id-unauthenticated',{sigValid:false});
 assert.equal(bad.status,401);
 assert.equal(one('SELECT COUNT(*) n FROM waakg_inbox').n,0);
 const group=await request('Olá','id-group',{group:true});
 assert.equal(group.status,200);
 assert.equal(group.body.ignored,true);
 const wrong=await request('Olá','id-wrong-session',{sessionId:'prospector-'+crypto.randomUUID()});
 assert.equal(wrong.body.ignored,true);
 assert.equal(one('SELECT COUNT(*) n FROM waakg_inbox').n,0);
 const received=await request('Olá, gostaria de saber sobre os serviços','id-before-training');
 assert.equal(received.status,200);
 assert.equal(received.body.processed,true);
 assert.equal(one('SELECT COUNT(*) n FROM waakg_inbox').n,1);
 assert.equal(one('SELECT COUNT(*) n FROM groq_auto_events').n,0,'no queue without approved training');
 assert.equal(prospectorChatVisible({jid:customer,sessionId:session}),true);
 assert.equal(prospectorChatEligible({jid:customer,sessionId:session}),true);
 const handoffBefore=conversationHandoffStatus('wa:'+customer);
 assert.equal(handoffBefore.canTakeover,true,'human operator can read a verified incoming message');
 assert.equal(handoffBefore.canDeliverToAi,false,'no IA until training is approved');
 const repeated=await request('Olá, gostaria de saber sobre os serviços','id-before-training');
 assert.equal(repeated.body.duplicate,true);
 assert.equal(one('SELECT COUNT(*) n FROM waakg_inbox').n,1);
 const trainingText='# Manual comercial privado: '+company+'\\n\\n'+
  '- Empresa: '+company+'\\n'+
  '- Serviços autorizados: manutenção de equipamentos; orçamento sob consulta.\\n'+
  '- Nunca usar o nome Consecom ou outras marcas.\\n'+
  '- Para negociações e preços não aprovados, transferir ao responsável.\\n';
 const draftId=crypto.randomUUID();
 setSetting('training_draft',{id:draftId,source:'manual',text:trainingText,at:now()});
 let approved=null;
 await handleTraining({method:'POST'},null,new URL('http://test/api/training/approve'),{
  json:async()=>({id:draftId,text:trainingText}),
  respond:(_res,status,body)=>approved={status,body}
 });
 assert.equal(approved.status,200);
 assert.match(readActiveTrainingMarkdown(),new RegExp(company));
 assert.doesNotMatch(trainingPrompt(),/REGRA DE PREÇO DA CONSECOM/);
 assert.equal(getSetting('training_draft',null),null);
 assert.equal(one('SELECT COUNT(*) n FROM groq_auto_events').n,0,'past incoming stays unqueued after approval');
 const handoffAfter=conversationHandoffStatus('wa:'+customer);
 assert.equal(handoffAfter.canDeliverToAi,true,'approved tenant IA can receive the inbound chat');

 const next=await request('Gostaria de saber sobre manutenção de equipamentos','id-after-training');
 assert.equal(next.status,200);
 assert.equal(one("SELECT COUNT(*) n FROM groq_auto_events WHERE state='PENDING'").n,1);
 const providerId=session+':id-after-training';
 const options={
  status:async()=>({connected:true,sessionId:session}),
  qualify:async()=>({confirmed:false,evidence:''}),
  draft:async()=>{
   modelCalls++;
   return {ok:true,draft:'Trabalhamos com manutenção de equipamentos na '+company+'. Qual equipamento precisa de atendimento?',model:'SIMULATED'};
  },
  send:async()=>{
   sends++;
   return {status:true,data:{accepted:true}};
  },
  presence:async()=>({status:true}),
  replyPause:async()=>{},
  replyJitter:()=>0
 };
 const replied=await handleSalesTurn(providerId,options);
 assert.equal(replied.state,'SENT',JSON.stringify(replied));
 assert.equal(sends,1);
 assert.equal(modelCalls,1);
 assert.equal(one("SELECT COUNT(*) n FROM messages WHERE direction='out' AND provider_id LIKE 'groq:%'").n,1);
 const reply=one("SELECT body FROM messages WHERE direction='out' AND provider_id LIKE 'groq:%'").body;
 assert.match(reply,new RegExp(company));
 assert.doesNotMatch(reply,/Consecom|Wesley/i);
 // An explicit human request suppresses the model and marks manual takeover.
 const human=await request('Quero falar com um atendente humano, por favor','id-human');
 assert.equal(human.status,200);
 assert.equal(one("SELECT manual_takeover FROM threads WHERE jid=?",customer).manual_takeover,1);
 const handoffHuman=conversationHandoffStatus('wa:'+customer);
 assert.equal(handoffHuman.manualTakeover,true);
 assert.equal(sends,1,'no automatic response is sent on human handoff');
 // After the owner hands control back to the already-approved IA, the chat can resume.
 const resumed=await changeConversationHandoff({chatId:'wa:'+customer,manual:false},{
  status:async()=>({connected:true}),
  listChats:async()=>({items:[{id:'wa:'+customer,jid:customer}]})
 });
 assert.equal(resumed.status,200,JSON.stringify(resumed));
 assert.equal(conversationHandoffStatus('wa:'+customer).manualTakeover,false);
 const optout=await request('Pare, não me contate mais','id-optout');
 assert.equal(optout.status,200);
 assert.equal(prospectorChatEligible({jid:customer,sessionId:session}),false);
 assert.equal(sends,1);
 // Session boundaries remain immutable across all stages.
 assert.equal(tenantInboundReceiveAllowed({jid:customer,sessionId:'prospector-'+crypto.randomUUID()}),false);
 assert.equal(prospectorChatVisible({jid:customer,sessionId:'prospector-'+crypto.randomUUID()}),false);
 console.log('E2E_TENANT='+JSON.stringify({company,webhookValidated:true,preTrainingSilence:true,
   approvedTraining:true,afterApprovalAiMockReply:sends,humanHandoff:true,
   restoredToAi:true,optoutBlocked:true,externalSends:0,sessionIsolation:true}));
`;

async function runTenant(label) {
 const folder=path.join(home,label.toLowerCase().replace(/\s+/g,'-'));
 const env={...process.env,PROSPECTOR_DATA_DIR:folder,PROSPECTOR_TENANT_ID:crypto.randomUUID(),
  PROSPECTOR_TENANT_NAME:label,PROSPECTOR_TENANT_INTERNAL:'false',
  WA_AKG_WEBHOOK_SECRET:crypto.randomBytes(48).toString('hex'),WA_AKG_API_KEY:'',
  WA_AKG_ADMIN_EMAIL:'',WA_AKG_ADMIN_PASSWORD:'',WA_AKG_SESSION_ID:'',
  GROQ_API_KEY:'simulated-groq-no-network',PROSPECTOR_INBOUND_AUTOREPLY_ENABLED:'true',
  AI_CONVERSATION_AUTOSEND:'true',PROSPECTOR_REPLY_PACING_ENABLED:'false',
  PROSPECTOR_AUTONOMOUS_OUTREACH_OPT_IN:'false',PROSPECTOR_COLD_FIRST_APPROACH:'false',
  PROSPECTOR_AUTO_MAPS_DISCOVERY_ENABLED:'false',TEST_COMPANY:label};
 for(const key of Object.keys(env))if(key.startsWith('RUN_'))delete env[key];
 const proc=spawn(process.execPath,['--input-type=module','-e',fixture],
  {cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
 let out='',err='';
 proc.stdout.on('data',b=>out+=b.toString());
 proc.stderr.on('data',b=>err+=b.toString());
 const status=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{proc.kill('SIGKILL');reject(Error(label+' timed out'))},32000);
  proc.once('close',code=>{clearTimeout(timer);resolve(code)});
  proc.once('error',reject);
 });
 assert.equal(status,0,label+' failed: '+err.slice(0,3800));
 const line=out.split('\n').find(x=>x.startsWith('E2E_TENANT='));
 assert.ok(line,label+' no result: '+out.slice(0,200));
 return JSON.parse(line.slice('E2E_TENANT='.length));
}

test('two isolated tenants support safe inbound, approved AI, human handoff and opt-out',async()=>{
 const a=await runTenant('Oficina Piloto Aurora');
 const b=await runTenant('Clinica Piloto Encanto');
 assert.notEqual(a.company,b.company);
 for(const result of [a,b]){
  assert.equal(result.preTrainingSilence,true);
  assert.equal(result.afterApprovalAiMockReply,1);
  assert.equal(result.externalSends,0);
  assert.equal(result.sessionIsolation,true);
 }
},{timeout:85000});

test('the internal Consecom prospecting-only boundary remains unchanged',()=>{
 const role=fs.readFileSync(new URL('../dashboard/whatsapp-roles.mjs',import.meta.url),'utf8');
 assert.match(role,/tenantInboundEnabled=\(\)=>Boolean\(process\.env\.PROSPECTOR_TENANT_ID\)/);
 assert.match(role,/PROSPECTOR_TENANT_INTERNAL!=='true'/);
});
