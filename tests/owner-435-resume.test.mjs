import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-owner-435-resume-'));
delete process.env.PROSPECTOR_TENANT_ID;
process.env.PROSPECTOR_OWNER_RESUME_435_20261112='true';
process.env.PROSPECTOR_COLD_FIRST_APPROACH='false';
process.env.PROSPECTOR_REQUIRE_DOCUMENTED_OPTIN='true';
process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE='true';

const {getSetting,setSetting,all,db}=await import('../dashboard/db.mjs');
const {resumeApprovedOwnerAt435Seconds,OWNER_RESUME_435_MARKER}=await import('../dashboard/approval-ready-activation.mjs');
const {OWNER_APPROACH_INTERVAL_MS,chooseApproachInterval,approachDueAt}=await import('../dashboard/approach-cadence.mjs');

test('emergency pause wins even with explicit one-shot owner resume',()=>{
 setSetting('paused',true);
 setSetting('autonomous_outreach_enabled',false);
 const outcome=resumeApprovedOwnerAt435Seconds();
 assert.equal(outcome.status,'EMERGENCY_STOP_ACTIVE');
 assert.equal(getSetting('paused'),true);
 assert.equal(getSetting(OWNER_RESUME_435_MARKER,false),false);
});
test('resume retains consent gates and globally fixes the daily 435-second pace',()=>{
 process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE='false';
 const outcome=resumeApprovedOwnerAt435Seconds();
 assert.equal(outcome.status,'RESUMED_APPROVED_ONLY');
 assert.equal(OWNER_APPROACH_INTERVAL_MS,435000);
 assert.equal(chooseApproachInterval(),435000);
 assert.equal(approachDueAt({last_attempt_ms:1000,last_finished_ms:2000,interval_ms:90000}),437000);
 assert.equal(getSetting('paused'),false);
 assert.equal(getSetting('autonomous_outreach_enabled'),true);
 assert.equal(getSetting('cold_first_approach_enabled'),false);
 assert.equal(getSetting('auto_initial'),false);
 assert.equal(getSetting('daily_limit'),80);
 assert.equal(getSetting('initial_interval_seconds'),435);
 assert.deepEqual(getSetting('client_outreach_hours'),{start:'08:00',end:'17:40'});
 const audits=all("SELECT action FROM audit WHERE action='OWNER_435_APPROVED_OUTREACH_RESUMED'");
 assert.equal(audits.length,1);
});
test('later manual pause is preserved across app restart / repeated activation',()=>{
 setSetting('paused',true);
 const again=resumeApprovedOwnerAt435Seconds();
 assert.equal(again.status,'ALREADY_APPLIED');
 assert.equal(getSetting('paused'),true);
 assert.equal(all("SELECT action FROM audit WHERE action='OWNER_435_APPROVED_OUTREACH_RESUMED'").length,1);
});
test.after(()=>{db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
