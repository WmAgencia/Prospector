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
const {registerGreeting,routeIntroductionReply,introductionStatus,tickIntroductions,tickPitchFollowup,PITCH_PREVIEW_TEXT}=await import('../dashboard/prospecting-introduction.mjs');
const {receivePitchDeliveryStatus,pitchDeliveryReceipt}=await import('../dashboard/pitch-delivery-verification.mjs');
const {acceptsProposalAudio}=await import('../dashboard/prospector-sales-signals.mjs');
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
 assert.equal(acceptsProposalAudio('ok, pode enviar'),true);
 assert.equal(acceptsProposalAudio('Ok, pode enviar o áudio.'),true);
 assert.equal(acceptsProposalAudio('beleza, pode mandar'),true);
 assert.equal(acceptsProposalAudio('ok, não pode enviar'),false);
 assert.equal(acceptsProposalAudio('ok, por enquanto não'),false);
 assert.equal(acceptsProposalAudio('ok, vou avaliar'),false);
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
 const permission=routeIntroductionReply({leadId:lead.id,providerId:'inbound-2',body:'ok, pode enviar',receivedAt:when});
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
 assert.equal(next.state,'INTERESTED');assert.equal(next.queueAi,false);
 assert.equal(db.one('SELECT stage FROM leads WHERE id=?',lead.id).stage,'INTERESTED');
 assert.equal(portfolioAudioSentFor(introductionStatus(lead.id)),true);
 const matches=db.all("SELECT provider_id FROM messages WHERE provider_id LIKE 'intro-voice:%' AND direction='out'");
 assert.equal(matches.length,1);
 // Separate scenario: do not leave a pending preview for the next test case.
 db.run("UPDATE prospecting_introductions SET followup_status='CANCELLED' WHERE lead_id=?",lead.id);
});
test('new proposal sends just one native demo video with the approved caption ten seconds after audio',async()=>{
 const {lead,jid}=addAuthorized();
 const when=new Date(Date.now()-42000);
 assert.equal(routeIntroductionReply({leadId:lead.id,providerId:'video-first',body:'Oi',receivedAt:when}).state,'WAITING');
 assert.equal((await tickIntroductions({session:()=> 'consecom-principal',status:async()=>({connected:true}),
  send:async()=>({status:true})})).state,'SENT');
 assert.equal(routeIntroductionReply({leadId:lead.id,providerId:'video-authorized',body:'pode mandar',receivedAt:when}).state,'VOICE_WAITING');
 assert.equal((await tickIntroductions({session:()=> 'consecom-principal',status:async()=>({connected:true}),
  loadAudio:async()=>({bytes:Buffer.alloc(300000,19)}),sendAudio:async()=>({accepted:true,messageId:'AUDIO_WA_MESSAGE_001'})})).state,'VOICE_SENT');
 const row=introductionStatus(lead.id);
 assert.equal(row.reason,'PITCH_AUDIO_550');
 const due=Date.parse(row.followup_due_at);
 assert.ok(due>Date.now());
 // A natural reply before the 10-second preview must not silently cancel it.
 db.addMessage({threadId:db.getThread(lead.id).id,providerId:'video-customer-early-'+lead.id,
  direction:'in',body:'Obrigado, vou ouvir e avaliar',status:'received'});
 const continued=routeIntroductionReply({leadId:lead.id,providerId:'video-customer-early-'+lead.id,
  body:'Obrigado, vou ouvir e avaliar'});
 assert.equal(continued.state,'VOICE_SENT');
 assert.equal(introductionStatus(lead.id).followup_status,'WAITING');
 db.setSetting('paused',false);
 let sent=0;
 const video={status:async()=>({connected:true}),loadVideo:async()=>({bytes:Buffer.alloc(3000,19)}),
  sendVideo:async({jid:to,session,bytes,caption})=>{
   sent++;assert.equal(to,jid);assert.equal(session,'consecom-principal');
   assert.equal(bytes.length,3000);assert.equal(caption,PITCH_PREVIEW_TEXT);
   assert.match(caption,/https:\/\/consecom\.com\.br/);
   assert.doesNotMatch(caption,/O que achou/);return {accepted:true};
  }};
 assert.equal((await tickPitchFollowup({...video,currentTime:()=>due-1})).state,'IDLE');
 const premature=await tickPitchFollowup({...video,currentTime:()=>due+1});
 assert.equal(premature.state,'WAITING_AUDIO_CONFIRMATION');
 assert.equal(sent,0);
 assert.equal(pitchDeliveryReceipt(lead.id,row.greeting_id,'AUDIO').status,'ACCEPTED');
 assert.equal(receivePitchDeliveryStatus({event:'message.status',sessionId:'consecom-principal',data:{
  keyId:'AUDIO_WA_MESSAGE_001',remoteJid:jid,status:'SENT'}}),true);
 const sentVideoResult=await tickPitchFollowup({...video,currentTime:()=>due+1});
 assert.equal(sentVideoResult.state,'SENT',JSON.stringify(sentVideoResult));
 assert.equal(sent,1);
 assert.equal((await tickPitchFollowup({...video,currentTime:()=>due+2000})).state,'IDLE');
 assert.equal(db.one("SELECT type FROM messages WHERE provider_id=?", 'intro-video:'+row.greeting_id).type,'video');
});
test('an old audio awaiting confirmation never blocks another customer whose audio was verified',async()=>{
 db.setSetting('paused',false);
 const stuck=addAuthorized(),ready=addAuthorized();
 for(const [i,client] of [stuck,ready].entries()){
  const when=new Date(Date.now()-45_000);
  assert.equal(routeIntroductionReply({leadId:client.lead.id,providerId:'head-first-'+i,body:'Oi',receivedAt:when}).state,'WAITING');
  assert.equal((await tickIntroductions({session:()=> 'consecom-principal',
   status:async()=>({connected:true}),send:async()=>({status:true})})).state,'SENT');
  assert.equal(routeIntroductionReply({leadId:client.lead.id,providerId:'head-permission-'+i,
   body:'Pode mandar o áudio',receivedAt:when}).state,'VOICE_WAITING');
  assert.equal((await tickIntroductions({session:()=> 'consecom-principal',
   status:async()=>({connected:true}),loadAudio:async()=>({bytes:Buffer.alloc(300000,19)}),
   sendAudio:async()=>({accepted:true,messageId:'QUEUE_AUDIO_'+i+'_123456'})})).state,'VOICE_SENT');
  db.run("UPDATE prospecting_introductions SET followup_due_at=? WHERE lead_id=?",
   new Date(Date.now()-(i===0?9000:4000)).toISOString(),client.lead.id);
 }
 assert.equal(pitchDeliveryReceipt(stuck.lead.id,stuck.greetingId,'AUDIO').status,'ACCEPTED');
 assert.equal(receivePitchDeliveryStatus({event:'message.status',sessionId:'consecom-principal',data:{
  keyId:'QUEUE_AUDIO_1_123456',remoteJid:ready.jid,status:'SENT'}}),true);
 let count=0;
 const sent=await tickPitchFollowup({currentTime:()=>Date.now(),status:async()=>({connected:true}),
  loadVideo:async()=>({bytes:Buffer.alloc(3000,19)}),
  sendVideo:async({jid})=>{count++;assert.equal(jid,ready.jid);return {accepted:true,messageId:'QUEUE_VIDEO_1_123456'};}});
 assert.equal(sent.state,'SENT',JSON.stringify(sent));
 assert.equal(sent.leadId,ready.lead.id);
 assert.equal(count,1);
 assert.equal(introductionStatus(stuck.lead.id).followup_status,'WAITING');
 assert.equal((await tickPitchFollowup({currentTime:()=>Date.now(),sendVideo:async()=>{
  throw Error('MUST_NOT_SEND_UNCONFIRMED');}})).state,'WAITING_AUDIO_CONFIRMATION');
 db.run("UPDATE prospecting_introductions SET followup_status='CANCELLED' WHERE lead_id=?",stuck.lead.id);
});

