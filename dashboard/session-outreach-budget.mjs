// Rest cycles were removed by operator request. Preserve historical data;
// neither old counters nor old deadlines may block the continuous cadence.
import {db} from './db.mjs';
export const OUTREACH_SESSION_LIMIT=null;
export const OUTREACH_SESSION_REST_MS=0;
db.exec('CREATE TABLE IF NOT EXISTS session_outreach_budget(session_id TEXT PRIMARY KEY,confirmed INTEGER NOT NULL DEFAULT 0,cooldown_until INTEGER NOT NULL DEFAULT 0)');
db.exec('CREATE TABLE IF NOT EXISTS session_outreach_receipts(item_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,confirmed_at INTEGER NOT NULL)');
export function sessionOutreachBudget(){
 return {enabled:false,approachesInCycle:0,cycleLimit:null,cooling:false,cooldownUntil:null,restSeconds:0};
}
export const sessionCanApproach=()=>true;
export const recordApproachConfirmation=()=>false;
