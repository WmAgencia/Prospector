import {all,one} from './db.mjs';
import {daySP} from './radar.mjs';
export const DAILY_APPROACH_LIMIT=250;
export function dailyApproachBudget(at=new Date()){
 const day=daySP(at),since=new Date(at.getTime()-48*3600000).toISOString();
 const events=all("SELECT lead_id,status,updated_at AS at FROM jobs WHERE execution_id IS NOT NULL AND step_index=0 AND status IN ('SENT','UNKNOWN','SENDING') AND updated_at>=?",since);
 if(one("SELECT 1 FROM sqlite_master WHERE name='prospecting_batch_items'"))events.push(...all("SELECT lead_id,status,attempt_at AS at FROM prospecting_batch_items WHERE status IN ('SENT','UNKNOWN','SENDING') AND attempt_at>=?",since));
 const counted=new Set(events.filter(x=>x.at&&daySP(new Date(x.at))===day).map(x=>x.lead_id)).size;
 return {day,limit:DAILY_APPROACH_LIMIT,counted,remaining:Math.max(0,DAILY_APPROACH_LIMIT-counted),scope:'all_connected_numbers'};
}
