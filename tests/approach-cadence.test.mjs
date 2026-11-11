import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chooseApproachInterval,approachDueAt,APPROACH_CADENCE,
 OWNER_APPROACH_INTERVAL_MS} from '../dashboard/approach-cadence.mjs';

test('Consecom: 80 slots of 7m15s spread across 08:00–17:40',()=>{
 assert.equal(OWNER_APPROACH_INTERVAL_MS,435000);
 assert.equal(APPROACH_CADENCE.mode,'uniform');
 assert.equal(APPROACH_CADENCE.maxPerDay,80);
 assert.equal(chooseApproachInterval(),435000);
 const start=8*60*60*1000,end=17*60*60*1000+40*60*1000;
 const slots=Array.from({length:80},(_,i)=>start+i*OWNER_APPROACH_INTERVAL_MS);
 assert.equal(slots[0],start);
 assert.equal(slots[79],end-OWNER_APPROACH_INTERVAL_MS);
 assert.equal(slots[79]+OWNER_APPROACH_INTERVAL_MS,end);
 assert.ok(slots.every(x=>x>=start&&x<end));
});
test('Restart / previous small interval cannot reduce owner cooldown',()=>{
 const last=Date.parse('2026-11-11T11:15:00Z');
 assert.equal(approachDueAt({last_attempt_ms:last,last_finished_ms:last+1000,interval_ms:90000}),last+1000+435000);
 assert.equal(approachDueAt({last_attempt_ms:last,last_finished_ms:last+1000,interval_ms:435000}),last+1000+435000);
});
test('Other tenants retain previous random 90–180 second cadence',()=>{
 const probe=spawnSync(process.execPath,['--input-type=module','-e',
  "process.env.PROSPECTOR_TENANT_ID='another-company';const m=await import('./dashboard/approach-cadence.mjs');if(m.APPROACH_CADENCE.mode!=='random')process.exit(1);const v=m.chooseApproachInterval(90000,()=>0);if(v<90000||v>180000||v===90000)process.exit(2);"],{encoding:'utf8'});
 assert.equal(probe.status,0,probe.stderr);
});
