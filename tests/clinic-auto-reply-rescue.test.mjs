import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-auto-clinic-'));
process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE='false';
process.env.WA_AKG_SESSION_ID='consecom-principal';
delete process.env.PROSPECTOR_TENANT_ID;

const db=await import('../dashboard/db.mjs');
const {classifyInboundAutomation}=await import('../dashboard/inbound-automation.mjs');
const {registerGreeting,routeIntroductionReply,introductionStatus,tickIntroductions}=await import('../dashboard/prospecting-introduction.mjs');
await import('../dashboard/waakg-bridge.mjs');
const {bindLeadSession}=await import('../dashboard/waakg-session-registry.mjs');

let serial=0;
function contact(){
 serial++;
 const phone='551198881'+String(serial).padStart(4,'0');
 const lead=db.addLead({business:'Clínica teste '+serial,phone,source:'maps_extension',contact_permission:true}).lead;
 db.audit('CONSENT_UPDATED',lead.id,{permitted:true,evidence:'Permissão individual em cenário de teste'});
 const thread=db.getThread(lead.id,phone+'@s.whatsapp.net');
 const greetingId=db.id(),sessionId='consecom-principal';
 db.addMessage({threadId:thread.id,providerId:'prospect-queue:'+greetingId,direction:'out',body:'Olá, tudo bem?',status:'sent'});
 bindLeadSession(lead.id,sessionId);
 assert.equal(registerGreeting({leadId:lead.id,greetingId,sessionId}),true);
 return {lead,thread,phone,sessionId};
}
function inbound(x,body,state='REVIEW'){
 const providerId=x.sessionId+':'+db.id();
 db.addMessage({threadId:x.thread.id,providerId,direction:'in',body,status:'received'});
 db.run('INSERT INTO waakg_inbox(id,session_id,jid,provider_id,lead_id,body,state,received_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
   db.id(),x.sessionId,x.phone+'@s.whatsapp.net',providerId,x.lead.id,body,state,db.now(),db.now());
 return providerId;
}
test('specific canned clinic welcome is held; genuine greeting is not',()=>{
 const text='Olá! Seja muito bem-vindo (a) à clínica Dra Luciana Orsini Scalet - Odontologia de Excelência. Me chamo Grasielle, e vou te acompanhar neste atendimento.';
 assert.equal(classifyInboundAutomation(text).blocked,true);
 assert.equal(classifyInboundAutomation('olá boa tarde, tudo bem?').blocked,false);
});
test('an automated reply defers a pending introduction instead of cancelling it',async()=>{
 const x=contact();
 db.run("UPDATE prospecting_introductions SET stage='WAITING',due_at=?,first_reply_at=? WHERE lead_id=?",
  new Date(Date.now()-5000).toISOString(),new Date(Date.now()-35000).toISOString(),x.lead.id);
 inbound(x,'Olá, agradecemos o seu contato. Estamos fora do horário de atendimento, retornaremos em breve.','AUTO_REPLY');
 const state=await tickIntroductions({onlyLeadId:x.lead.id,currentTime:()=>Date.now()});
 assert.equal(state.state,'WAITING_FOR_HUMAN');
 assert.equal(introductionStatus(x.lead.id).stage,'GREETING_SENT');
 assert.equal(introductionStatus(x.lead.id).sent_at,null);
 const id=inbound(x,'olá boa tarde, tudo bem?');
 const routed=routeIntroductionReply({leadId:x.lead.id,providerId:id,body:'olá boa tarde, tudo bem?',receivedAt:new Date()});
 assert.equal(routed.state,'WAITING');
 assert.equal(introductionStatus(x.lead.id).stage,'WAITING');
});
test('a fresh human reply reopens only unattempted eligibility-cancelled introductions',()=>{
 const x=contact();
 db.run("UPDATE prospecting_introductions SET stage='CANCELLED',reason='ELIGIBILITY_CHANGED',updated_at=? WHERE lead_id=?",
  new Date(Date.now()-600000).toISOString(),x.lead.id);
 const id=inbound(x,'olá boa tarde, tudo bem?');
 const routed=routeIntroductionReply({leadId:x.lead.id,providerId:id,body:'olá boa tarde, tudo bem?',receivedAt:new Date()});
 assert.equal(routed.state,'WAITING');
 assert.equal(introductionStatus(x.lead.id).stage,'WAITING');
 const next=routeIntroductionReply({leadId:x.lead.id,providerId:id,body:'olá boa tarde, tudo bem?',receivedAt:new Date()});
 assert.equal(next.state,'WAITING','the same provider message must never duplicate an introduction');
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
