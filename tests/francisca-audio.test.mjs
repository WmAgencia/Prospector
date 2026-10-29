import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=await mkdtemp(path.join(os.tmpdir(),'francisca-test-'));
process.env.WA_AKG_SESSION_ID='consecom-principal';
const db=await import('../dashboard/db.mjs');
const {safeMediaPath,fetchPrivateAudio,sendVoiceMedia}=await import('../dashboard/waakg-media.mjs');
const {transcribeAudio,queueInboundAudio,processAudioJobs,audioStatus}=await import('../dashboard/waakg-audio-inbound.mjs');
const {recordInboundTranscript}=await import('../dashboard/waakg-bridge.mjs');
const {makeFranciscaVoice,voiceStatus,checkVoiceText}=await import('../dashboard/francisca-tts.mjs');
const {voicePreview,sendApprovedVoice}=await import('../dashboard/waakg-audio-outbound.mjs');
const original={tts:process.env.FRANCISCA_TTS_ENABLED,groq:process.env.GROQ_API_KEY};
const jid='5515999112233@s.whatsapp.net',providerId='consecom-principal:ABC123456',fileUrl='/api/media/consecom-principal-ABC123456.ogg';
test('Never fetch arbitrary media URLs or private IPs',()=>{
 assert.equal(safeMediaPath(fileUrl),fileUrl);
 for(const bad of ['https://evil.example.com/foo.ogg','/api/media/../../secret.wav','//foo','/api/media/a.mp3?token=x','/api/media/a.txt'])
  assert.equal(safeMediaPath(bad),null);
});
test('WA-AKG media fetch is authenticated, bounded, and returns binary',async()=>{
 const mock=async(url,opts)=>{
  assert.match(url,/wa-akg-production.*\/api\/media\/consecom-principal-ABC123456\.ogg/);
  assert.equal(opts.headers['X-API-Key'],'mock-key');
  return new Response(Buffer.concat([Buffer.from('OggS'),Buffer.alloc(180)]),{headers:{'content-type':'audio/ogg'}});
 };
 const out=await fetchPrivateAudio(fileUrl,{session:'consecom-principal',apiKey:'mock-key',fetchFn:mock});
 assert.equal(out.buffer.length,184);
 await assert.rejects(fetchPrivateAudio(fileUrl,{session:'consecom-principal',apiKey:'mock-key',fetchFn:async()=>new Response(Buffer.alloc(200),{headers:{'content-length':String(20_000_000)}})}),/AUDIO_TOO_LARGE/);
});
test('Groq Whisper receives Portuguese audio as private multipart body without a translation request',async()=>{
 process.env.GROQ_API_KEY='test-key';
 const fake=async(url,opts)=>{
  assert.equal(url,'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.equal(opts.headers.Authorization,'Bearer test-key');
  assert.equal(opts.body.get('model'),'whisper-large-v3-turbo');
  assert.equal(opts.body.get('language'),'pt');
  assert.equal(opts.body.get('file').name,'clip.ogg');
  return Response.json({text:'Olá, quero saber mais sobre o site.'});
 };
 const data=await transcribeAudio({buffer:Buffer.alloc(520),filename:'clip.ogg',fetchFn:fake});
 assert.match(data.text,/quero saber mais/);
 const company=await transcribeAudio({buffer:Buffer.alloc(520),filename:'clip.ogg',
  fetchFn:async()=>Response.json({text:'Aqui é a Francisca da Concecom Brasil.'})});
 assert.match(company.text,/Consecom Brasil/);
 assert.equal(company.text.includes('Concecom'),false);
});
test('Audio webhook job creates exactly one transcription in the existing customer inbox',async()=>{
 const a=queueInboundAudio({providerId,sessionId:'consecom-principal',jid,fileUrl});
 assert.equal(a.queued,true);
 assert.equal(queueInboundAudio({providerId,sessionId:'consecom-principal',jid,fileUrl}).queued,false);
 const done=await processAudioJobs({download:async()=>({buffer:Buffer.alloc(600),filename:'inbound.ogg'}),
  transcribe:async()=>({text:'Olá, gostaria de saber mais sobre o serviço.',model:'mock-whisper'}),
  deliver:recordInboundTranscript});
 assert.equal(done.status,'DONE');
 assert.equal(audioStatus().transcribed,1);
 assert.equal(db.one('SELECT COUNT(*) n FROM waakg_inbox WHERE provider_id=?',providerId).n,1);
 const lead=db.one('SELECT id,phone FROM leads WHERE phone=?','5515999112233');
 const thread=db.one('SELECT id FROM threads WHERE lead_id=?',lead.id);
 assert.match(db.one("SELECT body FROM messages WHERE thread_id=? AND direction='in'",thread.id).body,/gostaria de saber mais/);
 assert.equal(db.one('SELECT COUNT(*) n FROM messages WHERE thread_id=? AND direction=\'in\'',thread.id).n,1);
});
test('Transcription failures enter REVIEW rather than inventing a reply',async()=>{
 const other='consecom-principal:DEF12345';
 queueInboundAudio({providerId:other,sessionId:'consecom-principal',jid,fileUrl});
 const r=await processAudioJobs({download:async()=>{throw Error('MEDIA_HTTP_404');},deliver:recordInboundTranscript});
 assert.equal(r.status,'REVIEW');
 assert.equal(db.one('SELECT state FROM inbound_audio_jobs WHERE provider_id=?',other).state,'REVIEW');
});
test('Francisca is fixed to Brazilian pt-BR and never executes text as shell',async()=>{
 process.env.FRANCISCA_TTS_ENABLED='true';
 assert.equal(voiceStatus().voice,'pt-BR-FranciscaNeural');
 assert.throws(()=>checkVoiceText(''),/VOICE_TEXT_LENGTH/);
 assert.throws(()=>checkVoiceText('x'.repeat(700)),/VOICE_TEXT_LENGTH/);
 const commands=[];
 const rendered=await makeFranciscaVoice('Olá! Como posso ajudar?',{exec:async(cmd,args)=>{
  commands.push([cmd,args]);
  if(cmd.includes('edge-tts'))await writeFile(args[args.indexOf('--write-media')+1],Buffer.alloc(640));
  if(cmd==='ffmpeg')await writeFile(args.at(-1),Buffer.alloc(670));
 }});
 assert.equal(rendered.bytes.length,670);
 assert.ok(commands[0][1].includes('pt-BR-FranciscaNeural'));
 assert.ok(commands[0][1].includes('--rate=-3%'));
 assert.ok(commands[1][1].includes('aac'));
});
test('Gateway receives voice via multipart type=voice, not a JSON text send',async()=>{
 const sent=await sendVoiceMedia({jid,session:'consecom-principal',bytes:Buffer.alloc(560),apiKey:'test-key',fetchFn:async(url,opts)=>{
  assert.match(url,/\/api\/messages\/consecom-principal\/5515999112233%40s.whatsapp.net\/media$/);
  assert.equal(opts.body.get('type'),'voice');
  assert.equal(opts.body.get('file').type,'audio/mp4');
  return Response.json({status:true});
 }});
 assert.equal(sent.accepted,true);
 assert.equal(sent.verifiedOnPhone,false);
});
test('Manual WhatsApp voice requires approval and will never double-send',async()=>{
 const number='5515999112233',requestId='77777777-7777-4777-8777-777777777777';
 const invalid=await sendApprovedVoice({jid,text:'Olá, como vai?',requestId,approve:false});
 assert.equal(invalid.status,400);
 let calls=0;
 const deps={status:async()=>({connected:true,sessionId:'consecom-principal'}),
  synthesize:async()=>({bytes:Buffer.alloc(500)}),send:async()=>{calls++;return {accepted:true}}};
 const ok=await sendApprovedVoice({jid,text:'Olá, como vai?',requestId,approve:true},deps);
 assert.equal(ok.status,200);
 assert.equal(calls,1);
 assert.equal((await sendApprovedVoice({jid,text:'Olá, como vai?',requestId,approve:true},deps)).status,409);
 assert.equal(calls,1);
 assert.equal(db.one('SELECT stage FROM leads WHERE phone=?',number).stage,'CONVERSING');
});
test.after(async()=>{
 for(const [k,v] of Object.entries(original)){const name=k==='tts'?'FRANCISCA_TTS_ENABLED':'GROQ_API_KEY';if(v===undefined)delete process.env[name];else process.env[name]=v;}
 db.db.close();await rm(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});
});
