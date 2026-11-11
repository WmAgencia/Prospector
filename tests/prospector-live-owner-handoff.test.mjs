import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-handoff-live-'));
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.PROSPECTOR_GROUP_IMPORT_JID='120363012345678999@g.us';
process.env.PROSPECTOR_PITCH_AUDIO_ENABLED='false';
process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE='false';
delete process.env.PROSPECTOR_TENANT_ID;
const db=await import('../dashboard/db.mjs');
const {bindLeadSession}=await import('../dashboard/waakg-session-registry.mjs');
const {registerGreeting,routeIntroductionReply,WESLEY_INTRO}=await import('../dashboard/prospecting-introduction.mjs');
const {recordInboundTranscript}=await import('../dashboard/waakg-bridge.mjs');
const {tickProspectorFarewells,PROSPECTOR_FAREWELL}=await import('../dashboard/prospector-farewell.mjs');
const {conversationFinished,isFinalGoodbye}=await import('../dashboard/prospect-terminal-conversation.mjs');
const {flushInterestAlerts}=await import('../dashboard/groq-sales-automation.mjs');
const {interestedAfterProposal}=await import('../dashboard/prospector-sales-signals.mjs');
const {ownerPitchStatus}=await import('../dashboard/owner-pitch-sequence.mjs');
let counter=10;
function makeContact(){
 const number='551198899'+String(counter++).padStart(4,'0');
 const lead=db.addLead({business:'Empresa Teste '+counter,name:'João',phone:number,source:'maps_extension',contact_permission:true}).lead;
 db.audit('CONSENT_UPDATED',lead.id,{permitted:true,evidence:'Fictitious authorized contact'});
 const jid=number+'@s.whatsapp.net',thread=db.getThread(lead.id,jid),greetingId=db.id();
 db.addMessage({threadId:thread.id,providerId:'prospect-queue:'+greetingId,direction:'out',body:'Olá, bom dia! Tudo bem?',status:'sent'});
 bindLeadSession(lead.id,'consecom-principal');
 assert.equal(registerGreeting({leadId:lead.id,greetingId,sessionId:'consecom-principal'}),true);
 return {lead,jid,thread,greetingId};
}
function alreadySentOwnerAudio(contact,stage='DONE'){
 const at=db.now();
 db.run("INSERT INTO owner_pitch_sequences(lead_id,session_id,request_provider_id,stage,due_at,audio_sha256,audio_sent_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
 contact.lead.id,'consecom-principal','inbound-audio-'+contact.lead.id,stage,null,'a'.repeat(64),at,at,at);
 db.run("UPDATE prospecting_introductions SET stage='CONVERSING' WHERE lead_id=?",contact.lead.id);
}
test('Wesley asks permission before original audio; simple signals never mistake rejection',()=>{
 assert.match(WESLEY_INTRO,/Posso te mandar o áudio explicando a ideia\?/);
 for(const phrase of ['gostei','faz sentido','quero saber mais','qual o valor?','sim','podemos conversar?'])
  assert.equal(interestedAfterProposal(phrase),true,phrase);
 for(const phrase of ['não tenho interesse','agora não','não quero'])
  assert.equal(interestedAfterProposal(phrase),false,phrase);
 assert.equal(isFinalGoodbye(PROSPECTOR_FAREWELL),true);
});
test('explicit request for text goes to human review rather than improvising substitute offer',()=>{
 const c=makeContact();
 db.addMessage({threadId:c.thread.id,providerId:'intro:'+c.greetingId,direction:'out',body:WESLEY_INTRO,status:'sent'});
 db.run("UPDATE prospecting_introductions SET stage='SENT' WHERE lead_id=?",c.lead.id);
 const routed=routeIntroductionReply({leadId:c.lead.id,providerId:'text-only-00001',body:'Prefiro em texto',receivedAt:db.now()});
 assert.equal(routed.queueAi,false);
 assert.equal(routed.state,'VOICE_REVIEW');
});
test('original voice interest immediately queues one group alert and locks customer AI',async()=>{
 const c=makeContact();
 alreadySentOwnerAudio(c,'AUDIO_ACCEPTED');
 const first=recordInboundTranscript({sessionId:'consecom-principal',jid:c.jid,unique:'consecom-principal:interest-00001',content:'Gostei da proposta, podemos conversar?'});
 assert.equal(first.status,200);
 assert.equal(first.body.ownerTakeover,true);
 assert.equal(db.one('SELECT stage FROM leads WHERE id=?',c.lead.id).stage,'INTERESTED');
 assert.equal(db.one('SELECT manual_takeover FROM threads WHERE id=?',c.thread.id).manual_takeover,1);
 assert.equal(db.one("SELECT COUNT(*) n FROM groq_auto_events WHERE provider_id='consecom-principal:interest-00001'").n,0);
 const queued=db.one("SELECT * FROM owner_notices WHERE kind='GROQ_HOT_LEAD' AND lead_id=?",c.lead.id);
 assert.ok(queued);
 assert.match(queued.message,/Empresa Teste/);
 assert.match(queued.message,/Nome:/);
 assert.match(queued.message,/https:\/\/wa\.me\/551198899/);
 const recipients=[];
 const flushed=await flushInterestAlerts({status:async()=>({connected:true,sessionId:'consecom-principal'}),
  groupInfo:async()=>({subject:'Meu Prospector',id:'120363012345678999@g.us'}),
  send:async(url,options)=>{recipients.push({url,text:options.data.message.text});return {status:true};}});
 assert.equal(flushed,1);
 assert.equal(recipients.length,1);
 assert.match(decodeURIComponent(recipients[0].url),/120363012345678999@g\.us\/send/);
 const again=recordInboundTranscript({sessionId:'consecom-principal',jid:c.jid,unique:'consecom-principal:interest-00002',content:'Muito obrigado'});
 assert.equal(again.body.ownerTakeover,true);
 assert.equal(db.one("SELECT COUNT(*) n FROM owner_notices WHERE kind='GROQ_HOT_LEAD' AND lead_id=?",c.lead.id).n,1);
});
test('refusal sends a single polite goodbye; later inbound does not receive anything',async()=>{
 const c=makeContact();
 const first=recordInboundTranscript({sessionId:'consecom-principal',jid:c.jid,unique:'consecom-principal:declined-00001',content:'Não tenho interesse, obrigado'});
 assert.equal(first.status,200);
 assert.equal(db.one('SELECT stage FROM leads WHERE id=?',c.lead.id).stage,'NO_INTEREST');
 let count=0;
 const farewell=await tickProspectorFarewells({status:async()=>({connected:true}),
  send:async(url,options)=>{count++;assert.equal(options.data.message.text,PROSPECTOR_FAREWELL);return {status:true};}});
 assert.equal(farewell.state,'SENT');
 assert.equal(count,1);
 assert.equal(conversationFinished(c.lead.id,'consecom-principal'),true);
 const again=recordInboundTranscript({sessionId:'consecom-principal',jid:c.jid,unique:'consecom-principal:declined-00002',content:'Tá, obrigado'});
 assert.equal(again.status,200);
 assert.equal(again.body.automatedReply,false);
 assert.equal(db.one('SELECT stage FROM leads WHERE id=?',c.lead.id).stage,'NO_INTEREST');
 assert.equal((await tickProspectorFarewells({send:async()=>{count++;return {status:true};}})).state,'IDLE');
 assert.equal(count,1);
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});