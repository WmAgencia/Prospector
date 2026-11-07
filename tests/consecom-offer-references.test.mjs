import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/prospector-offer-links-');
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.WA_AKG_SESSION_ID='test-session';
process.env.PROSPECTOR_REQUIRE_DOCUMENTED_OPTIN='true';
process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE='true';
const db=await import('../dashboard/db.mjs');
const {tickOfferReferences}=await import('../dashboard/consecom-offer-ab.mjs');
const {OFFER_AB_REFERENCES_TEXT}=await import('../dashboard/consecom-offer-copy.mjs');

const phone='5515999887766',jid=phone+'@s.whatsapp.net';
const lead=db.addLead({business:'Empresa Fictícia',phone,source:'MANUAL'}).lead;
const t=new Date(Date.now()-100000).toISOString();
db.run('UPDATE leads SET contact_permission=1 WHERE id=?',lead.id);
db.audit('CONSENT_UPDATED',lead.id,{permitted:true,evidence:'Autorização hipotética documentada em teste, nenhuma pessoa real envolvida'});
db.run("INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,'SENT',?,?)",lead.id,phone,'test-first-contact',t);
db.getThread(lead.id,jid);
const src='offer-ab:'+lead.id;
db.run("INSERT INTO consecom_offer_ab(lead_id,session_id,variant,phase,provider_id,status,created_at,sent_at,updated_at) VALUES(?,?,'TEXT',0,?,'SENT',?,?,?)",lead.id,'test-session',src,t,t,t);
db.run("CREATE TABLE IF NOT EXISTS waakg_inbox(jid TEXT,received_at TEXT,session_id TEXT,lead_id TEXT)");
function schedule(dueMs){
 db.run("INSERT INTO consecom_offer_references(lead_id,session_id,jid,source_provider_id,state,due_at,created_at,updated_at) VALUES(?,?,?,?,'WAITING',?,?,?) ON CONFLICT(lead_id) DO UPDATE SET state='WAITING',due_at=excluded.due_at,reason=NULL,updated_at=excluded.updated_at",lead.id,'test-session',jid,src,new Date(dueMs).toISOString(),t,t);
}
let sends=0;const fakeSend=async(path,opts)=>{sends++;assert.match(path,/test-session/);assert.equal(opts.data.message.text,OFFER_AB_REFERENCES_TEXT);return {status:true};};
const params={getWaStatus:async()=>({connected:true}),send:fakeSend};
test('emergency owner pause prevents portfolio references',async()=>{
 schedule(Date.now()-5000);
 const res=await tickOfferReferences(params);
 assert.equal(res.state,'PAUSED');
 assert.equal(sends,0);
 assert.equal(db.one("SELECT state FROM consecom_offer_references WHERE lead_id=?",lead.id).state,'WAITING');
});
test('follow-up only becomes due after its scheduled time',async()=>{
 delete process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE;
 db.setSetting('paused',false);
 schedule(Date.now()+60000);
 const res=await tickOfferReferences(params);
 assert.equal(res.state,'NOT_DUE');
 assert.equal(sends,0);
});
test('an opted-out recipient never receives the second message',async()=>{
 schedule(Date.now()-5000);
 db.run('INSERT INTO suppressions(phone,reason,created_at) VALUES(?,?,?)',phone,'Teste opt-out',t);
 const res=await tickOfferReferences(params);
 assert.equal(res.state,'CANCELLED');
 assert.equal(sends,0);
 db.run('DELETE FROM suppressions WHERE phone=?',phone);
});
test('if the person replies after the proposal the scheduled links are canceled',async()=>{
 schedule(Date.now()-5000);
 db.run('INSERT INTO waakg_inbox(jid,received_at) VALUES(?,?)',jid,new Date().toISOString());
 const res=await tickOfferReferences(params);
 assert.equal(res.state,'CANCELLED');
 assert.equal(res.reason,'RECIPIENT_REPLIED');
 assert.equal(sends,0);
 db.run('DELETE FROM waakg_inbox');
});
test('a delayed follow-up expires instead of firing long after its 25-second window',async()=>{
 schedule(Date.now()-120000);
 const res=await tickOfferReferences(params);
 assert.equal(res.state,'CANCELLED');
 assert.equal(res.reason,'FOLLOWUP_WINDOW_EXPIRED');
 assert.equal(sends,0);
});
test('uncertain WhatsApp acknowledgement is not automatically retried',async()=>{
 schedule(Date.now()-5000);
 let attempts=0;
 const uncertain=await tickOfferReferences({...params,send:async()=>{attempts++;return {status:false};}});
 assert.equal(uncertain.state,'UNKNOWN');
 assert.equal(attempts,1);
 const again=await tickOfferReferences({...params,send:async()=>{attempts++;return {status:true};}});
 assert.equal(again.state,'NOT_DUE');
 assert.equal(attempts,1);
});
test('one approved follow-up is sent once; further ticks never resend it',async()=>{
 schedule(Date.now()-5000);
 const res=await tickOfferReferences(params);
 assert.equal(res.state,'SENT');
 assert.equal(sends,1);
 assert.equal(db.one('SELECT state FROM consecom_offer_references WHERE lead_id=?',lead.id).state,'SENT');
 const again=await tickOfferReferences(params);
 assert.equal(again.state,'NOT_DUE');
 assert.equal(sends,1);
});
test.after(()=>{db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
