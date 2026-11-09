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
