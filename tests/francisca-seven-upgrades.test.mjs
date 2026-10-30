import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/francisca-seven-');
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.PROSPECTOR_OWNER_PHONE='5515981817336';
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.WA_AKG_CALL_LAB_ENABLED='true';
process.env.PROSPECTOR_LIVE_TEST_ENABLED='false';
const actor={jid:'5515981817336@s.whatsapp.net',sessionId:'consecom-principal'};
const wrong={jid:'5515999990000@s.whatsapp.net',sessionId:'consecom-principal'};
const {semanticTurnAssessment,newSemanticTurnBuffer}=await import('../dashboard/francisca-semantic-turn.mjs');
const {splitSpeech,synthesizeSpeechChunks}=await import('../dashboard/francisca-speech-chunks.mjs');
const {recordVoiceMetrics,voiceMetricsSummary,voiceMetricsSpoken}=await import('../dashboard/francisca-call-observability.mjs');
const {ownerMemoryCommand,rememberCallTopic,recentOwnerMemory}=await import('../dashboard/francisca-owner-memory.mjs');
const {chooseVoiceWorkflow,runVoiceReadWorkflow}=await import('../dashboard/francisca-voice-orchestrator.mjs');
const {newFranciscaCallSession}=await import('../dashboard/francisca-call-lab.mjs');
const {VoiceAudioConditioner}=await import('../waakg-voice/audio-conditioning.mjs');
const {db}=await import('../dashboard/db.mjs');
const pcm=Buffer.alloc(32000);
const synthesized=async()=>({pcm16k:Buffer.alloc(640),voice:'test'});

