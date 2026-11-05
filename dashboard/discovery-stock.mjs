// Read-only inventory of unapproached business contacts for one isolated workspace.
// A contact here is a candidate, NOT proof of WhatsApp marketing consent.
import {all,getSetting} from './db.mjs';
import {recontactDecision} from './prospecting-recontact.mjs';
import {availableApproachCredits} from './tenant-credits.mjs';

export const DEFAULT_STOCK_TARGET=250;

const normalized=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export const identityKey=lead=>lead?.city&&lead?.business?normalized(lead.city)+'|'+normalized(lead.business):'';

export function replenishmentPlan({target=DEFAULT_STOCK_TARGET,ready=0,credits=null}={}){
 const stockTarget=Math.max(0,Math.min(250,Math.trunc(Number(target)||0)));
 const available=Math.max(0,Math.trunc(Number(ready)||0));
 // null = unlimited internal account; zero = real depleted customer wallet.
 const limit=credits===null?stockTarget:Math.max(0,Math.min(stockTarget,Math.trunc(Number(credits)||0)));
 return {target:stockTarget,ready:available,credits, fundedTarget:limit,
  missing:Math.max(0,limit-available),full:available>=limit};
}

export function discoveryStockSnapshot(at=new Date(),{target=getSetting('discovery_stock_target',DEFAULT_STOCK_TARGET),credits=availableApproachCredits()}={}){
 const seenPhones=new Set(),seenBusinesses=new Set();
 const rows=all("SELECT id,business,city,phone,stage FROM leads WHERE stage='DISCOVERED' AND phone IS NOT NULL ORDER BY created_at ASC LIMIT 20000");
 let ready=0,duplicates=0;
 for(const lead of rows){
  if(!recontactDecision(lead,at.getTime()).eligible)continue;
  const number=String(lead.phone||'').replace(/\D/g,'');
  if(number.length<12||number.length>15)continue;
  const key=identityKey(lead);
  if(seenPhones.has(number)||(key&&seenBusinesses.has(key))){duplicates++;continue;}
  seenPhones.add(number);if(key)seenBusinesses.add(key);ready++;
 }
 return {...replenishmentPlan({target,ready,credits}),duplicates,asOf:at.toISOString(),
  definition:'uncontacted-business-phone-not-suppressed',permissionNotImplied:true};
}
