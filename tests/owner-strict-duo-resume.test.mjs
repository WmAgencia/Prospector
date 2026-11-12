import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-strict-dual-'));
delete process.env.PROSPECTOR_TENANT_ID;
process.env.PROSPECTOR_OWNER_RESUME_DUO_435_20261112='true';
process.env.PROSPECTOR_OWNER_RESUME_435_20261112='false';
process.env.PROSPECTOR_COLD_FIRST_APPROACH='false';
process.env.PROSPECTOR_REQUIRE_DOCUMENTED_OPTIN='true';
process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE='true';

const {selectVerifiedOwnerDuo,OWNER_SENDER_SUFFIXES}=await import('../dashboard/owner-sender-duo.mjs');
const {getSetting,setSetting,all,db}=await import('../dashboard/db.mjs');
const {resumeApprovedOwnerAt435Seconds,OWNER_RESUME_DUO_435_MARKER}=await import('../dashboard/approval-ready-activation.mjs');
const {APPROACH_CADENCE}=await import('../dashboard/approach-cadence.mjs');
const first={session_id:'consecom-principal',connected:true,transportStale:false,numberSuffix:'7336'};
const third={session_id:'prospector-stopped-iphone',connected:false,status:'STOPPED',numberSuffix:null};
const second={session_id:'prospector-number-2994',connected:true,transportStale:false,numberSuffix:'2994'};

test('strictly alternating only 7336 and 2994, skipping third disconnected session',()=>{
 assert.deepEqual(OWNER_SENDER_SUFFIXES,['7336','2994']);
 const arr=[first,third,second];
 let picked=selectVerifiedOwnerDuo(arr,'');
 assert.equal(picked.sessionId,first.session_id);
 assert.equal(picked.numberSuffix,'7336');
 picked=selectVerifiedOwnerDuo(arr,first.session_id);
 assert.equal(picked.sessionId,second.session_id);
 assert.equal(picked.numberSuffix,'2994');
 picked=selectVerifiedOwnerDuo(arr,second.session_id);
 assert.equal(picked.sessionId,first.session_id);
 assert.equal(picked.numberSuffix,'7336');
});
test('no fallback to 7336 alone if 2994 disconnected and no other number used',()=>{
 const bad=selectVerifiedOwnerDuo([first,{...second,connected:false},third],first.session_id);
 assert.equal(bad.connected,false);
 assert.equal(bad.reason,'OWNER_DUAL_SESSION_OFFLINE');
 assert.equal(bad.missingSuffix,'2994');
 assert.equal(bad.sessionId,'');
 const extra=selectVerifiedOwnerDuo([first,second,{...third,connected:true,numberSuffix:'1111'}],first.session_id);
 assert.equal(extra.numberSuffix,'2994');
});
test('real identity checked: duplicate/stale authenticated WhatsApp sender fails closed',()=>{
 assert.equal(selectVerifiedOwnerDuo([first,{...second,transportStale:true}],first.session_id).connected,false);
 assert.equal(selectVerifiedOwnerDuo([first,second,{...second,session_id:'shadow'}],first.session_id).reason,'AMBIGUOUS_OWNER_SESSION');
});
test('two-sender resume requires emergency pause off and documented opt-in',()=>{
 setSetting('paused',true);
 setSetting('autonomous_outreach_enabled',false);
 assert.equal(resumeApprovedOwnerAt435Seconds().status,'EMERGENCY_STOP_ACTIVE');
 assert.equal(getSetting('paused'),true);
 process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE='false';
 assert.equal(resumeApprovedOwnerAt435Seconds().status,'RESUMED_APPROVED_ONLY');
 assert.equal(getSetting('paused'),false);
 assert.equal(getSetting('autonomous_outreach_enabled'),true);
 assert.equal(getSetting('daily_limit'),80);
 assert.equal(getSetting('initial_interval_seconds'),435);
 assert.equal(getSetting('cold_first_approach_enabled'),false);
 assert.deepEqual(getSetting('client_outreach_hours'),{start:'08:00',end:'17:40'});
 assert.equal(getSetting(OWNER_RESUME_DUO_435_MARKER),true);
 assert.equal(APPROACH_CADENCE.minSeconds,435);
 assert.equal(all("SELECT action FROM audit WHERE action='OWNER_435_APPROVED_OUTREACH_RESUMED'").length,1);
});
test('manual pause later is not reversed by another boot',()=>{
 setSetting('paused',true);
 assert.equal(resumeApprovedOwnerAt435Seconds().status,'ALREADY_APPLIED');
 assert.equal(getSetting('paused'),true);
});
test.after(()=>{db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
