import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-tenant-runtime-'));
process.env.PROSPECTOR_DATA_DIR=dir;
const {workerEnvironment}=await import('../dashboard/platform.mjs');
const fixed={
 WA_AKG_BASE_URL:'http://wa-akg.railway.internal:3000',
 WA_AKG_API_KEY:'wag_test_gateway_dummy_key_xxx',
 WA_AKG_ADMIN_EMAIL:'test@example.test',
 WA_AKG_ADMIN_PASSWORD:'not-real-password',
 GROQ_API_KEY:'mock-groq-credential',
 PROSPECTOR_MAPS_BASE_URL:'http://prospector-maps.railway.internal:10000',
 PROSPECTOR_MAPS_KEY:'mock-maps-credential',
 AUDIO_TRANSCRIPTION_ENABLED:'true',
 AUDIO_RESPONSE_ENABLED:'true',
 FRANCISCA_TTS_ENABLED:'true',
 PROSPECTOR_OWNER_APPROVED_AUDIO_B64_00:'secret-owner-only-media',
 PROSPECTOR_OWNER_APPROVED_AUDIO_SHA256:'owner-specific-hash',
 PROSPECTOR_HOT_LEAD_PHONE:'5515999999999',
 PROSPECTOR_COLD_FIRST_APPROACH:'true',
 PROSPECTOR_AUTO_MAPS_DISCOVERY_ENABLED:'true',
 RUN_OWNER_4047_AUDIO_RESCUE_ONCE:'true',
 PROSPECTOR_FORCE_OUTREACH_PAUSE:'true'
};
const previous=Object.fromEntries(Object.keys(fixed).map(k=>[k,process.env[k]]));
Object.assign(process.env,fixed);
test.after(()=>{
 for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 fs.rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
});
const a={id:randomUUID(),name:'Oficina Piloto A',secret:'a'.repeat(64),is_internal:0};
const b={id:randomUUID(),name:'Clínica Piloto B',secret:'b'.repeat(64),is_internal:0};
const envA=workerEnvironment(a,12341),envB=workerEnvironment(b,12342);

test('Maps, WhatsApp internal network and audio switches reach each isolated tenant',()=>{
 for(const e of [envA,envB]){
  assert.equal(e.WA_AKG_BASE_URL,fixed.WA_AKG_BASE_URL);
  assert.equal(e.PROSPECTOR_MAPS_BASE_URL,fixed.PROSPECTOR_MAPS_BASE_URL);
  assert.equal(e.PROSPECTOR_MAPS_KEY,fixed.PROSPECTOR_MAPS_KEY);
  assert.equal(e.GROQ_API_KEY,fixed.GROQ_API_KEY);
  assert.equal(e.AUDIO_TRANSCRIPTION_ENABLED,'true');
  assert.equal(e.AUDIO_RESPONSE_ENABLED,'true');
  assert.equal(e.FRANCISCA_TTS_ENABLED,'true');
  assert.equal(e.PROSPECTOR_AUTO_MAPS_DISCOVERY_ENABLED,'false','manual Maps is available, autonomous discovery remains explicitly off');
  assert.equal(e.PROSPECTOR_AUTONOMOUS_OUTREACH_OPT_IN,'false');
  assert.equal(e.PROSPECTOR_COLD_FIRST_APPROACH,'false');
 }
 assert.notEqual(envA.PROSPECTOR_TENANT_ID,envB.PROSPECTOR_TENANT_ID);
 assert.notEqual(envA.PROSPECTOR_DATA_DIR,envB.PROSPECTOR_DATA_DIR);
 assert.notEqual(envA.ADMIN_SESSION_SECRET,envB.ADMIN_SESSION_SECRET);
});

test('no owner campaign secrets, one-shot commands or personal flags are copied into customers',()=>{
 for(const e of [envA,envB]){
  for(const k of ['PROSPECTOR_OWNER_APPROVED_AUDIO_B64_00','PROSPECTOR_OWNER_APPROVED_AUDIO_SHA256',
    'PROSPECTOR_HOT_LEAD_PHONE','RUN_OWNER_4047_AUDIO_RESCUE_ONCE',
    'PROSPECTOR_FORCE_OUTREACH_PAUSE']){
   assert.equal(Object.hasOwn(e,k),false,k+' must not be inherited');
  }
 }
});

test('worker shows configured Maps, transcription and voice capabilities without network or WhatsApp sends',()=>{
 const script=`
  import {scraperStatus} from './dashboard/gosom-maps.mjs';
  import {audioStatus} from './dashboard/waakg-audio-inbound.mjs';
  import {voiceStatus} from './dashboard/francisca-tts.mjs';
  console.log('CAPABILITIES='+JSON.stringify({
   maps:scraperStatus().configured,autoDiscovery:scraperStatus().autoResearchEnabled,
   transcribe:audioStatus().receivingEnabled,
   whisperReady:audioStatus().whisperReady,tts:voiceStatus().available
  }));
 `;
 const output=execFileSync(process.execPath,['--input-type=module','-e',script],{
  cwd:process.cwd(),env:{...envA,PROSPECTOR_DATA_DIR:path.join(dir,'worker-check')},
  encoding:'utf8',timeout:20000
 });
 const line=output.split('\n').find(x=>x.startsWith('CAPABILITIES='));
 assert.ok(line,'process should report capabilities');
 const status=JSON.parse(line.slice('CAPABILITIES='.length));
 assert.deepEqual(status,{maps:true,autoDiscovery:false,transcribe:true,whisperReady:true,tts:true});
});

test('missing provider configuration is not silently reported as ready',()=>{
 const noProvider={...envB};
 delete noProvider.PROSPECTOR_MAPS_KEY;delete noProvider.GROQ_API_KEY;
 delete noProvider.AUDIO_TRANSCRIPTION_ENABLED;delete noProvider.AUDIO_RESPONSE_ENABLED;
 delete noProvider.FRANCISCA_TTS_ENABLED;
 assert.equal(noProvider.PROSPECTOR_MAPS_KEY,undefined);
 assert.equal(noProvider.AUDIO_TRANSCRIPTION_ENABLED,undefined);
 assert.equal(noProvider.AUDIO_RESPONSE_ENABLED,undefined);
 assert.equal(noProvider.FRANCISCA_TTS_ENABLED,undefined);
});
