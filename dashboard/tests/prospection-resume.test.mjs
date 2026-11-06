import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/prospector-owner-resume-');
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.NODE_ENV='production';
process.env.PROSPECTOR_OWNER_RESUME_20261106='true';
process.env.PROSPECTOR_COLD_FIRST_APPROACH='false';
process.env.PROSPECTOR_REQUIRE_DOCUMENTED_OPTIN='true';
const data=await import('../db.mjs');
const {resumeOwnerApprovedProspecting}=await import('../prospection-resume.mjs');
const {documentedOptIn}=await import('../outreach-queue.mjs');
const {autonomousReadyCount,requiresDocumentedOptIn}=await import('../prospecting-queue.mjs');
test('emergency stop has priority over owner-authorized one-time resume',()=>{
 process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE='true';
 data.setSetting('paused',true);
 assert.equal(resumeOwnerApprovedProspecting().status,'EMERGENCY_STOP_ACTIVE');
 assert.equal(data.getSetting('paused',true),true);
 delete process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE;
});
test('tenant workers cannot inherit Consecom owner resume',()=>{
 process.env.PROSPECTOR_TENANT_ID='other-tenant';
 assert.equal(resumeOwnerApprovedProspecting().status,'OTHER_TENANT_UNCHANGED');
 assert.equal(data.getSetting('paused',true),true);
 delete process.env.PROSPECTOR_TENANT_ID;
});
test('owner resume reopens only consent-gated autonomous queue and sales followups',()=>{
 data.setSetting('auto_initial',false);
 data.setSetting('automation_enabled',false);
 data.setSetting('discovery_auto_enabled',false);
 data.setSetting('sales_followup_enabled',false);
 const result=resumeOwnerApprovedProspecting();
 assert.equal(result.status,'RESUMED_WITH_CONSENT_GATES');
 assert.equal(data.getSetting('paused',true),false);
 assert.equal(data.getSetting('autonomous_outreach_enabled',false),true);
 assert.equal(data.getSetting('sales_followup_enabled',false),true);
 assert.equal(data.getSetting('auto_initial',true),false);
 assert.equal(data.getSetting('automation_enabled',true),false);
 assert.equal(data.getSetting('discovery_auto_enabled',true),false);
});
test('no consent is created and unconsented business is never eligible',()=>{
 const lead=data.addLead({business:'Empresa sem permissão fictícia',phone:'5515999557788',source:'MANUAL'}).lead;
 assert.equal(requiresDocumentedOptIn(),true);
 assert.equal(documentedOptIn(lead.id),false);
 assert.equal(autonomousReadyCount(),0);
 assert.equal(data.one('SELECT contact_permission FROM leads WHERE id=?',lead.id).contact_permission,0);
});
test('future manual pause is not overridden by the one-time marker',()=>{
 data.setSetting('paused',true);
 assert.equal(resumeOwnerApprovedProspecting().status,'ALREADY_APPLIED');
 assert.equal(data.getSetting('paused',false),true);
});
test.after(()=>{data.db.close();fs.rmSync(dir,{recursive:true,force:true});});
