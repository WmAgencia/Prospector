// One-time operator handoff recovery when a native WhatsApp send predates
// message.sent webhook subscription. Requires the exact sender and recipient
// suffixes supplied by the operator, and a single pre-existing CRM thread.
import {all,getSetting,setSetting,audit} from './db.mjs';
import {leadSession} from './waakg-session-registry.mjs';
import {waControlStatus} from './waakg-control.mjs';
import {takeover} from './runtime.mjs';

export async function recoverPreWebhookManualChat(){
 const sender=String(process.env.PROSPECTOR_OWNER_RECOVERY_FROM_SUFFIX||'');
 const recipient=String(process.env.PROSPECTOR_OWNER_RECOVERY_TO_SUFFIX||'');
 if(!/^\d{4}$/.test(sender)||!/^\d{4}$/.test(recipient))return {status:'DISABLED'};
 const marker='owner_native_manual_claim_20261116_'+sender+'_'+recipient;
 if(getSetting(marker,false)===true)return {status:'ALREADY_APPLIED',recipientSuffix:recipient};
 const matches=all("SELECT t.id AS thread_id,l.id AS lead_id,t.manual_takeover FROM threads t JOIN leads l ON l.id=t.lead_id WHERE substr(l.phone,-4)=? LIMIT 3",recipient);
 if(matches.length!==1)return {status:'NOT_UNIQUE_OR_MISSING',matchCount:matches.length,recipientSuffix:recipient};
 const {thread_id,lead_id,manual_takeover}=matches[0];
 const status=await waControlStatus(leadSession(lead_id));
 if(!status.connected||status.numberSuffix!==sender)return {status:'SENDER_SESSION_MISMATCH',recipientSuffix:recipient};
 if(manual_takeover!==1)takeover(thread_id,true);
 setSetting(marker,true);
 audit('OWNER_PRE_WEBHOOK_MANUAL_CLAIM',lead_id,{senderSuffix:sender,recipientSuffix:recipient,alreadyManual:manual_takeover===1});
 return {status:manual_takeover===1?'ALREADY_MANUAL':'CLAIMED',recipientSuffix:recipient};
}