test('unavailable history for the oldest video does not stall the next confirmed recipient',async()=>{
 db.setSetting('paused',false);
 const offline=addAuthorized(),online=addAuthorized();
 for(const [i,c] of [offline,online].entries()){
  const when=new Date(Date.now()-45_000);
  assert.equal(routeIntroductionReply({leadId:c.lead.id,providerId:'hist-intro-'+i,body:'Oi',receivedAt:when}).state,'WAITING');
  assert.equal((await tickIntroductions({session:()=> 'consecom-principal',status:async()=>({connected:true}),
   send:async()=>({status:true})})).state,'SENT');
  assert.equal(routeIntroductionReply({leadId:c.lead.id,providerId:'hist-permission-'+i,
   body:'Pode enviar o áudio',receivedAt:when}).state,'VOICE_WAITING');
  assert.equal((await tickIntroductions({session:()=> 'consecom-principal',status:async()=>({connected:true}),
   loadAudio:async()=>({bytes:Buffer.alloc(300000,19)}),
   sendAudio:async()=>({accepted:true,messageId:'HIST_AUDIO_'+i+'_123456'})})).state,'VOICE_SENT');
  assert.equal(receivePitchDeliveryStatus({event:'message.status',sessionId:'consecom-principal',
   data:{keyId:'HIST_AUDIO_'+i+'_123456',remoteJid:c.jid,status:'SENT'}}),true);
  db.run("UPDATE prospecting_introductions SET followup_due_at=? WHERE lead_id=?",
   new Date(Date.now()-(i===0?9000:4000)).toISOString(),c.lead.id);
 }
 const video={currentTime:()=>Date.now(),status:async()=>({connected:true}),
  loadVideo:async()=>({bytes:Buffer.alloc(3000,19)}),
  fetchHistory:async path=>path.includes(offline.lead.phone)?{status:false}:{status:true,data:[]}};
 const first=await tickPitchFollowup({...video,sendVideo:async()=>{throw Error('FIRST CHAT OFFLINE');}});
 assert.equal(first.state,'HISTORY_UNAVAILABLE');
 let sent=0;
 const second=await tickPitchFollowup({...video,sendVideo:async({jid})=>{
  sent++;assert.equal(jid,online.jid);return {accepted:true,messageId:'ONLINE_VIDEO_123456'};
 }});
 assert.equal(second.state,'SENT',JSON.stringify(second));
 assert.equal(second.leadId,online.lead.id);
 assert.equal(sent,1);
 assert.equal(introductionStatus(offline.lead.id).followup_status,'WAITING');
 db.run("UPDATE prospecting_introductions SET followup_status='CANCELLED' WHERE lead_id=?",offline.lead.id);
});

