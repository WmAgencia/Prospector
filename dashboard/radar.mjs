// Indicadores reais do radar e orçamento de primeiras abordagens.
// Fuso America/Sao_Paulo: não usa UTC como substituto do dia local.
import {all,one,getSetting} from './db.mjs';
const ZONE='America/Sao_Paulo';
export const MAX_APPROACHES=200;
export const WINDOW_START=12;
export const WINDOW_END=18;
export const TARGET_INTERVAL_SECONDS=108;
export function daySP(input=new Date()){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(input).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
}
export function hourSP(input=new Date()){return Number(new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,hour:'2-digit',hourCycle:'h23'}).format(input));}
export function budgetConfig(){
 return {limit:Math.min(MAX_APPROACHES,Math.max(1,Number(getSetting('daily_limit',MAX_APPROACHES))||MAX_APPROACHES)),
 start:Number(getSetting('business_start',WINDOW_START)),end:Number(getSetting('business_end',WINDOW_END)),
 intervalSeconds:Math.max(1,Number(getSetting('initial_interval_seconds',TARGET_INTERVAL_SECONDS))||TARGET_INTERVAL_SECONDS)};
}
export function initialEvents(){
 return all("SELECT status,updated_at FROM jobs WHERE execution_id IS NOT NULL AND step_index=0 AND status IN ('SENT','UNKNOWN','SENDING') AND updated_at>=?",new Date(Date.now()-48*3600000).toISOString());
}
export function initialBudget(input=new Date(),events=null,config=null){
 const settings=config||budgetConfig(),day=daySP(input);
 const today=(events||initialEvents()).filter(j=>Number.isFinite(Date.parse(j.updated_at))&&daySP(new Date(j.updated_at))===day);
 const confirmed=today.filter(x=>x.status==='SENT').length;
 const uncertain=today.filter(x=>x.status==='UNKNOWN').length;
 const sending=today.filter(x=>x.status==='SENDING').length;
 const counted=confirmed+uncertain+sending;
 const latest=today.reduce((v,j)=>Math.max(v,Date.parse(j.updated_at)||0),0);
 return {day,limit:settings.limit,confirmed,uncertain,sending,counted,remaining:Math.max(0,settings.limit-counted),
  start:settings.start,end:settings.end,intervalSeconds:settings.intervalSeconds,
  nextAt:latest?new Date(latest+settings.intervalSeconds*1000).toISOString():null,
  percent:Math.min(100,100*counted/settings.limit)};
}
export function canSendInitial(input=new Date(),events=null,config=null){
 if(getSetting('paused',true))return false;
 const budget=initialBudget(input,events,config);
 const currentHour=hourSP(input);
 if(currentHour<budget.start||currentHour>=budget.end||budget.start>=budget.end)return false;
 if(budget.counted>=budget.limit)return false;
 if(budget.nextAt&&Date.parse(budget.nextAt)>input.getTime())return false;
 return true;
}
export function radarSnapshot(input=new Date()){
 const budget=initialBudget(input);
 const threshold=new Date(input.getTime()-48*3600000).toISOString();
 const recent=all('SELECT id,business,source,segment,city,created_at FROM leads WHERE created_at>=? ORDER BY created_at DESC LIMIT 1600',threshold);
 const foundToday=recent.filter(l=>daySP(new Date(l.created_at))===budget.day);
 const history=all('SELECT query,found,status,at,details FROM discoveries WHERE at>=? ORDER BY at DESC LIMIT 100',threshold);
 const todayRuns=history.filter(x=>daySP(new Date(x.at))===budget.day);
 const examined=todayRuns.reduce((v,r)=>{try{return v+(Number(JSON.parse(r.details||'{}').examined)||0);}catch{return v;}},0);
 const scanned=history.some(x=>x.status==='RUNNING');
 return {asOf:input.toISOString(),...budget,foundToday:foundToday.length,foundTotal:one('SELECT COUNT(*) AS n FROM leads')?.n||0,
  examinedToday:examined,searchesToday:todayRuns.length,searchInProgress:scanned,
  lastSearch:history[0]?{query:history[0].query,status:history[0].status,at:history[0].at}:null,
  recentFinds:foundToday.slice(0,28).map(x=>({id:x.id,name:x.business,source:x.source,segment:x.segment,city:x.city})),
  qualifiedForReview:one("SELECT COUNT(*) AS n FROM leads WHERE stage='DISCOVERED' AND (website_status='NO_WEBSITE' OR website_status='NOT_FOUND_AFTER_CHECK')")?.n||0,
  approvedForContact:one("SELECT COUNT(*) AS n FROM leads l WHERE l.contact_permission=1 AND l.phone IS NOT NULL AND l.stage='DISCOVERED' AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.phone=l.phone)")?.n||0};
}
