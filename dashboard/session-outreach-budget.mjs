// Real, persistent volume limits. Never generates messages or synthetic traffic.
import {db,one,run,tx} from './db.mjs';
export const OUTREACH_SESSION_LIMIT=20;
export const OUTREACH_SESSION_REST_MS=900000;
db.exec('CREATE TABLE IF NOT EXISTS session_outreach_budget(session_id TEXT PRIMARY KEY,confirmed INTEGER NOT NULL DEFAULT 0,cooldown_until INTEGER NOT NULL DEFAULT 0)');
db.exec('CREATE TABLE IF NOT EXISTS session_outreach_receipts(item_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,confirmed_at INTEGER NOT NULL)');
export function sessionOutreachBudget(sessionId,at=Date.now()){
 const row=one('SELECT * FROM session_outreach_budget WHERE session_id=?',sessionId);
 const until=row?.cooldown_until||0,cooling=until>at;
 return {approachesInCycle:until&&!cooling?0:row?.confirmed||0,cycleLimit:OUTREACH_SESSION_LIMIT,cooling,
  cooldownUntil:cooling?new Date(until).toISOString():null,restSeconds:OUTREACH_SESSION_REST_MS/1000};
}
export const sessionCanApproach=(sessionId,at=Date.now())=>!sessionOutreachBudget(sessionId,at).cooling;
export function recordApproachConfirmation(sessionId,itemId,at=Date.now()){
 return tx(()=>{
  if(!run('INSERT OR IGNORE INTO session_outreach_receipts(item_id,session_id,confirmed_at) VALUES(?,?,?)',itemId,sessionId,at).changes)return false;
  const row=one('SELECT * FROM session_outreach_budget WHERE session_id=?',sessionId);
  const previous=row?.cooldown_until&&row.cooldown_until<=at?0:row?.confirmed||0;
  const confirmed=previous+1,until=confirmed>=OUTREACH_SESSION_LIMIT?at+OUTREACH_SESSION_REST_MS:0;
  run('INSERT INTO session_outreach_budget(session_id,confirmed,cooldown_until) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET confirmed=excluded.confirmed,cooldown_until=excluded.cooldown_until',sessionId,confirmed,until);
  return true;
 });
}
