// Voice pitch recorded by the Consecom owner for the R$350 portfolio campaign.
// Stored as secret, split environment values on Railway (never in GitHub).
// A restart reuses a private cached AAC file on the Railway volume.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

export const PITCH_AUDIO_ORIGINAL_SHA256='82c1044e8d25413f4e4f4fee347639c3f7802927ddf774666c656b15b340f7a1';
export const PITCH_AUDIO_SECONDS=99.5;
export const PITCH_AUDIO_OFFER_BRL=350;
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const normalized=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

export function portfolioPitchAudioEnabled(){
 return process.env.PROSPECTOR_PITCH_AUDIO_ENABLED==='true' &&
  (!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true');
}
export function wantsPortfolioPitchAudio(text=''){
 const s=normalized(text);
 if(!s||s.length>850)return false;
 if(/(?:que|qual) (?:e |seria )?(?:o )?tipo de (?:proposta|oferta)|(?:proposta|oferta) de (?:que|qual) tipo|o que (?:e|seria) (?:a |essa |sua )?proposta|como assim (?:essa |a )?proposta|(?:que|qual) (?:e |seria )?(?:essa |a |sua )?(?:ideia|proposta))/i.test(s))return true;
 return /(?:sobre o que|do que se trata|qual (?:e |seria )?(?:a |essa |sua )?(?:proposta|oferta)|que (?:proposta|oferta)|(?:pode|poderia|podia) (?:me )?(?:falar|explicar|contar|mandar)|(?:me )?(?:explica|fala|conte|manda)(?: (?:melhor|mais|a proposta|o que))?|o que (?:voces|voce) (?:faz|fazem|oferece|oferecem)|como funciona (?:a |essa |sua )?(?:proposta|oferta))/i.test(s);
}
export function acceptsPortfolioPresentation(text=''){
 const s=normalized(text).replace(/[.!?]+$/g,'').trim();
 if(!s||s.length>110||/(?:nao|sem interesse|depois|prefiro texto)/.test(s))return false;
 return /^(?:perfeito|beleza|claro|pode ser|certo|ok|okay|sim|pode falar|pode mandar|manda|pode enviar|me manda|pode explicar|tudo certo|combinado)(?:[ ,.!?].*)?$/.test(s);
}
export function portfolioAudioSentFor(intro){
 return intro?.reason==='PITCH_AUDIO_350'&&
  ['VOICE_SENT','CONVERSING'].includes(intro.stage);
}
export function readPortfolioPitchAudio(){
 if(!portfolioPitchAudioEnabled())throw Error('PITCH_AUDIO_NOT_ENABLED');
 const parts=Number(process.env.PROSPECTOR_PITCH_AUDIO_PARTS);
 if(!Number.isInteger(parts)||parts<1||parts>48)throw Error('PITCH_AUDIO_PARTS_NOT_CONFIGURED');
 const values=Array.from({length:parts},(_,i)=>process.env['PROSPECTOR_PITCH_AUDIO_B64_'+String(i).padStart(2,'0')]);
 if(values.some(x=>!x||!/^[A-Za-z0-9+/=]+$/.test(x)))throw Error('PITCH_AUDIO_PART_MISSING');
 const encoded=values.join('');
 const original=Buffer.from(encoded,'base64');
 if(original.length<100000||original.length>2*1024*1024||
  hash(original)!==PITCH_AUDIO_ORIGINAL_SHA256||
  process.env.PROSPECTOR_PITCH_AUDIO_SOURCE_SHA256!==PITCH_AUDIO_ORIGINAL_SHA256)
  throw Error('PITCH_AUDIO_SOURCE_INVALID');
 const root=path.resolve(process.env.PROSPECTOR_DATA_DIR||'data','private-portfolio-voice');
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const target=path.join(root,'portfolio-350-'+PITCH_AUDIO_ORIGINAL_SHA256.slice(0,12)+'.m4a');
 let cached=false;
 try{const size=fs.statSync(target).size;cached=size>200000&&size<3*1024*1024;}catch{}
 if(!cached){
  const tmp=target+'.'+process.pid+'.tmp';
  try{
   const execution=spawnSync('ffmpeg',[
    '-nostdin','-hide_banner','-loglevel','error','-y','-f','ogg','-i','pipe:0',
    '-vn','-map_metadata','-1','-ac','1','-ar','44100','-c:a','aac','-b:a','32k',
    '-movflags','+faststart','-f','ipod',tmp
   ],{input:original,timeout:30000,maxBuffer:1048576});
   if(execution.error||execution.status!==0)throw Error('PITCH_AUDIO_TRANSCODE_FAILED');
   const size=fs.statSync(tmp).size;
   if(size<200000||size>3*1024*1024)throw Error('PITCH_AUDIO_OUTPUT_INVALID');
   fs.chmodSync(tmp,0o600);
   fs.renameSync(tmp,target);
  }catch(error){try{fs.unlinkSync(tmp);}catch{}throw error;}
 }
 const bytes=fs.readFileSync(target);
 if(bytes.length<200000||bytes.length>3*1024*1024)throw Error('PITCH_AUDIO_INVALID_CACHE');
 return {bytes,sourceSha256:PITCH_AUDIO_ORIGINAL_SHA256,durationSeconds:PITCH_AUDIO_SECONDS,offerBRL:350};
}
export function portfolioPitchAudioHealth(){
 if(!portfolioPitchAudioEnabled())return {enabled:false,ready:false};
 try{const asset=readPortfolioPitchAudio();return {enabled:true,ready:true,bytes:asset.bytes.length,durationSeconds:asset.durationSeconds,offerBRL:asset.offerBRL};}
 catch(e){return {enabled:true,ready:false,reason:String(e?.message||e).slice(0,100)};}
}
