import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/francisca-live-fix-');
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.PROSPECTOR_OWNER_PHONE='5515981817336';
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.WA_AKG_CALL_LAB_ENABLED='true';
process.env.PROSPECTOR_LIVE_TEST_ENABLED='false';
const owner={jid:'5515981817336@s.whatsapp.net',sessionId:'consecom-principal'};
const {newFranciscaCallSession}=await import('../dashboard/francisca-call-lab.mjs');
const {approachedLeadsSnapshot,readVoiceOperationalBriefing}=await import('../dashboard/groq-owner-tools.mjs');
const {classifyContact}=await import('../dashboard/whatsapp-roles.mjs');

test('Owner approach count reflects confirmed operational rows rather than guessing',()=>{
 const initial=approachedLeadsSnapshot();
 assert(Number.isInteger(initial.approached));
 assert(initial.approached>=0);
 assert(initial.approached<=initial.total);
 const briefing=readVoiceOperationalBriefing(owner);
 assert.equal(briefing.stats.approached,initial.approached);
});
test('Explicitly enabled owner operations overcome QA-only tool disabling for exact owner',()=>{
 process.env.PROSPECTOR_LIVE_TEST_PHONE='5515981817336';
 process.env.PROSPECTOR_LIVE_TEST_ENABLED='true';
 try{
  assert.equal(classifyContact(owner).ownerTools,false);
  assert.equal(classifyContact({...owner,jid:'5515981817337@s.whatsapp.net'}).ownerTools,false);
  process.env.PROSPECTOR_OWNER_OPERATIONS_ENABLED='true';
  assert.equal(classifyContact(owner).ownerTools,true);
  assert.equal(classifyContact({...owner,jid:'5515981817337@s.whatsapp.net'}).ownerTools,false);
 }finally{
  process.env.PROSPECTOR_LIVE_TEST_ENABLED='false';
  delete process.env.PROSPECTOR_LIVE_TEST_PHONE;
  delete process.env.PROSPECTOR_OWNER_OPERATIONS_ENABLED;
 }
});
test('Voice count question gets actual data without calling Groq (including QA mode)',async()=>{
 process.env.PROSPECTOR_LIVE_TEST_PHONE='5515981817336';
 process.env.PROSPECTOR_LIVE_TEST_ENABLED='true';
 let calls=0;
 const session=newFranciscaCallSession(owner,{
  transcribe:async()=>({text:'Quantos leads foram abordados pelo nosso sistema?'}),
  readOperationalBriefing:async()=>({stats:{approached:4,leads:18}}),
  chat:async()=>{calls++;throw Error('Groq should not run for exact count');},
  synthesize:async()=>({bytes:Buffer.alloc(512),voice:'test'}),
  convert:async()=>Buffer.alloc(400)
 });
 try{
  const res=await session.reply(Buffer.alloc(32000));
  assert.match(res.spoken,/4 leads abordados/);
  assert.match(res.spoken,/18 cadastrados/);
  assert.equal(calls,0);
 }finally{session.end();process.env.PROSPECTOR_LIVE_TEST_ENABLED='false';delete process.env.PROSPECTOR_LIVE_TEST_PHONE;}
});
test('Voice requests for messages scope available Groq tools and do not send autonomously',async()=>{
 let toolsChosen=[],text=null;
 const session=newFranciscaCallSession(owner,{
  transcribe:async()=>({text:'Envia uma mensagem pro numero informado falando que está tudo certo'}),
  chat:async({tools})=>{toolsChosen=tools.map(t=>t.function.name);return{choice:{content:'Qual é o número completo do destinatário?'}};},
  synthesize:async x=>{text=x;return {bytes:Buffer.alloc(512)};},
  convert:async()=>Buffer.alloc(400)
 });
 try{
  const res=await session.reply(Buffer.alloc(32000));
  assert(toolsChosen.includes('prepare_direct_message'));
  assert(!toolsChosen.includes('request_start_outreach'));
  assert.match(text,/número completo/);
  assert.match(res.spoken,/número completo/);
 }finally{session.end();}
});
test('A voice model outage is reported accurately without blaming unrecognized caller speech',async()=>{
 const session=newFranciscaCallSession(owner,{
  transcribe:async()=>({text:'Quero saber se meu projeto está sendo vendido'}),
  chat:async()=>{throw Error('GROQ_HTTP_400');},
  synthesize:async()=>({bytes:Buffer.alloc(512)}),convert:async()=>Buffer.alloc(400)
 });
 try{
  const res=await session.reply(Buffer.alloc(32000));
  assert.match(res.spoken,/(?:serviço|sistema|consulta).*?(?:não|instáv|terminou)/i);
  assert.doesNotMatch(res.spoken,/repita a pergunta/i);
 }finally{session.end();}
});
test.after(async()=>{
 const {db}=await import('../dashboard/db.mjs');
 db.close();fs.rmSync(dir,{recursive:true,force:true});
});
