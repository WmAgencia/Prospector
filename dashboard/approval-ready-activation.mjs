// One-time activation requested by the owner on 2026-11-09.
// Enables only the consent-gated autonomous queue for the primary workspace.
// Does not start the legacy campaign, send messages, change recipient consent,
// or activate this mode for unrelated tenant databases.
import {getSetting,setSetting,audit} from './db.mjs';
import {OWNER_APPROACH_INTERVAL_MS,isConsecomOwner} from './approach-cadence.mjs';

export const APPROVAL_READY_MARKER='approval_ready_outreach_20261109_v1';

export function armApprovedOutreach(){
 if(process.env.PROSPECTOR_TENANT_ID&&process.env.PROSPECTOR_TENANT_INTERNAL!=='true')
  return {status:'OTHER_TENANT_UNCHANGED'};
 if(process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE==='true')
  return {status:'EMERGENCY_STOP_ACTIVE'};
 if(getSetting(APPROVAL_READY_MARKER,false)===true)
  return {status:'ALREADY_APPLIED',paused:getSetting('paused',true),
   autonomous:getSetting('autonomous_outreach_enabled',false),
   discovery:getSetting('discovery_auto_enabled',false)};
 const controls={
  paused:false,
  autonomous_outreach_enabled:true,
  discovery_auto_enabled:true,
  cold_first_approach_enabled:false,
  auto_initial:false,
  automation_enabled:false
 };
 const previous={};
 for(const [key,value] of Object.entries(controls)){
  previous[key]=getSetting(key);
  setSetting(key,value);
 }
 setSetting(APPROVAL_READY_MARKER,true);
 audit('APPROVAL_READY_OUTREACH_ARMED',null,{
  previous,controls,ownerRequestedAt:'2026-11-09',
  requiresRecordedConsent:true,unsolicitedColdApproach:false,
  legacyAutoCampaign:false,window:'08:00-17:30 America/Sao_Paulo',
  beginsWhenApprovedAndEligible:true
 });
 return {status:'READY_FOR_APPROVED_LEADS',paused:false,
  autonomous:true,discovery:true,requiresRecordedConsent:true};
}


// Owner-only limit, shared by all connected WhatsApp numbers. Does not
// reactivate outreach or modify consent, cadence, campaigns or tenant limits.
export const OWNER_DAILY_LIMIT=80;
export const DAILY_80_MARKER='owner_daily_80_20261110_v1';
export function apply80DailyLimit(){
 if(process.env.PROSPECTOR_TENANT_ID&&process.env.PROSPECTOR_TENANT_INTERNAL!=='true')
  return {status:'OTHER_TENANT_UNCHANGED'};
 const previous=getSetting('daily_limit',150);
 if(getSetting(DAILY_80_MARKER,false)===true)
  return {status:'ALREADY_APPLIED',dailyLimit:previous};
 setSetting('daily_limit',OWNER_DAILY_LIMIT);
 setSetting(DAILY_80_MARKER,true);
 audit('OWNER_DAILY_LIMIT_80',null,{previous,current:OWNER_DAILY_LIMIT,
  at:new Date().toISOString(),allConnectedNumbers:true,requiresRecordedConsent:true});
 return {status:'UPDATED',dailyLimit:OWNER_DAILY_LIMIT,previous};
}

// One-time scoped migration to match the owner's explicit 08:00–17:40
// distribution. Does NOT enable outreach, reconnect WhatsApp or relax consent.
export const OWNER_DAILY_SPREAD_MARKER='owner_daily_80_spread_0800_1740_20261111_v1';
export function applyOwnerDailySpread(){
 if(!isConsecomOwner())return {status:'OTHER_TENANT_UNCHANGED'};
 if(getSetting(OWNER_DAILY_SPREAD_MARKER,false)===true)
  return {status:'ALREADY_APPLIED',window:getSetting('client_outreach_hours',null)};
 const previousHours=getSetting('client_outreach_hours',null);
 const previousInterval=getSetting('initial_interval_seconds',null);
 const newHours={start:'08:00',end:'17:40'};
 setSetting('client_outreach_hours',newHours);
 setSetting('initial_interval_seconds',OWNER_APPROACH_INTERVAL_MS/1000);
 setSetting(OWNER_DAILY_SPREAD_MARKER,true);
 audit('OWNER_80_EVEN_SCHEDULE',null,{previousHours,previousInterval,
  window:newHours,maxFirstApproaches:80,minimumGapSeconds:OWNER_APPROACH_INTERVAL_MS/1000,
  noAutoStart:true,allConnectedNumbers:true});
 return {status:'UPDATED',window:newHours,intervalSeconds:OWNER_APPROACH_INTERVAL_MS/1000,
  maximumFirstApproachesPerDay:80,paused:getSetting('paused',true)};
}
