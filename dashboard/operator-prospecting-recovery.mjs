// One-time, explicitly requested recovery after the 2026-11-03 outage.
// This only turns on research and a safe operator queue. It NEVER enrolls
// scraped contacts for automated sending or silently chooses a campaign.
import {one,getSetting,setSetting,audit} from './db.mjs';
import {validateCampaignForActivation} from './campaign-selection.mjs';

const MARKER='prospector_nov03_operator_activation_v1';
export function activateRequestedProspecting(){
 if(getSetting(MARKER,false))return {status:'ALREADY_APPLIED',paused:getSetting('paused',true),
  discoveryEnabled:getSetting('discovery_auto_enabled',false)};
 // Search only uses public business records and never sends WhatsApp messages.
 setSetting('discovery_auto_enabled',true);
 const sources=getSetting('discovery_sources',{})||{};
 setSetting('discovery_sources',{...sources,osm:true});
 setSetting('automation_enabled',true);
 setSetting('initial_interval_seconds',90);
 setSetting('business_start',8);
 setSetting('business_end',18);
 const selected=String(getSetting('autonomous_campaign_id','')||'');
 let outbound='WAITING_OPERATOR_SELECTION',campaignId=null;
 if(selected){
  const workflow=one('SELECT * FROM workflows WHERE id=? AND enabled=1',selected);
  try{
   validateCampaignForActivation(workflow);
   setSetting('paused',false);
   setSetting('auto_initial',true);
   outbound='SELECTED_CAMPAIGN_VALID';
   campaignId=selected;
  }catch{
   // Never use an incomplete campaign (especially missing audio/video).
   setSetting('paused',true);
   setSetting('auto_initial',false);
   outbound='WAITING_VALID_CAMPAIGN';
  }
 }else{
  setSetting('paused',true);
  setSetting('auto_initial',false);
 }
 setSetting(MARKER,true);
 audit('OPERATOR_REQUESTED_PROSPECTING_RECOVERY',null,{discovery:true,cadenceSeconds:90,outbound,campaignId});
 return {status:'ACTIVATED_RESEARCH',discoveryEnabled:true,cadenceSeconds:90,outbound,
  paused:getSetting('paused',true),campaignId};
}
