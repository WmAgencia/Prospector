import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const temp=fs.mkdtempSync(os.tmpdir()+'/prospector-payment-review-');
process.env.PROSPECTOR_DATA_DIR=temp;
process.env.WA_AKG_SESSION_ID='qa-payment';
const db=await import('../db.mjs');
const {recordReceiptMedia,confirmPayment,paymentIntentStatus}=await import('../sales-payment-flow.mjs');
const lead=db.addLead({business:'Empresa fictícia',phone:'5515999334422',source:'MANUAL'}).lead;
const jid=lead.phone+'@s.whatsapp.net';
const thread=db.getThread(lead.id,jid);
db.run("INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)",lead.id,lead.phone,'SENT','qa-outbound-1',db.now());
db.stage(lead.id,'CONVERSING','QA');
db.run("INSERT INTO sales_payment_intents(lead_id,provider_id,session_id,amount_cents,entry_cents,remaining_cents,method,status,requested_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
 lead.id,'qa-pix','qa-payment',55000,27500,27500,'pix','AWAITING_RECEIPT',db.now(),db.now());
test('photo or document after PIX request never establishes a sale by itself',()=>{
 const r=recordReceiptMedia({leadId:lead.id,jid,sessionId:'qa-payment',providerId:'qa-photo-1',mimeType:'IMAGE'});
 assert.equal(r.recorded,true);
 assert.equal(r.commerciallyClosed,false);
 assert.equal(r.verified,false);
 assert.equal(r.reviewRequired,true);
 assert.equal(db.one('SELECT stage FROM leads WHERE id=?',lead.id).stage,'CONVERSING');
 assert.equal(db.one('SELECT manual_takeover FROM threads WHERE id=?',thread.id).manual_takeover,1);
 assert.equal(db.one('SELECT COUNT(*) n FROM sales_outcomes WHERE lead_id=?',lead.id).n,0);
 assert.equal(db.one("SELECT COUNT(*) n FROM owner_notices WHERE lead_id=? AND kind='PAYMENT_RECEIPT'",lead.id).n,1);
 assert.match(db.one("SELECT message FROM owner_notices WHERE lead_id=? AND kind='PAYMENT_RECEIPT'",lead.id).message,/não há venda nem pagamento confirmados/i);
 assert.equal(paymentIntentStatus(lead.id).status,'RECEIPT_RECEIVED');
});
test('duplicates do not create another notice or overwrite the first pending file',()=>{
 assert.equal(recordReceiptMedia({leadId:lead.id,jid,sessionId:'qa-payment',providerId:'qa-photo-2',mimeType:'IMAGE'}).recorded,false);
 assert.equal(db.one("SELECT COUNT(*) n FROM owner_notices WHERE lead_id=? AND kind='PAYMENT_RECEIPT'",lead.id).n,1);
});
test('owner verification is mandatory before marking sale closed',()=>{
 assert.throws(()=>confirmPayment(lead.id,{paymentVerified:false,reference:'bank confirmation'}),/confirmação/i);
 assert.equal(db.one('SELECT stage FROM leads WHERE id=?',lead.id).stage,'CONVERSING');
 const done=confirmPayment(lead.id,{paymentVerified:true,reference:'bank-verified-qa'});
 assert.equal(done.verified,true);
 assert.equal(paymentIntentStatus(lead.id).status,'PAYMENT_VERIFIED');
 assert.equal(db.one('SELECT stage FROM leads WHERE id=?',lead.id).stage,'CLOSED_WON');
 assert.equal(db.one('SELECT status FROM sales_outcomes WHERE lead_id=?',lead.id).status,'CLOSED_WON');
 assert.throws(()=>confirmPayment(lead.id,{paymentVerified:true,reference:'bank-verified-qa'}),/pendente/i);
});
test.after(()=>{db.db.close();fs.rmSync(temp,{recursive:true,force:true});});
