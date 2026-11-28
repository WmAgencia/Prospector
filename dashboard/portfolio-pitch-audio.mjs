// Voice pitch recorded by the Consecom owner for the R$550 portfolio campaign.
// Stored as secret, split environment values on Railway (never in GitHub).
// Original OGG/Opus bytes are verified on each load.
import crypto from 'node:crypto';
import {declinesProposalAudio} from './prospector-sales-signals.mjs';

// Allow only the two verified owner recordings during the rolling asset update.
// The active recording is selected by its configured digest, never by fallback on invalid bytes.
const LEGACY_PITCH_SHA='521cb9a803ef65daf0aa2ff2e918c9a859876577fb56bb9362140bf0a182c019';
const CURRENT_PITCH_SHA='627ebb7c98aea8f5aa3efb59ef6df2eb9e80a8481fd48644f139d3d740c24dc4';
export const PITCH_AUDIO_ORIGINAL_SHA256=process.env.PROSPECTOR_PITCH_AUDIO_SOURCE_SHA256||LEGACY_PITCH_SHA;
export const PITCH_AUDIO_SECONDS=PITCH_AUDIO_ORIGINAL_SHA256===CURRENT_PITCH_SHA?85.5265:102.3665;
export const PITCH_AUDIO_OFFER_BRL=550;
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const normalized=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

export function portfolioPitchAudioEnabled(){
 return process.env.PROSPECTOR_PITCH_AUDIO_ENABLED==='true' &&
  (!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true');
}
export function wantsPortfolioPitchAudio(text=''){
 const s=normalized(text);
 if(!s||s.length>850||declinesProposalAudio(s))return false;
 return /(?:sobre o que|do que se trata|qual (?:e |seria )?(?:a |essa |sua )?(?:proposta|oferta)|que (?:proposta|oferta)|(?:pode|poderia|podia) (?:me )?(?:falar|explicar|contar|mandar)|(?:me )?(?:explica|fala|conte|manda)\b(?: (?:melhor|mais|a proposta|o que))?|o que (?:voces|voce) (?:faz|fazem|oferece|oferecem)|como funciona (?:a |essa |sua )?(?:proposta|oferta))/i.test(s);
}
export function portfolioAudioSentFor(intro){
 return intro?.reason==='PITCH_AUDIO_550'&&
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
 if(![LEGACY_PITCH_SHA,CURRENT_PITCH_SHA].includes(PITCH_AUDIO_ORIGINAL_SHA256)||
  original.length<100000||original.length>2*1024*1024||
  hash(original)!==PITCH_AUDIO_ORIGINAL_SHA256||
  process.env.PROSPECTOR_PITCH_AUDIO_SOURCE_SHA256!==PITCH_AUDIO_ORIGINAL_SHA256)
  throw Error('PITCH_AUDIO_SOURCE_INVALID');
 // Preserve the owner's original WhatsApp OGG/Opus PTT media, without
 // transcoding it to AAC or relabeling it audio/mp4. The WA-AKG endpoint
 // accepts original OGG as a real voice note (ptt=true).
 if(original.toString('ascii',0,4)!=='OggS')throw Error('PITCH_AUDIO_OGG_INVALID');
 return {bytes:original,sourceSha256:PITCH_AUDIO_ORIGINAL_SHA256,
  durationSeconds:PITCH_AUDIO_SECONDS,offerBRL:PITCH_AUDIO_OFFER_BRL};
}

export function portfolioPitchAudioHealth(){
 if(!portfolioPitchAudioEnabled())return {enabled:false,ready:false};
 try{const asset=readPortfolioPitchAudio();return {enabled:true,ready:true,bytes:asset.bytes.length,durationSeconds:asset.durationSeconds,offerBRL:asset.offerBRL};}
 catch(e){return {enabled:true,ready:false,reason:String(e?.message||e).slice(0,100)};}
}
