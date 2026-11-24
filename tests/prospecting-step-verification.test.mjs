import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-steps-'));
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.WA_AKG_SESSION_ID='verification-test-session';
const db=await import('../dashboard/db.mjs');
await import('../dashboard/prospecting-queue.mjs');
await import('../dashboard/prospecting-introduction.mjs');
const {prospectingStepVerification,alertUnverifiedProspectingSteps}=
 await import('../dashboard/prospecting-step-verification.mjs');
db.exec(`CREATE TABLE IF NOT EXISTS waakg_inbox(
 id TEXT PRIMARY KEY,session_id TEXT,jid TEXT,provider_id TEXT,
 lead_id TEXT,body TEXT,state TEXT,received_at TEXT,updated_at TEXT)`);
const old=new Date(Date.now()-40*60000).toISOString();
const now=new Date().toISOString();
function lead(key,stage='VOICE_SENT'){
 const id='verification-lead-'+key,phone='551599998'+String(key).padStart(4,'0');
 db.run('INSERT INTO leads(id,business,phone,stage,contact_permission,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?)',
  id,'Empresa '+key,phone,'CONVERSING',1,old,old);
 db.getThread(id,phone+'@s.whatsapp.net');
 db.run(`INSERT INTO prospecting_introductions(lead_id,phone,session_id,greeting_id,stage,
  sent_at,due_at,reason,followup_due_at,followup_status,followup_sent_at,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,id,phone,'verification-test-session','test-greeting-'+key,
  stage,old,old,stage==='VOICE_SENT'?'PITCH_AUDIO_550':null,old,
  stage==='VOICE_SENT'?'SENT':null,stage==='VOICE_SENT'?old:null,old,old);
 return {id,phone,greeting:'test-greeting-'+key};
}
function receipt(item,kind,status){
 const table=kind==='GREETING'||kind==='INTRO'?'prospecting_text_receipts':'pitch_delivery_receipts';
 db.run(`INSERT INTO ${table}(lead_id,greeting_id,kind,session_id,jid,attempted_at,provider_id,status)
 VALUES(?,?,?,?,?,?,?,?)`,item.id,item.greeting,kind,'verification-test-session',
 item.phone+'@s.whatsapp.net',old,'WA_ID_'+kind+'_'+item.id,status);
}
const first=lead(1);
for(const [kind,status] of [['GREETING','DELIVERED'],['INTRO','SENT'],
 ['AUDIO','ACCEPTED'],['VIDEO','READ']])receipt(first,kind,status);
const second=lead(2,'VOICE_WAITING');
receipt(second,'GREETING','READ');
receipt(second,'INTRO','DELIVERED');
const third=lead(3,'SENT');
receipt(third,'GREETING','READ');
receipt(third,'INTRO','DELIVERED');
db.run("INSERT INTO waakg_inbox(id,session_id,jid,provider_id,lead_id,body,state,received_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
 'customer-yes','verification-test-session',third.phone+'@s.whatsapp.net','customer-yes',
 third.id,'Ok, pode enviar','REVIEW',new Date(Date.now()-20*60000).toISOString(),old);
db.run("INSERT INTO waakg_inbox(id,session_id,jid,provider_id,lead_id,body,state,received_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
 'customer-followup','verification-test-session',third.phone+'@s.whatsapp.net','customer-followup',
 third.id,'Obrigado, vou ouvir','REVIEW',new Date(Date.now()-19*60000).toISOString(),old);

test('distinguishes gateway SENT from delivery and READ for each outbound step',()=>{
 const r=prospectingStepVerification();
 assert.equal(r.steps.GREETING.confirmedOnDevice,3);
 assert.equal(r.steps.INTRO.sentOnWhatsApp,1);
 assert.equal(r.steps.AUDIO.acceptedOnly,1);
 assert.equal(r.steps.VIDEO.confirmedOnDevice,1);
 assert.equal(r.issues.some(x=>x.leadId===first.id&&x.step==='GREETING'),false);
 assert.equal(r.issues.some(x=>x.leadId===first.id&&x.step==='VIDEO'),false);
 assert.equal(r.issues.some(x=>x.leadId===first.id&&x.step==='INTRO'&&x.code==='NOT_CONFIRMED_ON_DEVICE'),true);
 assert.equal(r.issues.some(x=>x.leadId===first.id&&x.step==='AUDIO'&&x.code==='GATEWAY_ONLY'),true);
});
test('finds overdue permitted audio and an older consent hidden by a later harmless reply',()=>{
 const r=prospectingStepVerification();
 assert.equal(r.issues.some(x=>x.leadId===second.id&&x.step==='AUDIO'&&x.code==='AUTHORIZED_STEP_NOT_ATTEMPTED'),true);
 assert.equal(r.issues.some(x=>x.leadId===third.id&&x.step==='PERMISSION'&&x.code==='CONSENT_RECEIVED_NOT_PROCESSED'),true);
 assert.equal(r.permission.stalled>=1,true);
});
test('alerts the owner but does not invoke an outbound transport or change receipts',()=>{
 db.setSetting('paused',false);
 const calls=[];
 const r=alertUnverifiedProspectingSteps({limit:10,
  notify:(key,type,message,leadId)=>{calls.push({key,type,message,leadId});return true;}});
 assert.ok(r.alerts>=3);
 assert.ok(calls.every(c=>c.type==='PITCH_DELIVERY_ISSUE'));
 assert.equal(db.one("SELECT status FROM pitch_delivery_receipts WHERE lead_id=? AND kind='AUDIO'",first.id).status,'ACCEPTED');
});
test.after(()=>{db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
