import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/francisca-prospect-voice-');
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.PROSPECTOR_OWNER_PHONE='5515981817336';
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.WA_AKG_CALL_LAB_ENABLED='true';
process.env.PROSPECTOR_LIVE_TEST_ENABLED='false';
const OWNER={jid:'5515981817336@s.whatsapp.net',sessionId:'consecom-principal'};
const WRONG={jid:'5515999990000@s.whatsapp.net',sessionId:'consecom-principal'};
const {parseVoiceProspecting,newVoiceProspectingFlow}=await import('../dashboard/francisca-voice-prospecting.mjs');
const {newFranciscaCallSession}=await import('../dashboard/francisca-call-lab.mjs');
const ids=['e1111111-1111-4111-8111-111111111111','e2222222-2222-4222-8222-222222222222'];
const leads=ids.map((id,i)=>({id,phone:'551599999000'+i,selectable:true,business:'Clínica '+i}));
function mock({allow=1,searchError=false,large=false}={}){
 const state={searches:[],lists:[],previews:[],queued:[]};
 const records=large?Array.from({length:101},(_,i)=>({id:'e'+String(i).padStart(7,'0')+'-1111-4111-8111-111111111111',phone:'551599999'+String(i).padStart(4,'0'),selectable:true})):leads;
 return {state,
  deps:{
   search:async arg=>{state.searches.push(arg);if(searchError)throw Error('A fonte de pesquisa não respondeu');return {source:'OpenStreetMap',added:2,partial:true};},
   list:arg=>{state.lists.push(arg);return {total:records.length,results:records};},
   preview:({leadIds})=>{state.previews.push(leadIds);return {items:leadIds.map((id,i)=>({id,authorized:i<allow}))};},
   enqueue:arg=>{state.queued.push(arg);return {status:202,body:{queued:arg.leadIds.length,excluded:0}};},
   status:()=>({active:false})
  }
 };
}
test('Extract niche/city from natural Portuguese multi-action request',()=>{
 const p=parseVoiceProspecting('Francisca, pesquisa pra mim dentistas na cidade de Sorocaba e pode selecionar todos e iniciar a abordagem');
 assert.equal(p.wantsSearch,true);
 assert.equal(p.wantsStart,true);
 assert.equal(p.niche,'dentistas');
 assert.equal(p.city,'sorocaba');
 const other=parseVoiceProspecting('Pesquisa oficinas mecânicas em Votorantim');
 assert.equal(other.niche,'oficinas mecanicas');
 assert.equal(other.city,'votorantim');
 assert.equal(other.wantsStart,false);
 assert.equal(parseVoiceProspecting('manda mensagem para o número 15999990000').wantsSearch,false);
});
test('Search chooses permitted contacts only, never queues before spoken confirmation',async()=>{
 const {state,deps}=mock({allow:1});
 const flow=newVoiceProspectingFlow(deps);
 const reply=await flow.turn('Pesquisa pra mim dentistas na cidade de Sorocaba e pode selecionar todos e iniciar a abordagem',OWNER);
 assert.match(reply,/2 empresas cadastradas/);
 assert.match(reply,/1 contatos têm permissão documentada/);
 assert.match(reply,/1 não têm autorização válida/);
 assert.equal(state.searches[0].niche,'dentistas');
 assert.equal(state.searches[0].city,'sorocaba');
 assert.equal(state.queued.length,0);
 const confirmed=await flow.turn('pode iniciar',OWNER);
 assert.match(confirmed,/Fila criada para 1 contatos autorizados/);
 assert.equal(state.queued.length,1);
 assert.deepEqual(state.queued[0],{leadIds:[ids[0]],approve:true});
 assert.equal(flow.state,null);
 assert.equal(state.queued.length,1);
});
test('First search can later accept contextual spoken authorization',async()=>{
 const {state,deps}=mock({allow:2});
 const flow=newVoiceProspectingFlow(deps);
 assert.match(await flow.turn('Pesquisa dentistas em Sorocaba',OWNER),/Diga pode iniciar/);
 assert.equal(state.queued.length,0);
 assert.match(await flow.turn('pode selecionar todos e iniciar a abordagem',OWNER),/Fila criada para 2 contatos/);
 assert.equal(state.queued.length,1);
});
test('No consent means zero enqueue attempts despite owner asking for all',async()=>{
 const {state,deps}=mock({allow:0});
 const flow=newVoiceProspectingFlow(deps);
 const spoken=await flow.turn('Pesquisa dentistas em Sorocaba e inicia a abordagem de todos',OWNER);
 assert.match(spoken,/Nenhuma das 2 empresas selecionáveis tem consentimento/);
 assert.equal(state.queued.length,0);
 assert.equal(flow.state,null);
 assert.equal(await flow.turn('pode iniciar',OWNER),null);
});
test('An error fetching fresh data falls back to stored leads and reports source failure',async()=>{
 const {state,deps}=mock({allow:1,searchError:true});
 const flow=newVoiceProspectingFlow(deps);
 const spoken=await flow.turn('Pesquisa dentistas em Sorocaba e inicia abordagem',OWNER);
 assert.match(spoken,/busca externa falhou/i);
 assert.match(spoken,/contatos já salvos/i);
 assert.equal(state.queued.length,0);
});
test('Cannot silently truncate selecting more than one hundred leads',async()=>{
 const {state,deps}=mock({large:true});
 const flow=newVoiceProspectingFlow(deps);
 const spoken=await flow.turn('Pesquisa dentistas em Sorocaba e inicia abordagem',OWNER);
 assert.match(spoken,/mais de cem contatos/);
 assert.equal(state.previews.length,0);
 assert.equal(state.queued.length,0);
});
test('A wrong contact or a cancelled/expired request cannot start the queue',async()=>{
 const {state,deps}=mock({allow:1});
 const flow=newVoiceProspectingFlow(deps);
 assert.equal(await flow.turn('Pesquisa dentistas em Sorocaba',WRONG),null);
 assert.equal(state.searches.length,0);
 await flow.turn('Pesquisa dentistas em Sorocaba',OWNER);
 assert.match(await flow.turn('cancela',OWNER),/cancelei/);
 assert.equal(await flow.turn('pode iniciar',OWNER),null);
 assert.equal(state.queued.length,0);
});
test('Active approach queue blocks opening a duplicate queue',async()=>{
 const {state,deps}=mock({allow:1});
 deps.status=()=>({active:true});
 const flow=newVoiceProspectingFlow(deps);
 await flow.turn('Pesquisa dentistas em Sorocaba e inicia abordagem',OWNER);
 assert.match(await flow.turn('pode iniciar',OWNER),/Já existe uma fila/);
 assert.equal(state.queued.length,0);
});
test('Verified owner call uses prospecting tools without Groq and does not send WhatsApp messages itself',async()=>{
 const {state,deps}=mock({allow:1});
 const spoken=['Francisca, pesquisa pra mim dentistas na cidade de Sorocaba e pode selecionar todos e iniciar a abordagem','pode iniciar'];
 let groqCalls=0,manualSends=0;
 const session=newFranciscaCallSession(OWNER,{
  transcribe:async()=>({text:spoken.shift()}),
  searchProspects:deps.search,listProspects:deps.list,previewProspects:deps.preview,
  enqueueApproaches:deps.enqueue,approachQueueStatus:deps.status,
  sendDirectMessage:async()=>{manualSends++;throw Error('MUST_NOT_SEND_DIRECT');},
  chat:async()=>{groqCalls++;throw Error('GROQ_MUST_NOT_RUN');},
  synthesize:async()=>({bytes:Buffer.alloc(512),voice:'test'}),
  convert:async()=>Buffer.alloc(640)
 });
 try{
  const first=await session.reply(Buffer.alloc(32000));
  assert.match(first.spoken,/dentistas em sorocaba/);
  const second=await session.reply(Buffer.alloc(32000));
  assert.match(second.spoken,/Fila criada/);
  assert.equal(state.queued.length,1);
  assert.equal(groqCalls,0);
  assert.equal(manualSends,0);
 }finally{session.end();}
});
test.after(async()=>{const {db}=await import('../dashboard/db.mjs');db.close();fs.rmSync(dir,{recursive:true,force:true});});
