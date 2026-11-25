// One-time daily limit increase requested by the owner. Does not alter
// queue eligibility, opt-out protections, WhatsApp policy or send cadence.
import {getSetting,setSetting,audit} from './db.mjs';
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


// One-time November 24 owner-approved increase: 80 -> 100 initial
// approaches per Sao Paulo calendar day. Never reset already counted sends,
// change the 90+ second cadence, or bypass contact/duplicate checks.
export const DAILY_100_MARKER='owner_daily_100_20261124_v1';
export function applyOwnerDailyLimit100(){
 if(process.env.PROSPECTOR_TENANT_ID&&process.env.PROSPECTOR_TENANT_INTERNAL!=='true')
  return {status:'OTHER_TENANT_UNCHANGED'};
 if(getSetting(DAILY_100_MARKER,false)===true)
  return {status:'ALREADY_APPLIED',dailyLimit:getSetting('daily_limit',100)};
 const previous=getSetting('daily_limit',80);
 setSetting('daily_limit',100);
 setSetting(DAILY_100_MARKER,true);
 audit('OWNER_DAILY_LIMIT_100',null,{previous,current:100,
  additionalCapacity:Math.max(0,100-Number(previous||0)),
  at:new Date().toISOString(),minSpacingSeconds:90,
  preservesPriorContacts:true,consentAndSuppressionUnchanged:true});
 return {status:'UPDATED',dailyLimit:100,previous,additionalCapacity:Math.max(0,100-Number(previous||0))};
}

export const DAILY_90_MARKER='owner_daily_90_20261125_v1';
export function applyOwnerDailyLimit90(){
 if(process.env.PROSPECTOR_TENANT_ID&&process.env.PROSPECTOR_TENANT_INTERNAL!=='true')return {status:'OTHER_TENANT_UNCHANGED'};
 const previous=getSetting('daily_limit',90);
 if(getSetting(DAILY_90_MARKER,false)===true)return {status:'ALREADY_APPLIED',dailyLimit:previous};
 setSetting('daily_limit',90);setSetting(DAILY_90_MARKER,true);
 audit('OWNER_DAILY_LIMIT_90',null,{previous,current:90,preservesPriorContacts:true});
 return {status:'UPDATED',previous,dailyLimit:90};
}
