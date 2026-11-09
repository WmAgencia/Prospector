// One-time activation requested by the owner on 2026-11-09.
// Enables only the consent-gated autonomous queue for the primary workspace.
// Does not start the legacy campaign, send messages, change recipient consent,
// or activate this mode for unrelated tenant databases.
import {getSetting,setSetting,audit} from './db.mjs';

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


export const DAILY_250_MARKER='owner_daily_250_20261109_v1';
export function apply250DailyLimit(){
 if(process.env.PROSPECTOR_TENANT_ID&&process.env.PROSPECTOR_TENANT_INTERNAL!=='true')
  return {status:'OTHER_TENANT_UNCHANGED'};
 if(getSetting(DAILY_250_MARKER,false)===true)
  return {status:'ALREADY_APPLIED',dailyLimit:getSetting('daily_limit',150)};
 const previous=getSetting('daily_limit',150);
 setSetting('daily_limit',250);
 setSetting(DAILY_250_MARKER,true);
 audit('OWNER_DAILY_LIMIT_250',null,{previous,current:250,
  at:new Date().toISOString(),minSpacingSeconds:90,consentRequired:true});
 return {status:'UPDATED',dailyLimit:250,previous};
}