test('a later harmless reply does not hide the customer\'s earlier voice authorization',async()=>{
 const {lead,jid,greetingId}=addAuthorized();
 const when=new Date(Date.now()-180000);
 assert.equal(routeIntroductionReply({leadId:lead.id,providerId:'multi-first',body:'Oi',receivedAt:when}).state,'WAITING');
 assert.equal((await tickIntroductions({session:()=> 'consecom-principal',
  status:async()=>({connected:true}),send:async()=>({status:true})})).state,'SENT');
 const intro=introductionStatus(lead.id);
 const old=new Date(Date.now()-3*60000).toISOString();
 db.run("UPDATE prospecting_introductions SET sent_at=? WHERE lead_id=?",old,lead.id);
 db.exec(`CREATE TABLE IF NOT EXISTS waakg_inbox(
  id TEXT PRIMARY KEY,session_id TEXT,jid TEXT,provider_id TEXT,
  lead_id TEXT,body TEXT,state TEXT,received_at TEXT,updated_at TEXT)`);
 const yesAt=new Date(Date.now()-2*60000).toISOString();
 const laterAt=new Date(Date.now()-115000).toISOString();
 for(const [idx,body,at] of [[1,'Ok, pode enviar',yesAt],[2,'Obrigado, vou conferir',laterAt]]){
  const key='multireply-'+idx+'-'+lead.id;
  db.run("INSERT INTO waakg_inbox(id,session_id,jid,provider_id,lead_id,body,state,received_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
   key,'consecom-principal',jid,key,lead.id,body,'REVIEW',at,at);
 }
 const {WESLEY_INTRO}=await import('../dashboard/prospecting-introduction.mjs');
 const {recoverVerifiedUnattemptedPitch}=await import('../dashboard/pitch-delivery-verification.mjs');
 const proof={fromMe:true,type:'TEXT',keyId:'MULTI_INTRO_CONFIRMED',
  content:WESLEY_INTRO,timestamp:old,status:'DELIVERED'};
 const result=await recoverVerifiedUnattemptedPitch({limit:2,fetchChat:async()=>({status:true,data:[proof]})});
 assert.equal(result.queued>=1,true,JSON.stringify(result));
 assert.equal(introductionStatus(lead.id).stage,'VOICE_WAITING');
 assert.equal(db.one("SELECT COUNT(*) AS n FROM pitch_delivery_receipts WHERE lead_id=?",lead.id).n,0);
 db.run("UPDATE prospecting_introductions SET stage='CANCELLED' WHERE lead_id=?",lead.id);
});

