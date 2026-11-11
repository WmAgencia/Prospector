import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'approved-owner-voice-'));
delete process.env.PROSPECTOR_TENANT_ID;
process.env.FRANCISCA_TTS_ENABLED='false';
process.env.PROSPECTOR_PITCH_AUDIO_ENABLED='false';
process.env.WA_AKG_SESSION_ID='consecom-principal';
const db=await import('../dashboard/db.mjs');
const {isFinalGoodbye,finishConversation,conversationFinished}=await import('../dashboard/prospect-terminal-conversation.mjs');
const {registerOwnerRecording,approvedOwnerRecordingStatus,loadApprovedOwnerRecording,OWNER_PREVIEW_FOLLOWUP,OWNER_PREVIEW_DELAY_MS}=await import('../dashboard/owner-approved-pitch.mjs');
const {enqueueOwnerPitch,tickOwnerPitch,ownerPitchStatus}=await import('../dashboard/owner-pitch-sequence.mjs');
const {registerGreeting,routeIntroductionReply,introductionStatus}=await import('../dashboard/prospecting-introduction.mjs');
await import('../dashboard/waakg-bridge.mjs');
const {bindLeadSession}=await import('../dashboard/waakg-session-registry.mjs');
function makeContact(suffix){
 const number='551198880'+suffix;
 const lead=db.addLead({business:'Teste '+suffix,phone:number,source:'maps_extension',contact_permission:true}).lead;
 db.audit('CONSENT_UPDATED',lead.id,{permitted:true,evidence:'Registro comprovado de teste'});
 const thread=db.getThread(lead.id,number+'@s.whatsapp.net');
 const greetingId=db.id();
 db.addMessage({threadId:thread.id,providerId:'prospect-queue:'+greetingId,direction:'out',body:'Olá, tudo bem?',status:'sent'});
 bindLeadSession(lead.id,'consecom-principal');
 assert.equal(registerGreeting({leadId:lead.id,greetingId,sessionId:'consecom-principal'}),true);
 return {lead,thread,greetingId,number};
}
test('terminal goodbye closes the dialogue and does not close a normal CTA',()=>{
 const done='Entendido, William. Caso precise de algum apoio ou queira conversar com a gente no futuro, é só chamar.';
 assert.equal(isFinalGoodbye(done),true);
 assert.equal(isFinalGoodbye('Posso enviar uma prévia do seu site?'),false);
 assert.equal(isFinalGoodbye('Caso precise de detalhes sobre preços, eu explico agora.'),false);
 const x=makeContact('6101');
 assert.equal(finishConversation({leadId:x.lead.id,sessionId:'consecom-principal',body:done,providerId:'groq:abcdef'}),true);
 assert.equal(conversationFinished(x.lead.id,'consecom-principal'),true);
});
test('real uploaded owner audio transcodes to OGG Opus without synthesizing a voice',()=>{
 const sample=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=1','-ar','44100','-ac','1','-f','wav','pipe:1'],{maxBuffer:5*1024*1024});
 assert.equal(sample.status,0);
 const saved=registerOwnerRecording(sample.stdout);
 assert.equal(saved.ready,true);
 const voice=loadApprovedOwnerRecording();
 assert.equal(voice.bytes.toString('ascii',0,4),'OggS');
 assert.equal(voice.source,'OWNER_APPROVED_RECORDING');
 assert.equal(OWNER_PREVIEW_DELAY_MS,10000);
 assert.equal(OWNER_PREVIEW_FOLLOWUP,'Se você quiser, posso te enviar aqui uma prévia de como ficaria o site de vocês, pode ser?');
});
test('one exact owner voice then text after 10 s and no other voice',async()=>{
 const x=makeContact('6102');
 const firstReplyAt=new Date(Date.now()-60000).toISOString();
 const first=routeIntroductionReply({leadId:x.lead.id,providerId:'greet-6102',body:'Beleza, pode falar',receivedAt:firstReplyAt});
 assert.equal(first.state,'WAITING','first customer reply must get Wesley written introduction');
 assert.equal(ownerPitchStatus(x.lead.id),null,'no audio before Wesley text');
 db.addMessage({threadId:x.thread.id,providerId:'intro:'+x.greetingId,direction:'out',
  body:'Meu nome é Wesley, sou dono da agência Consecom. Estou entrando em contato porque queria fazer uma proposta pra vocês.',status:'sent'});
 db.run("UPDATE prospecting_introductions SET stage='SENT',sent_at=?,updated_at=? WHERE lead_id=?",db.now(),db.now(),x.lead.id);
 const inboundId='consecom-principal:INBOUND_6102';
 const inboundAt=new Date(Date.now()-20000).toISOString();
 db.addMessage({threadId:x.thread.id,providerId:inboundId,direction:'in',body:'Que tipo de proposta?',status:'received'});
 db.run('INSERT INTO waakg_inbox(id,session_id,jid,provider_id,lead_id,body,state,received_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
  db.id(),'consecom-principal',x.number+'@s.whatsapp.net',inboundId,x.lead.id,'Que tipo de proposta?','REVIEW',inboundAt,db.now());
 const routed=routeIntroductionReply({leadId:x.lead.id,providerId:inboundId,body:'Que tipo de proposta?',receivedAt:inboundAt});
 assert.equal(routed.state,'OWNER_AUDIO_QUEUED');
 assert.equal(introductionStatus(x.lead.id).stage,'VOICE_REVIEW');
 let audioSent=0,textSent=0,synthetic=0;
 const getVoice=async args=>{audioSent++;
  assert.equal(args.originalOwnerAudio,true);
  assert.equal(args.mimeType,'audio/ogg; codecs=opus');
  assert.equal(args.bytes.toString('ascii',0,4),'OggS');
  return {accepted:true};};
 const messageSend=async(_path,data)=>{textSent++;
  assert.equal(data.data.message.text,OWNER_PREVIEW_FOLLOWUP);
  return {status:true};};
 const mock={
  status:async()=>({connected:true}),sendAudio:getVoice,sendText:messageSend
 };
 const voice=await tickOwnerPitch(mock);
 assert.equal(voice.state,'AUDIO_ACCEPTED',JSON.stringify(voice));
 assert.equal(audioSent,1);
 assert.equal(textSent,0);
 const tooSoon=await tickOwnerPitch(mock);
 assert.equal(tooSoon.state,'IDLE');
 const later=await tickOwnerPitch({...mock,clock:()=>Date.now()+11000});
 assert.equal(later.state,'DONE',JSON.stringify(later));
 assert.equal(audioSent,1);assert.equal(textSent,1);assert.equal(synthetic,0);
 assert.equal((await tickOwnerPitch({...mock,clock:()=>Date.now()+20000})).state,'IDLE');
});
test('prior polite closing is discovered before new AI scheduling',()=>{
 const x=makeContact('6103');
 db.addMessage({threadId:x.thread.id,providerId:'groq:earlier',direction:'out',
  body:'Entendido, William. Caso precise de algum apoio ou queira conversar com a gente no futuro, é só chamar.',status:'sent'});
 assert.equal(conversationFinished(x.lead.id,'consecom-principal'),true);
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
