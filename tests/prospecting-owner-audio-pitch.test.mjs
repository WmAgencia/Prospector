import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-owner-audio-'));
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.PROSPECTOR_PITCH_AUDIO_ENABLED='true';
process.env.PROSPECTOR_TEST_CONTACT_PHONE='5515981817336';
process.env.PROSPECTOR_REQUIRE_DOCUMENTED_OPTIN='true';
const db=await import('../dashboard/db.mjs');
const {registerGreeting,routeIntroductionReply,introductionStatus,tickIntroductions}=await import('../dashboard/prospecting-introduction.mjs');
const {wantsPortfolioPitchAudio,portfolioAudioSentFor,portfolioPitchAudioHealth}=await import('../dashboard/portfolio-pitch-audio.mjs');
let idNum=1000;
function addAuthorized(){
 const phone='55159987'+String(idNum++).padStart(4,'0');
 const lead=db.addLead({business:'Empresa autorizada teste',phone,source:'maps_extension',contact_permission:true}).lead;
 db.audit('CONSENT_UPDATED',lead.id,{permitted:true,evidence:'Opt-in aprovado pelo responsável em ambiente de testes'});
 const jid=lead.phone+'@s.whatsapp.net',greetingId=db.id();
 const thread=db.getThread(lead.id,jid);
 db.addMessage({threadId:thread.id,providerId:'prospect-queue:'+greetingId,
  direction:'out',body:'Olá, bom dia! Tudo bem?',status:'sent'});
 assert.equal(registerGreeting({leadId:lead.id,greetingId,sessionId:'consecom-principal'}),true);
 return {lead,jid,greetingId,thread};
}
test('phrases asking for the offer choose voice; generic greetings do not',()=>{
 assert.equal(wantsPortfolioPitchAudio('Oi, pode falar. É sobre o quê?'),true);
 assert.equal(wantsPortfolioPitchAudio('Pode explicar melhor essa proposta?'),true);
 assert.equal(wantsPortfolioPitchAudio('Oi, tudo bem?'),false);
 assert.equal(wantsPortfolioPitchAudio('Não tenho interesse'),false);
});
test('first reply delivers Wesley permission question; second affirmative delivers only original audio, once',async()=>{
 const {lead,jid}=addAuthorized();
 const when=new Date(Date.now()-42000);
 const first=routeIntroductionReply({leadId:lead.id,providerId:'inbound-1',body:'Oi, pode falar. É sobre o quê?',receivedAt:when});
 assert.equal(first.state,'WAITING');assert.equal(first.queueAi,false);
 let textCount=0,voiceCount=0;
 const text=await tickIntroductions({currentTime:()=>Date.now(),session:()=> 'consecom-principal',
  status:async()=>({connected:true}),send:async()=>{textCount++;return {status:true};},
  sendAudio:async()=>{voiceCount++;return {accepted:true};}});
 assert.equal(text.state,'SENT');
 assert.equal(textCount,1);assert.equal(voiceCount,0);
 const permission=routeIntroductionReply({leadId:lead.id,providerId:'inbound-2',body:'sim, pode mandar',receivedAt:when});
 assert.equal(permission.state,'VOICE_WAITING');
 const sent=await tickIntroductions({currentTime:()=>Date.now(),session:()=> 'consecom-principal',
  status:async()=>({connected:true}),
  send:async()=>{textCount++;return {status:true};},
  loadAudio:async()=>({bytes:Buffer.alloc(300000,19)}),
  sendAudio:async({jid:to,session,bytes})=>{
   voiceCount++;assert.equal(to,jid);assert.equal(session,'consecom-principal');
   assert.equal(bytes.length,300000);return {accepted:true,verifiedOnPhone:false};
  }});
 assert.equal(sent.state,'VOICE_SENT',JSON.stringify(sent));
 assert.equal(textCount,1);assert.equal(voiceCount,1);
 assert.equal(portfolioAudioSentFor(introductionStatus(lead.id)),true);
 assert.equal((await tickIntroductions({sendAudio:async()=>{throw Error('DUPLICATE');}})).state,'IDLE');
 const next=routeIntroductionReply({leadId:lead.id,providerId:'inbound-next',body:'Gostei, me conta mais'});
 assert.equal(next.state,'CONVERSING');assert.equal(next.queueAi,true);
 assert.equal(portfolioAudioSentFor(introductionStatus(lead.id)),true);
 const matches=db.all("SELECT provider_id FROM messages WHERE provider_id LIKE 'intro-voice:%' AND direction='out'");
 assert.equal(matches.length,1);
});
test('audio unavailable fails closed, leaving voice pending and sending no replacement text',async()=>{
 const {lead}=addAuthorized();
 const when=new Date(Date.now()-41000);
 assert.equal(routeIntroductionReply({leadId:lead.id,providerId:'inbound-3',body:'Oi',receivedAt:when}).state,'WAITING');
 assert.equal((await tickIntroductions({session:()=> 'consecom-principal',status:async()=>({connected:true}),
  send:async()=>({status:true})})).state,'SENT');
 assert.equal(routeIntroductionReply({leadId:lead.id,providerId:'inbound-4',body:'Claro, manda',receivedAt:when}).state,'VOICE_WAITING');
 let sends=0;
 const result=await tickIntroductions({session:()=> 'consecom-principal',
  loadAudio:async()=>{throw Error('VOICE_ASSET_MISSING');},
  send:async()=>{sends++;return {status:true};},
  sendAudio:async()=>{sends++;return {accepted:true};}});
 assert.equal(result.state,'VOICE_ASSET_UNAVAILABLE');
 assert.equal(introductionStatus(lead.id).stage,'VOICE_WAITING');
 assert.equal(sends,0);
});
test('private audio source fails closed if environment chunks are absent',()=>{
 const state=portfolioPitchAudioHealth();
 assert.equal(state.enabled,true);
 assert.equal(state.ready,false);
 assert.match(state.reason,/PITCH_AUDIO_PARTS_NOT_CONFIGURED/);
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
