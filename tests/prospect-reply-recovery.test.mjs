import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-reply-recovery-'));
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.FRANCISCA_TTS_ENABLED='false';
process.env.PROSPECTOR_PITCH_AUDIO_ENABLED='false';
process.env.PROSPECTOR_REQUIRE_DOCUMENTED_OPTIN='true';
const db=await import('../dashboard/db.mjs');
const {registerGreeting,routeIntroductionReply,tickIntroductions,introductionStatus,
 recoverDisabledPitchQueue,WESLEY_INTRO}=await import('../dashboard/prospecting-introduction.mjs');
const {chooseMissedReply,reconcileApproachedReplies}=await import('../dashboard/prospect-reply-reconciliation.mjs');
let serial=0;
function createContact(number){
 const lead=db.addLead({business:'Empresa '+(++serial),phone:number,source:'maps_extension',contact_permission:true}).lead;
 db.audit('CONSENT_UPDATED',lead.id,{permitted:true,evidence:'Opt-in confirmado para teste automatizado'});
 const greetingId=db.id();
 const jid=lead.phone+'@s.whatsapp.net';
 const thread=db.getThread(lead.id,jid);
 db.addMessage({threadId:thread.id,providerId:'prospect-queue:'+greetingId,direction:'out',body:'Olá, bom dia! Tudo bem?',status:'sent'});
 assert.equal(registerGreeting({leadId:lead.id,greetingId,sessionId:'consecom-principal'}),true);
 return {lead,jid,greetingId,thread};
}
test('proposal voice request is human review only; other introduction text is never starved',async()=>{
 const a=createContact('5511998974636');
 const b=createContact('5519982106886');
 const t=new Date(Date.now()-75000);
 const pitch=routeIntroductionReply({leadId:a.lead.id,providerId:'in-4636',body:'O que seria sobre a proposta?',receivedAt:t});
 assert.equal(pitch.state,'VOICE_REVIEW');
 assert.equal(introductionStatus(a.lead.id).stage,'VOICE_REVIEW');
 const text=routeIntroductionReply({leadId:b.lead.id,providerId:'in-6886',body:'Bom dia, tudo bem?',receivedAt:t});
 assert.equal(text.state,'WAITING');
 let voices=0,texts=0;
 const sent=await tickIntroductions({
  currentTime:()=>Date.now(),status:async()=>({connected:true}),
  session:()=> 'consecom-principal',
  send:async(_uri,opts)=>{texts++;assert.equal(opts.data.message.text,WESLEY_INTRO);return {status:true};},
  sendAudio:async()=>{voices++;throw Error('VOICE MUST NOT SEND');}
 });
 assert.equal(sent.state,'SENT',JSON.stringify(sent));
 assert.equal(sent.recipientSuffix,'6886');
 assert.equal(texts,1);assert.equal(voices,0);
 assert.equal(introductionStatus(b.lead.id).stage,'SENT');
 assert.equal(introductionStatus(a.lead.id).stage,'VOICE_REVIEW');
 const next=await tickIntroductions({sendAudio:async()=>{throw Error('VOICE SENT UNEXPECTEDLY');}});
 assert.equal(next.state,'IDLE');
});
test('stalled VOICE_WAITING jobs are migrated without retries',()=>{
 const c=createContact('5511983375027');
 db.run("UPDATE prospecting_introductions SET stage='VOICE_WAITING',due_at=? WHERE lead_id=?",new Date(Date.now()-120000).toISOString(),c.lead.id);
 const result=recoverDisabledPitchQueue();
 assert.ok(result.markedForReview>=1);
 assert.equal(introductionStatus(c.lead.id).stage,'VOICE_REVIEW');
 assert.equal(db.one("SELECT COUNT(*) n FROM owner_notices WHERE lead_id=? AND kind='OWNER_PITCH_REVIEW'",c.lead.id).n,1);
});
test('provider history distinguishes unanswered inbound from existing manual outbound',()=>{
 const time=new Date(Date.now()-20000).toISOString();
 const incoming={keyId:'ABCDEF12345',content:'Tudo bem, pode falar?',type:'TEXT',fromMe:false,timestamp:time};
 assert.equal(chooseMissedReply([incoming],Date.now()-30000).kind,'MISSED_REPLY');
 assert.equal(chooseMissedReply([incoming,{keyId:'MANUAL12345',fromMe:true,timestamp:new Date(Date.now()-5000).toISOString()}],Date.now()-30000).kind,'MANUAL_REPLY_SEEN');
});
test('recovers exactly one unreceived approved greeting reply from gateway history',async()=>{
 const c=createContact('5511944410123');
 // The inbound must occur AFTER the persistently recorded greeting.
 db.run('UPDATE prospecting_introductions SET created_at=? WHERE lead_id=?',new Date(Date.now()-60000).toISOString(),c.lead.id);
 const timestamp=new Date(Date.now()-10000).toISOString();
 const outcome=await reconcileApproachedReplies({maxContacts:24,request:async(endpoint)=>{
  if(endpoint.includes(encodeURIComponent(c.jid)))return {status:true,data:[
   {keyId:'RECOVERED12345',content:'Oi, tudo bem?',type:'TEXT',fromMe:false,timestamp}
  ]};
  return {status:true,data:[]};
 }});
 assert.equal(outcome.imported,1,JSON.stringify(outcome));
 assert.equal(introductionStatus(c.lead.id).stage,'WAITING');
 const after=await reconcileApproachedReplies({maxContacts:24,request:async(endpoint)=>{
  if(endpoint.includes(encodeURIComponent(c.jid)))return {status:true,data:[
   {keyId:'RECOVERED12345',content:'Oi, tudo bem?',type:'TEXT',fromMe:false,timestamp}
  ]};
  return {status:true,data:[]};
 }});
 assert.equal(after.imported,0);
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
