// One-time owner-authorized restart. Never makes unconsented leads eligible.
// The Railway emergency stop always wins and existing opt-outs remain intact.
import {getSetting,setSetting,audit} from './db.mjs';
import {ownerProspectionPaused} from './prospection-pause.mjs';
export const OWNER_RESUME_MARKER='owner_approved_resume_20261109_two_senders_v3';
const LEGACY_RESUME_MARKER='owner_approved_resume_20261106_v1';
export function resumeOwnerApprovedProspecting(){
 const internal=!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true';
 if(!internal)return {status:'OTHER_TENANT_UNCHANGED'};
 // Owner authorized a fresh 2026-11-09 resume, contingent on strict dual-sender rotation.
 const approvedNow=process.env.PROSPECTOR_OWNER_RESUME_20261109_TWO_SENDERS==='true';
 const approvedLegacy=false; // Legacy resume flags may not re-open the newly paused owner campaign.
 if(!approvedNow&&!approvedLegacy)return {status:'NOT_AUTHORIZED_IN_DEPLOYMENT'};
 if(ownerProspectionPaused())return {status:'EMERGENCY_STOP_ACTIVE'};
 if(getSetting(OWNER_RESUME_MARKER,false))return {status:'ALREADY_APPLIED',paused:getSetting('paused',true)};
 // This changes scheduling only. Both senders and documented consent are still checked
 // when enrolling a prospect AND again immediately before WhatsApp transport.
 setSetting('paused',false);
 setSetting('autonomous_outreach_enabled',true);
 setSetting('sales_followup_enabled',true);
 // Keep old multi-step campaigns and bulk discovery off until separately approved.
 setSetting('auto_initial',false);
 setSetting('automation_enabled',false);
 setSetting(OWNER_RESUME_MARKER,true);
 audit('OWNER_APPROVED_RESUME_TWO_SENDERS_20261109',null,{approaches:true,followups:true,documentedOptInRequired:true,requiredSenders:2,strictRotation:true,legacyCampaigns:false,discoveryUnchanged:true,window:'08:00-17:30 America/Sao_Paulo',minSeconds:90});
 return {status:'RESUMED_WITH_CONSENT_GATES',paused:false,autonomousEnabled:true,legacyCampaigns:false,documentedOptInRequired:true};
}
