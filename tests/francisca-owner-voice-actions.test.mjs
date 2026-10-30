import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/francisca-owner-voice-');
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.PROSPECTOR_OWNER_PHONE='5515981817336';
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.PROSPECTOR_LIVE_TEST_ENABLED='false';
process.env.WA_AKG_CALL_LAB_ENABLED='true';
const actor={jid:'5515981817336@s.whatsapp.net',sessionId:'consecom-principal'};
const other={jid:'5515999112233@s.whatsapp.net',sessionId:'consecom-principal'};
const {runOwnerVoiceTool,voiceToolsForOwner,confirmOwnerVoiceTool}=await import('../dashboard/francisca-owner-voice-actions.mjs');
const {agentTools,runAgentTool,claimApproval,markApproval}=await import('../dashboard/groq-owner-tools.mjs');

test('Verified proprietor can inspect the real tool catalog, prospects and WhatsApp; sandbox cannot use tools',()=>{
 const exposed=voiceToolsForOwner(agentTools,true).map(x=>x.function.name);
 for(const required of ['system_status','list_conversations','read_whatsapp_chat','search_leads','prepare_direct_message','create_lead','update_lead','request_start_outreach'])
  assert(exposed.includes(required),required+' should be discoverable');
 assert.deepEqual(voiceToolsForOwner(agentTools,false),[]);
});
test('Speech stages a mutation and only confirmed authenticated WhatsApp runs it once',async()=>{
 let runs=0;
 const fn=async (name,args)=>{runs++;return {name,args,updated:true}};
 const draft=await runOwnerVoiceTool('update_lead',{lead_id:'lead-test',notes:'anotar progresso'},actor,fn);
 assert.equal(draft.kind,'STAGED');
 assert.equal(draft.requiresConfirmation,true);
 assert.match(draft.code,/^\d{6}$/);
 assert.equal(runs,0);
 await assert.rejects(confirmOwnerVoiceTool(draft.code,other,fn),/UNVERIFIED/);
 assert.equal(runs,0);
 const done=await confirmOwnerVoiceTool(draft.code,actor,fn);
 assert.equal(done.ok,true);
 assert.equal(runs,1);
 assert.equal(done.result.name,'update_lead');
 const replay=await confirmOwnerVoiceTool(draft.code,actor,fn);
 assert.equal(replay,null);
 assert.equal(runs,1);
});
test('Read-only requests can execute during a call while unrecognized names cannot',async()=>{
 let calls=0;
 const mock=async name=>{calls++;return {source:'db',name}};
 const out=await runOwnerVoiceTool('system_diagnostics',{},actor,mock);
 assert.equal(out.kind,'READ');
 assert.equal(out.result.name,'system_diagnostics');
 assert.equal(calls,1);
 await assert.rejects(runOwnerVoiceTool('send_all_contacts',{},actor,mock),/NOT_PERMITTED/);
 await assert.rejects(runOwnerVoiceTool('system_status',{},other,mock),/UNVERIFIED/);
});
test('Individual owner-directed message is only prepared, never sent by the tool',async()=>{
 const number='5515999112244';
 const prepared=await runOwnerVoiceTool('prepare_direct_message',
  {phone:number,text:'Oi, segue a informação que combinamos.'},actor,runAgentTool);
 assert.equal(prepared.kind,'PREPARED');
 assert.equal(prepared.requiresConfirmation,true);
 assert.equal(prepared.result.recipientSuffix,'2244');
 assert.equal(prepared.result.sendMode,'OWNER_ONE_TO_ONE');
 const claimed=claimApproval(prepared.code);
 assert.equal(claimed.jid,number+'@s.whatsapp.net');
 assert.equal(claimed.body,'Oi, segue a informação que combinamos.');
 assert.equal(claimApproval(prepared.code),null);
 markApproval(prepared.code);
});
test('Voice one-off message cannot target owner or a suppressed number',async()=>{
 await assert.rejects(runOwnerVoiceTool('prepare_direct_message',
  {phone:'5515981817336',text:'Self send'},actor,runAgentTool),/próprio/);
});
test('Voice model sees owner operational identity and can request approval without network calls',async()=>{
 const {newFranciscaCallSession}=await import('../dashboard/francisca-call-lab.mjs');
 const pcm=Buffer.alloc(32000);
 const prompts=[],notices=[];
 let rounds=0;
 const session=newFranciscaCallSession(actor,{
  transcribe:async()=>({text:'Manda uma mensagem para o número 15999112255 falando que está tudo certo'}),
  chat:async ({messages,tools})=>{
   prompts.push(messages);
   if(++rounds===1){
    assert(tools.some(t=>t.function.name==='prepare_direct_message'));
    return {choice:{role:'assistant',content:null,tool_calls:[{
     id:'call_1',type:'function',function:{name:'prepare_direct_message',arguments:JSON.stringify({
      phone:'5515999112255',text:'Está tudo certo.'
     })}}]}};
   }
   assert(messages.some(x=>x.role==='tool'&&x.content.includes('confirmationWhatsAppDelivered')));
   return {choice:{content:'Preparei a mensagem para o número terminado em 2255. Envie CONFIRMAR com o código recebido por texto no WhatsApp para efetivar.'}};
  },
  notifyOwnerApproval:async value=>{notices.push(value);return true;},
  readTool:runAgentTool,
  synthesize:async()=>({bytes:Buffer.alloc(512),voice:'test'}),
  convert:async()=>Buffer.alloc(640)
 });
 const response=await session.reply(pcm);
 assert.match(response.spoken,/Preparei a mensagem/);
 assert.equal(notices.length,1);
 assert.match(notices[0].code,/^\d{6}$/);
 assert(prompts[0].some(x=>x.role==='system'&&/OPERACIONAL/.test(x.content)));
 assert(!prompts[0].some(x=>x.role==='system'&&/preço de site|R\$ 550/.test(x.content)));
 assert.equal(rounds,2);
 session.end();
});
test.after(async()=>{
 const {db}=await import('../dashboard/db.mjs');
 db.close();
 fs.rmSync(dir,{recursive:true,force:true});
});
