import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateDeliveryGate} from '../dashboard/delivery-gate.mjs';

const last=Date.parse('2026-11-09T12:00:00Z');
const clock={last_attempt_ms:last,last_finished_ms:last,interval_ms:100000};
test('hold dispatch before the chosen 100-second window',()=>{
 const a=evaluateDeliveryGate(clock,last+90000);
 assert.equal(a.status,'WAITING');
 assert.equal(a.remainingMs,10000);
});
test('allow a queued authorized dispatch within the selected 90-110s window',()=>{
 assert.equal(evaluateDeliveryGate(clock,last+100000).status,'READY');
 assert.equal(evaluateDeliveryGate(clock,last+110000).status,'READY');
});
test('never force a late send after the 110-second window',()=>{
 const late=evaluateDeliveryGate(clock,last+110001);
 assert.equal(late.status,'WINDOW_MISSED');
 assert.equal(late.lateByMs,1);
});
test('first dispatch of the following business day has no stale 110-second deadline',()=>{
 assert.equal(evaluateDeliveryGate(clock,Date.parse('2026-11-10T12:00:00Z')).status,'READY');
});
test('invalid persisted interval blocks sending',()=>{
 assert.equal(evaluateDeliveryGate({...clock,interval_ms:180000},last+100000).status,'INVALID_CLOCK');
});
