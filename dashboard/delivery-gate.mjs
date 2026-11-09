// Timing gate for consecutive approaches to verified, consent-eligible leads.
// A late, missed slot fails CLOSED; it is never made up by forced dispatch.
// Provider acknowledgements and actual handset delivery are outside this clock.
import {APPROACH_CADENCE,approachDueAt} from './approach-cadence.mjs';
import {daySP} from './radar.mjs';
export function evaluateDeliveryGate(clock={},at=Date.now()){
 const nowMs=Number(at);
 const lastMs=Math.max(Number(clock.last_attempt_ms)||0,Number(clock.last_finished_ms)||0);
 const intervalMs=Number(clock.interval_ms);
 if(!Number.isFinite(nowMs)||!Number.isFinite(intervalMs)||
    intervalMs<APPROACH_CADENCE.minSeconds*1000||
    intervalMs>APPROACH_CADENCE.maxSeconds*1000)return {status:'INVALID_CLOCK'};
 // A new business day has a fresh initial slot, gated by business hours.
 if(lastMs<=0||daySP(new Date(lastMs))!==daySP(new Date(nowMs)))return {status:'READY',firstOfDay:true};
 const earliest=Math.max(lastMs+APPROACH_CADENCE.minSeconds*1000,approachDueAt(clock));
 const latest=lastMs+APPROACH_CADENCE.maxSeconds*1000;
 if(nowMs<earliest)return {status:'WAITING',remainingMs:earliest-nowMs,earliest,latest};
 if(nowMs>latest)return {status:'WINDOW_MISSED',lateByMs:nowMs-latest,earliest,latest};
 return {status:'READY',earliest,latest,firstOfDay:false};
}
