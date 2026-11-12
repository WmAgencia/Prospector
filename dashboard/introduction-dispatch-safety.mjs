// First follow-up after a greeting: never replay hours-old customer replies on restart.
export const INTRO_MAX_OVERDUE_MS=15*60_000;
export const INTRO_MIN_GAP_MS=90_000;
export function introductionDispatchDecision({nowMs=Date.now(),dueAt,lastAttemptAt=null}={}){
 const due=Date.parse(dueAt||'');
 if(!Number.isFinite(nowMs)||!Number.isFinite(due))
  return {state:'STALE_REVIEW',reason:'INVALID_DUE_TIME'};
 if(nowMs-due>INTRO_MAX_OVERDUE_MS)
  return {state:'STALE_REVIEW',reason:'OUTDATED_REPLY',overdueMs:nowMs-due};
 if(nowMs<due)return {state:'WAITING',remainingMs:due-nowMs};
 const last=Date.parse(lastAttemptAt||'');
 if(Number.isFinite(last)&&nowMs-last<INTRO_MIN_GAP_MS)
  return {state:'WAITING_CADENCE',remainingMs:Math.max(0,INTRO_MIN_GAP_MS-(nowMs-last))};
 return {state:'READY'};
}
