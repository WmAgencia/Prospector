import test from 'node:test';
import assert from 'node:assert/strict';
import {introductionDispatchDecision,INTRO_MAX_OVERDUE_MS,INTRO_MIN_GAP_MS} from '../dashboard/introduction-dispatch-safety.mjs';
const now=Date.parse('2026-11-12T12:49:45.000Z');
const at=x=>new Date(x).toISOString();
test('a live reply keeps the 30-second scripted introduction eligibility',()=>{
 assert.deepEqual(introductionDispatchDecision({nowMs:now,dueAt:at(now-1000)}),{state:'READY'});
 assert.deepEqual(introductionDispatchDecision({nowMs:now,dueAt:at(now+10000)}),{state:'WAITING',remainingMs:10000});
});
test('an introduction overdue from yesterday is never automatically replayed',()=>{
 const d=introductionDispatchDecision({nowMs:now,dueAt:'2026-11-11T16:20:46.510Z'});
 assert.equal(d.state,'STALE_REVIEW');
 assert.equal(d.reason,'OUTDATED_REPLY');
 assert.ok(d.overdueMs>20*3600000);
});
test('intro replies for different clients cannot fire one second apart',()=>{
 const d=introductionDispatchDecision({nowMs:now,dueAt:at(now-4000),lastAttemptAt:at(now-1000)});
 assert.equal(d.state,'WAITING_CADENCE');
 assert.equal(d.remainingMs,INTRO_MIN_GAP_MS-1000);
});
test('stale check happens before cooldown; expired replies do not block fresh ones',()=>{
 const d=introductionDispatchDecision({nowMs:now,dueAt:at(now-INTRO_MAX_OVERDUE_MS-1),lastAttemptAt:at(now-1000)});
 assert.equal(d.state,'STALE_REVIEW');
 assert.equal(introductionDispatchDecision({nowMs:now,dueAt:at(now-10_000),lastAttemptAt:at(now-INTRO_MIN_GAP_MS)}).state,'READY');
});
test('missing due timestamp fails closed',()=>{
 assert.equal(introductionDispatchDecision({nowMs:now,dueAt:null}).state,'STALE_REVIEW');
});
