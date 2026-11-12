// Owner-authorized live pair QA, without unpausing the production server.
// Run ONLY in an isolated Worker with a copy of env and the exact two connected
// Consecom sessions. No arbitrary destination, no retries after a provider ACK.
import {parentPort} from 'node:worker_threads';
import assert from 'node:assert/strict';
import {db,one,run,now,id,audit,addLead,addMessage,getThread,stage} from './db.mjs';
import {waSessionList,waRequest,waControlStatus,selectedWaSession} from './waakg-control.mjs';
import {bindLeadSession,isManagedSession} from './waakg-session-registry.mjs';
import {verifiedOwnerPhone,classifyContact} from './whatsapp-roles.mjs';
import {documentedOptIn} from './outreach-queue.mjs';
import {greetingForProspect,registerGreeting,routeIntroductionReply,tickIntroductions,WESLEY_INTRO,introductionStatus} from './prospecting-introduction.mjs';
import {approvedOwnerRecordingStatus} from './owner-approved-pitch.mjs';
import {ownerPitchStatus,tickOwnerPitch} from './owner-pitch-sequence.mjs';
import {flushInterestAlerts} from './groq-sales-automation.mjs';

const TRIAL='owner-wa-pair-7336-2994-20261111-v1';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const log=(event,detail={})=>console.log('[wa-pair-qa]',JSON.stringify({event,...detail}));
db.exec("CREATE TABLE IF NOT EXISTS owner_wa_pair_qa(trial TEXT PRIMARY KEY,status TEXT NOT NULL,step TEXT NOT NULL,lead_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
const save=(step,status='RUNNING')=>run("UPDATE owner_wa_pair_qa SET step=?,status=?,updated_at=? WHERE trial=?",step,status,now(),TRIAL);
async function waitFor(label,test,timeoutMs=30000){
 const end=Date.now()+timeoutMs;
 while(Date.now()<end){const result=await test();if(result)return result;await sleep(950);}
 throw Error('TIMEOUT_'+label);
}
async function runQa(){
 assert.equal(process.env.RUN_WA_PAIR_QA_ONCE,'true');
 assert.equal(process.env.QA_PARENT_PAUSED,'true');
 assert.equal(process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE,'false');
 assert.equal(process.env.PROSPECTOR_TENANT_ID||'','');
 const primary='consecom-principal';
 assert.equal(selectedWaSession(),primary,'PRIMARY_SESSION_MISMATCH');
 const pool=await waSessionList();
 const p=pool.items.find(x=>x.sessionId===primary);
 const candidates=pool.items.filter(x=>x.connected&&x.numberSuffix==='2994');
 if(!p?.connected||p.numberSuffix!=='7336'||candidates.length!==1)
  throw Error('TWO_SESSION_VERIFICATION_FAILED');
 const s=candidates[0];
 assert.ok(isManagedSession(primary)&&isManagedSession(s.sessionId));
 const pn=p.number,sn=s.number;
 if(!/^55\d{10,11}$/.test(pn||'')||!/^55\d{10,11}$/.test(sn||'')||pn===sn)
  throw Error('SESSION_PHONE_NOT_VERIFIED');
 if(verifiedOwnerPhone()!==pn)throw Error('OWNER_NUMBER_MISMATCH');
 const blocked=one('SELECT id FROM leads WHERE phone=?',sn);
 if(blocked)throw Error('SECONDARY_NUMBER_HAS_EXISTING_LEAD');
 if(one('SELECT phone FROM suppressions WHERE phone=?',sn))
  throw Error('SECONDARY_NUMBER_SUPPRESSED');
 if(String(process.env.PROSPECTOR_TEST_CONTACT_PHONE||'').replace(/\D/g,'')===sn)
  throw Error('SECONDARY_NUMBER_EXCLUDED_BY_TEST_SETTING');
 const original=approvedOwnerRecordingStatus();
 if(!original.ready)throw Error('ORIGINAL_WESLEY_AUDIO_UNAVAILABLE');
 const hooks=await waRequest('/api/webhooks/'+encodeURIComponent(primary));
 const exists=Array.isArray(hooks.data)&&hooks.data.some(h=>h.isActive!==false&&
  String(h.url||'').includes('/api/wa-akg/webhook')&&Array.isArray(h.events)&&h.events.includes('message.received'));
 if(!exists)throw Error('PRIMARY_WEBHOOK_NOT_CONFIGURED');
 log('PRECHECK_OK',{principal:'7336',clienteFicticio:'2994',originalAudioShaPrefix:original.sourceSha256.slice(0,12),
  sessionsConnected:pool.items.filter(x=>x.connected).length,otherContactsAllowed:false});
 const once=run("INSERT OR IGNORE INTO owner_wa_pair_qa(trial,status,step,created_at,updated_at) VALUES(?,'RUNNING','PRECHECK',?,?)",TRIAL,now(),now()).changes;
 if(!once){log('ALREADY_ATTEMPTED');return {status:'ALREADY_ATTEMPTED'};}
 // A local QA-only lead will never enter the real initial-outreach inventory.
 const contact=addLead({business:'TESTE INTERNO 2994 — Consecom',name:'Cliente fictício de teste',
  phone:sn,source:'WA_PAIR_QA',contact_permission:true,
  notes:'Teste controlado e autorizado pelo proprietário; nunca abordar automaticamente'}).lead;
 run("UPDATE leads SET stage='TEST_INTERNAL' WHERE id=?",contact.id);
 audit('CONSENT_UPDATED',contact.id,{permitted:true,
  evidence:'Proprietário autorizou expressamente teste WA real 7336 e 2994 em 11/11/2026',
  method:'OWNER_AUTHORIZED_TWO_CONNECTED_SESSIONS'});
 assert.equal(documentedOptIn(contact.id),true,'QA_OPTIN_NOT_RECORDABLE');
 bindLeadSession(contact.id,primary);
 const jid=sn+'@s.whatsapp.net',toOwner=pn+'@s.whatsapp.net',thread=getThread(contact.id,jid);
 const send=async(sid,to,message)=>{
  if(!((sid===primary&&to===jid)||(sid===s.sessionId&&to===toOwner)))
   throw Error('QA_DESTINATION_NOT_WHITELISTED');
  const res=await waRequest('/api/messages/'+encodeURIComponent(sid)+'/'+encodeURIComponent(to)+'/send',
   {method:'POST',data:{message:{text:message}}});
  if(res.status!==true)throw Error('QA_GATEWAY_NOT_ACKNOWLEDGED');
  return true;
 };
 const waitInbox=(body)=>waitFor('WEBHOOK_'+body.slice(0,12),()=>one(
  'SELECT * FROM waakg_inbox WHERE lead_id=? AND session_id=? AND body=? ORDER BY rowid DESC LIMIT 1',
  contact.id,primary,body),42000);
 const greeting=greetingForProspect(contact);
 const greetingId=id();
 save('SENDING_GREETING');
 await send(primary,jid,greeting);
 addMessage({threadId:thread.id,providerId:'prospect-queue:'+greetingId,
  direction:'out',body:greeting,status:'sent'});
 assert.equal(registerGreeting({leadId:contact.id,greetingId,sessionId:primary}),true);
 log('FIRST_MESSAGE_ACCEPTED',{from:'7336',to:'2994',body:greeting});
 const r1='Oi, tudo certo! Pode falar.';
 save('CUSTOMER_ANSWER_1');
 await send(s.sessionId,toOwner,r1);
 const in1=await waitInbox(r1);
 const first=routeIntroductionReply({leadId:contact.id,providerId:in1.provider_id,
  body:in1.body,inboxState:in1.state,receivedAt:in1.received_at});
 if(first.state!=='WAITING')throw Error('GREETING_REPLY_ROUTING_'+first.state);
 log('CUSTOMER_REPLY_RECEIVED',{from:'2994',to:'7336',introductionScheduled:true});
 // Preserve the actual 30-second delay rather than forging a due timestamp.
 save('WAITING_30_SECONDS');
 await waitFor('INTRODUCTION_DUE',()=>Date.parse(introductionStatus(contact.id)?.due_at||'')<=Date.now(),42000);
 const intro=await tickIntroductions({onlyLeadId:contact.id});
 if(intro.state!=='SENT')throw Error('WESLEY_TEXT_NOT_SENT_'+intro.state);
 assert.equal(one('SELECT body FROM messages WHERE provider_id=?','intro:'+greetingId)?.body,WESLEY_INTRO);
 log('WESLEY_INTRO_ACCEPTED',{to:'2994',originalText:true});
 const r2='Claro, pode mandar o áudio explicando a ideia.';
 save('CUSTOMER_PERMISSION');
 await send(s.sessionId,toOwner,r2);
 const in2=await waitInbox(r2);
 const permission=routeIntroductionReply({leadId:contact.id,providerId:in2.provider_id,
  body:in2.body,inboxState:in2.state,receivedAt:in2.received_at});
 if(permission.state!=='OWNER_AUDIO_QUEUED')throw Error('OWNER_AUDIO_NOT_QUEUED_'+permission.state);
 log('CUSTOMER_APPROVED_AUDIO',{from:'2994',to:'7336'});
 save('ORIGINAL_AUDIO');
 const voice=await tickOwnerPitch({onlyLeadId:contact.id});
 if(voice.state!=='AUDIO_ACCEPTED')throw Error('ORIGINAL_AUDIO_NOT_ACCEPTED_'+voice.state);
 assert.equal(ownerPitchStatus(contact.id).audio_sha256,original.sourceSha256);
 log('ORIGINAL_AUDIO_ACCEPTED',{to:'2994',shaPrefix:original.sourceSha256.slice(0,12),
  providerAcknowledged:true,deliveryOnPhoneUnverified:true});
 save('WAITING_FOLLOWUP_10_SECONDS');
 await waitFor('FOLLOWUP_DUE',()=>Date.parse(ownerPitchStatus(contact.id)?.due_at||'')<=Date.now(),18000);
 const followup=await tickOwnerPitch({onlyLeadId:contact.id});
 if(followup.state!=='DONE')throw Error('POST_AUDIO_TEXT_NOT_SENT_'+followup.state);
 log('AFTER_AUDIO_FOLLOWUP_ACCEPTED',{to:'2994',delaySeconds:10});
 const r3='Gostei da proposta! Quero conversar sobre o site e ver como ficaria.';
 save('CLIENT_INTEREST');
 await send(s.sessionId,toOwner,r3);
 await waitInbox(r3);
 await waitFor('INTEREST_HANDOFF',()=>one('SELECT stage FROM leads WHERE id=?',contact.id)?.stage==='INTERESTED'&&
  one('SELECT manual_takeover FROM threads WHERE id=?',thread.id)?.manual_takeover===1,18000);
 const notice=one("SELECT * FROM owner_notices WHERE lead_id=? AND kind='GROQ_HOT_LEAD' ORDER BY rowid DESC LIMIT 1",contact.id);
 if(!notice)throw Error('INTEREST_GROUP_NOTICE_MISSING');
 assert.ok(notice.message.includes('https://wa.me/')&&notice.message.includes('Empresa:')&&notice.message.includes('Nome:'));
 log('INTEREST_DETECTED',{ownerTookOver:true,noticeQueued:true});
 save('GROUP_NOTIFICATION');
 const count=await flushInterestAlerts({onlyLeadId:contact.id});
 const sent=one('SELECT status FROM owner_notices WHERE id=?',notice.id)?.status;
 if(sent!=='SENT')throw Error('GROUP_NOTICE_NOT_SENT_'+sent+'_'+count);
 log('GROUP_NOTICE_ACCEPTED',{group:'Meu Prospector',accepted:true});
 save('PASSED','DONE');
 return {status:'PASSED',steps:['two_connected','actual_greeting','customer_reply','30s_intro',
  'permission','original_audio','10s_followup','interest','human_takeover','group_notification'],
  realWhatsApp:true,otherRecipients:0,emergencyPauseForRealLeads:true,
  audioProviderAccepted:true,audioDeliveredToHandsetVerified:false,client:'2994',sales:'7336'};
}
let outcome;
try{outcome=await runQa();log('SUMMARY',outcome);parentPort?.postMessage(outcome);}
catch(error){
 const reason=String(error?.message||error).slice(0,160);
 try{save('FAILED_'+reason,'FAILED');}catch{}
 log('FAILED',{reason,otherContactsMessaged:0});
 parentPort?.postMessage({status:'FAILED',reason});
 process.exitCode=1;
}