test('existing permission message in WhatsApp is confirmed without another outgoing text',async()=>{
 const {lead,greetingId,jid}=addAuthorized();
 const when=new Date(Date.now()-45000);
 assert.equal(routeIntroductionReply({leadId:lead.id,providerId:'already-asked-reply',body:'Oi, tudo bem?',receivedAt:when}).state,'WAITING');
 let sends=0;
 const {WESLEY_INTRO}=await import('../dashboard/prospecting-introduction.mjs');
 const result=await tickIntroductions({currentTime:()=>Date.now(),
  session:()=> 'consecom-principal',status:async()=>({connected:true}),
  fetchHistory:async()=>({status:true,data:[{fromMe:true,type:'TEXT',
   keyId:'PERMISSION_ALREADY_SENT_001',content:WESLEY_INTRO,timestamp:new Date().toISOString(),status:'DELIVERED'}]}),
  send:async()=>{sends++;throw Error('SHOULD_NOT_SEND_DUPLICATE');}});
 assert.equal(result.state,'SENT');
 assert.equal(result.fromHistory,true);
 assert.equal(sends,0);
 const {textReceipt}=await import('../dashboard/prospecting-text-receipts.mjs');
 assert.equal(textReceipt(lead.id,greetingId,'INTRO').status,'DELIVERED');
});
test('existing exact campaign video is confirmed from WhatsApp without a second video',async()=>{
 const {lead,greetingId,jid}=addAuthorized();
 const when=new Date(Date.now()-45000);
 routeIntroductionReply({leadId:lead.id,providerId:'preexisting-video-1',body:'Oi',receivedAt:when});
 assert.equal((await tickIntroductions({status:async()=>({connected:true}),session:()=> 'consecom-principal',
  send:async()=>({status:true,data:{key:{id:'INTRO_CONFIRMED_001'}}})})).state,'SENT');
 routeIntroductionReply({leadId:lead.id,providerId:'preexisting-video-2',body:'Pode mandar o áudio',receivedAt:when});
 assert.equal((await tickIntroductions({status:async()=>({connected:true}),session:()=> 'consecom-principal',
  loadAudio:async()=>({bytes:Buffer.alloc(300000,19)}),
  sendAudio:async()=>({accepted:true,messageId:'ORIGINAL_AUDIO_001'})})).state,'VOICE_SENT');
 assert.equal(receivePitchDeliveryStatus({event:'message.status',sessionId:'consecom-principal',
  data:{keyId:'ORIGINAL_AUDIO_001',remoteJid:jid,status:'SENT'}}),true);
 db.setSetting('paused',false);
 const due=Date.parse(introductionStatus(lead.id).followup_due_at);
 let sends=0;
 const result=await tickPitchFollowup({currentTime:()=>due+10,status:async()=>({connected:true}),
  fetchHistory:async()=>({status:true,data:[{fromMe:true,type:'VIDEO',keyId:'EXISTING_APPROVED_VIDEO_001',
   content:PITCH_PREVIEW_TEXT,timestamp:new Date(due+10).toISOString(),status:'DELIVERED'}]}),
  sendVideo:async()=>{sends++;throw Error('SHOULD_NOT_RESEND_VIDEO');}});
 assert.equal(result.state,'SENT',JSON.stringify(result));
 assert.equal(result.fromHistory,true);
 assert.equal(sends,0);
 const receipt=pitchDeliveryReceipt(lead.id,greetingId,'VIDEO');
 assert.equal(receipt.provider_id,'EXISTING_APPROVED_VIDEO_001');
 assert.equal(receipt.status,'DELIVERED');
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
