import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/groq-channels-live-');
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.GROQ_API_KEY='mock';
const settings=['PROSPECTOR_LIVE_TEST_ENABLED','PROSPECTOR_LIVE_TEST_PHONE','AUDIO_RESPONSE_ENABLED','FRANCISCA_TTS_ENABLED','AI_CONVERSATION_AUTOSEND','PROSPECTOR_INBOUND_AUTOREPLY_ENABLED','PROSPECTOR_INTEREST_ALERTS_ENABLED'];
const saved=Object.fromEntries(settings.map(k=>[k,process.env[k]]));
Object.assign(process.env,{PROSPECTOR_LIVE_TEST_ENABLED:'true',PROSPECTOR_LIVE_TEST_PHONE:'5515981817336',
 AUDIO_RESPONSE_ENABLED:'true',FRANCISCA_TTS_ENABLED:'true',
 AI_CONVERSATION_AUTOSEND:'false',PROSPECTOR_INBOUND_AUTOREPLY_ENABLED:'false',PROSPECTOR_INTEREST_ALERTS_ENABLED:'false'});
const db=await import('../dashboard/db.mjs');
const bridge=await import('../dashboard/waakg-bridge.mjs');
const bot=await import('../dashboard/groq-sales-automation.mjs');
const {channelPreference,partsFor}=await import('../dashboard/groq-reply-channels.mjs');
let counter=0;
async function receive(text,{phone='5515981817336',audio=false}={}){
 counter++;
 const id='consecom-principal:CHANNEL'+String(counter).padStart(8,'0');
 const jid=phone+'@s.whatsapp.net';
 const res=bridge.recordInboundTranscript({sessionId:'consecom-principal',jid,unique:id,content:text,source:audio?'AUDIO':'TEXT'});
 assert.equal(res.body.processed,true);
 if(audio)db.run("INSERT INTO inbound_audio_jobs(provider_id,session_id,jid,media_path,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  id,'consecom-principal',jid,'/api/media/consecom-principal-CHANNEL'+String(counter).padStart(8,'0')+'.ogg',
  'DONE',db.now(),db.now());
 return {id,jid};
}
const output=[];
async function respond({draft='Claro! Posso explicar melhor o serviço.',failVoice=false}={}){
 const before=output.length;
 const result=await bot.tickSalesAgent({
  status:async()=>({connected:true,sessionId:'consecom-principal'}),
  qualify:async()=>({confirmed:false,reason:'NOT_CONCRETE'}),
  draft:async()=>({ok:true,draft}),
  voice:async()=>({bytes:Buffer.alloc(1200)}),
  send:async(path,payload)=>{output.push({type:'TEXT',path,text:payload.data.message.text});return {status:true};},
  sendVoice:async({jid})=>{output.push({type:'VOICE',jid});if(failVoice)throw Error('NETWORK_TIMEOUT');return {accepted:true};}
 });
 return {result,parts:output.slice(before)};
}
test('Explicit text from an audio message sends ONLY a written reply to 7336',async()=>{
 const turn=await receive('Francisca, me responde só por texto, não em áudio.',{audio:true});
 const out=await respond({draft:'Claro, vou responder por escrito.'});
 assert.deepEqual(out.result.states,['SENT']);
 assert.deepEqual(out.parts.map(x=>x.type),['TEXT']);
 assert.equal(channelPreference(turn.jid),null,'one-time preference must not persist');
 assert.match(partsFor(turn.id),/TEXT:ACCEPTED/);
});
test('Spoken request for a report triggers text followed by Francisca audio',async()=>{
 const turn=await receive('Me explica um relatório de desempenho das campanhas.',{audio:true});
 const out=await respond({draft:'O relatório mostra as visitas e os resultados acompanhados.'});
 assert.deepEqual(out.result.states,['SENT']);
 assert.deepEqual(out.parts.map(x=>x.type),['TEXT','VOICE']);
 assert.match(partsFor(turn.id),/VOICE:ACCEPTED/);
});
test('Formal urgent client request is TEXT, not VOICE',async()=>{
 await receive('O cliente precisa de você agora. Telefone dele: 15999992222.',{audio:true});
 const out=await respond({draft:'Um cliente solicitou sua presença. Confira o número informado no atendimento.'});
 assert.deepEqual(out.parts.map(x=>x.type),['TEXT']);
});
test('Persistent text-only request controls later audio messages in same conversation',async()=>{
 const initial=await receive('A partir de agora, responda só por texto.',{audio:true});
 const first=await respond({draft:'Combinado, daqui para frente vou responder por texto.'});
 assert.deepEqual(first.parts.map(x=>x.type),['TEXT']);
 assert.equal(channelPreference(initial.jid),'TEXT');
 await receive('Oi!',{audio:true});
 const second=await respond();
 assert.deepEqual(second.parts.map(x=>x.type),['TEXT']);
});
test('One-time voice request overrides saved text preference for the current turn',async()=>{
 await receive('Por favor manda em áudio dessa vez, sem texto.',{audio:false});
 const response=await respond();
 assert.deepEqual(response.parts.map(x=>x.type),['VOICE']);
 assert.equal(channelPreference('5515981817336@s.whatsapp.net'),'TEXT');
});
test('Dual-delivery network uncertainty never retries the written part',async()=>{
 const turn=await receive('Me explica o relatório resumido.',{audio:true});
 const first=await respond({draft:'O relatório está atualizado para consulta.',failVoice:true});
 assert.deepEqual(first.parts.map(x=>x.type),['TEXT','VOICE']);
 assert.deepEqual(first.result.states,['PARTIAL']);
 assert.match(partsFor(turn.id),/TEXT:ACCEPTED/);
 assert.match(partsFor(turn.id),/VOICE:UNKNOWN/);
 const again=await respond({draft:'O relatório está atualizado.'});
 assert.equal(again.result.processed,0);
 assert.equal(again.parts.length,0);
});
test('No other phone receives an automatic response in the isolated test',async()=>{
 await receive('Oi, pode me ajudar?',{phone:'5515999111111'});
 const out=await respond();
 assert.equal(out.result.processed,0);
 assert.equal(out.parts.length,0);
});
test.after(()=>{
 for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});
});