test('Semantic turn buffer recognizes incomplete and finished Portuguese turns without LLM',()=>{
 assert.equal(semanticTurnAssessment('Eu quero que').incomplete,true);
 assert.equal(semanticTurnAssessment('Eu vou explicar o seguinte').incomplete,true);
 assert.equal(semanticTurnAssessment('Qual é o status dos meus leads').incomplete,false);
 assert.equal(semanticTurnAssessment('Pode enviar?').incomplete,false);
 const q=newSemanticTurnBuffer();
 assert.equal(q.take('Eu quero que',{now:0}).hold,true);
 assert.deepEqual(q.take('você explique o funil de leads',{now:1000}),{hold:false,text:'Eu quero que você explique o funil de leads'});
 assert.equal(q.pending,0);
 const t=newSemanticTurnBuffer({maxWaitMs:200});
 assert.equal(t.take('Eu quero que',{now:100}).hold,true);
 assert.equal(t.take('me explique o que ocorreu',{now:1000}).text,'me explique o que ocorreu');
});
test('Chunked speech preserves all text and delivers ordered PCM increments',async()=>{
 const input='Primeiro apresento os dados da campanha. Depois verifico a fila e os contatos. Em seguida, mostro as métricas.';
 const parts=splitSpeech(input,{maxChars:42,maxSegments:5});
 assert.equal(parts.join(' '),input);
 assert(parts.length>=2);
 let send=[],synth=[];
 const x=await synthesizeSpeechChunks(input,{maxSegments:4,maxChars:42,synthesize:async(t,i)=>{synth.push({t,i});return {pcm16k:Buffer.alloc(3200,i)};},
  onSegment:async x=>send.push({index:x.index,total:x.total,length:x.pcm16k.length})});
 assert.equal(send.length,x.segments);
 assert.equal(x.pcm16k.length,x.segments*3200);
 assert.deepEqual(send.map(x=>x.index),send.map((_,i)=>i));
 assert(synth.length>1);
 await assert.rejects(synthesizeSpeechChunks('oi',{synthesize:async()=>({pcm16k:Buffer.alloc(3)})}),/CHUNK_PCM_INVALID/);
});
test('Memory is owner-only, deliberate, privacy-filtered and resumable',()=>{
 assert.equal(ownerMemoryCommand('anota que estudar o desempenho da campanha',wrong),null);
 assert.equal(ownerMemoryCommand('anota que minha senha é abcdefgh',actor).includes('Só posso'),true);
 assert.equal(ownerMemoryCommand('anota que o contato é 15999992244',actor).includes('Só posso'),true);
 assert.match(ownerMemoryCommand('anota que quero revisar o funil de leads',actor),/Anotado/);
 assert.match(recentOwnerMemory(actor),/funil de leads/);
 assert.match(ownerMemoryCommand('quais as minhas memórias',actor),/funil de leads/);
 assert.match(ownerMemoryCommand('onde paramos na última ligação',actor),/assunto anotado/);
 rememberCallTopic('analise as campanhas do mês',actor);
 assert.match(recentOwnerMemory(actor),/campanhas/);
 assert.match(ownerMemoryCommand('apaga minhas anotações',actor),/Apaguei/);
 assert.equal(recentOwnerMemory(actor),'');
});
test('Diagnostic records only time and aggregate counters, no transcripts',()=>{
 recordVoiceMetrics({callId:'call_private',sttMs:120,llmMs:300,ttsMs:420,totalMs:840,segments:3,interrupted:true,uncertain:true,toolCalls:2});
 const stats=voiceMetricsSummary();
 assert(stats.turns>=1);assert(stats.avgMs>0);assert(stats.interruptions>=1);
 assert.match(voiceMetricsSpoken(),/Tempo médio total/);
 const columns=Object.keys(db.prepare('SELECT * FROM francisca_call_metrics LIMIT 1').get());
 assert(!columns.some(x=>/phone|transcript|message|audio|pcm|jid|text/.test(x)));
});
test('Read-only workflow allows known tools, caps steps and reports partial failures',async()=>{
 const tools=['system_status','system_diagnostics','read_outreach_queue'].map(name=>({function:{name}}));
 const plan=chooseVoiceWorkflow('Me dá um relatório geral do sistema',tools);
 assert.deepEqual(plan,['system_status','system_diagnostics','read_outreach_queue']);
 let invoked=[];
 const result=await runVoiceReadWorkflow(plan,{actor,execute:async name=>{invoked.push(name);if(name==='system_diagnostics')throw Error('UNAVAILABLE');return {ok:true,total:3};}});
 assert.equal(result.complete,false);assert.equal(result.steps.length,3);
 assert.deepEqual(invoked,plan);
 await assert.rejects(runVoiceReadWorkflow(['request_start_outreach'],{execute:async()=>{throw Error('WRONG');}}),/WRITE_FORBIDDEN/);
 await assert.rejects(runVoiceReadWorkflow(['system_status','system_status','system_status','system_status'],{}),/LIMIT/);
});
test('Conservative acoustic conditioner removes silence and playback echo without dropping speech',()=>{
 const c=new VoiceAudioConditioner();
 const silent=c.process(new Float32Array(320).fill(.001));
 assert(silent.frame.every(x=>x===0));
 const ref=new Float32Array(320);
 for(let i=0;i<ref.length;i++)ref[i]=Math.sin(i*.31)*.20;
 c.rememberPlayback(ref);
 const echo=c.process(new Float32Array(ref),{playing:true});
 assert.equal(echo.echo,true);assert(echo.frame.every(x=>x===0));
 const caller=new Float32Array(320);
 for(let i=0;i<caller.length;i++)caller[i]=Math.sin(i*.51)*.07;
 const separate=c.process(caller,{playing:true});
 assert.equal(separate.echo,false);
 assert(separate.frame.some(x=>x!==0));
});
test('Owner call emits sequential streamed PCM segments before turn resolution',async()=>{
 let segments=[],spoken=[],responses=0;
 const reply='Aqui está um resumo dos resultados. A primeira informação é relevante para analisar o comportamento das campanhas e identificar melhorias possíveis. A segunda informação ajuda a compreender a próxima etapa e organizar os leads que já responderam.';
 const c=newFranciscaCallSession(actor,{transcribe:async()=>({text:'Me explica como funciona o nosso sistema'}),chat:async()=>{responses++;return {choice:{content:reply}};},
  synthesizePcm:async text=>{spoken.push(text);return {pcm16k:Buffer.alloc(3200),voice:'test'};}});
 try{
  const result=await c.reply(pcm,{onSegment:async segment=>segments.push(segment)});
  assert(segments.length>1);
  assert.equal(result.pcm16k.length,segments.length*3200);
  assert(segments.every((x,i)=>x.index===i&&x.replyId===result.replyId));
  assert.equal(responses,1);
  assert.equal(spoken.join(' '),reply);
 }finally{c.end();}
});
test('Semantic incomplete user command never executes owner tool or sends before next turn',async()=>{
 let sends=0,calls=0;
 const transcribed=['Eu quero que','você explique as campanhas'];
 const c=newFranciscaCallSession(actor,{transcribe:async()=>({text:transcribed.shift()}),
  sendDirectMessage:async()=>{sends++;throw Error('SHOULD_NOT_SEND');},
  chat:async()=>{calls++;return {choice:{content:'As campanhas estão em pausa por enquanto.'}};},synthesizePcm:synthesized});
 try{
  const first=await c.reply(pcm);
  assert.match(first.spoken,/Pode continuar/);
  assert.equal(calls,0);
  const second=await c.reply(pcm);
  assert.match(second.spoken,/campanhas/);
  assert.equal(calls,1);assert.equal(sends,0);
 }finally{c.end();}
});
test.after(async()=>{const {db}=await import('../dashboard/db.mjs');db.close();fs.rmSync(dir,{recursive:true,force:true});});
