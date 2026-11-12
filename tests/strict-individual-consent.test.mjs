import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-proof-only-'));
process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE='true';
process.env.PROSPECTOR_COLD_FIRST_APPROACH='true'; // Must NOT override consent.
process.env.PROPECTOR_REQUIRE_DOCUMENTED_OPTIN='false';
process.env.WA_AKG_SESSION_ID='consecom-principal';
delete process.env.PROSPECTOR_TENANT_ID;
const db=await import('../dashboard/db.mjs');
const {approveLeadBatch,listLeadApprovals}=await import('../dashboard/lead-approvals.mjs');
const {documentedOptIn,autoOutreachCandidateSql,outreachQueueSnapshot}=await import('../dashboard/outreach-queue.mjs');
const {requiresDocumentedOptIn}=await import('../dashboard/prospecting-queue.mjs');
const {validIndividualConsent}=await import('../dashboard/verified-consent.mjs');

const lead=db.addLead({business:'Oficina de teste de consentimento',phone:'5515999002345',
 source:'maps_extension',contact_permission:false}).lead;
test('quick approval remains an unverified operator statement, never an automatic send permit',()=>{
 const reply=approveLeadBatch({quick:true,confirmedByOperator:true,leadIds:[lead.id]});
 assert.equal(reply.approved,1);
 assert.equal(reply.outreachEligible,0);
 assert.equal(reply.needsDocumentation,1);
 assert.equal(documentedOptIn(lead.id),false);
 assert.equal(requiresDocumentedOptIn(),true);
 assert.equal(db.one(autoOutreachCandidateSql),undefined);
 const snapshot=outreachQueueSnapshot();
 assert.equal(snapshot.ready,0);
 assert.equal(snapshot.awaitingConsent,1);
 const status=listLeadApprovals({status:'PENDING',limit:40});
 assert.equal(status.total,1);
 assert.equal(status.items[0].needsIndividualEvidence,true);
});
test('individual acceptance with source channel, real timestamp and distinct evidence reference unlocks only that lead',()=>{
 const approval=approveLeadBatch({confirmedByOperator:true,items:[{
  leadId:lead.id,channel:'PERSONAL_WHATSAPP',operatorPhone:'5515988887336',
  consentAt:new Date().toISOString(),evidence:'Sim, autorizo a Consecom a enviar a proposta pelo WhatsApp',
  evidenceReference:'WhatsApp 7336 mensagem 2026-11-12 id 123456789'
 }]});
 assert.equal(approval.approved,1);
 assert.equal(documentedOptIn(lead.id),true);
 assert.equal(db.one(autoOutreachCandidateSql)?.id,lead.id);
 assert.equal(outreachQueueSnapshot().ready,1);
 const status=listLeadApprovals({status:'AUTHORIZED',limit:40});
 assert.equal(status.total,1);
 assert.match(status.items[0].consentRecord.evidenceReference,/mensagem/);
});
test('individual evidence cannot be replaced by an unverified quick declaration',()=>{
 assert.equal(validIndividualConsent({permitted:true,method:'manual_quick_approval',
  evidence:'O operador confirmou',evidenceType:'OPERATOR_ATTESTATION',evidenceVerified:false}),false);
 assert.equal(requiresDocumentedOptIn(),true);
});
test('a later opt-out immediately blocks previously approved lead',()=>{
 const previous=db.one('SELECT phone FROM leads WHERE id=?',lead.id);
 db.run("INSERT OR IGNORE INTO suppressions(phone,reason,created_at) VALUES(?,?,?)",
  previous.phone,'Cliente pediu não receber mensagens',new Date().toISOString());
 assert.equal(db.one(autoOutreachCandidateSql),undefined);
 assert.equal(documentedOptIn(lead.id),false);
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});