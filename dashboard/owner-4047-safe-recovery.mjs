// Exact single-contact recovery after a business auto-responder caused a
// cancelled introduction. Never resends an uncertain message or broadcasts.
import {one,run,now,audit,getSetting,setSetting} from './db.mjs';
import {conversationAuthorized} from './operator-outreach.mjs';
import {conversationFinished} from './prospect-terminal-conversation.mjs';
import {boundLeadSession,isManagedSession} from './waakg-session-registry.mjs';
import {classifyContact} from './whatsapp-roles.mjs';
import {detectAutomaticReply} from './portfolio-offer-550.mjs';
import {waRequest} from './waakg-control.mjs';
const TARGET='5511948384047';
const SESSION='prospector-f5997b3d-687c-4d31-9878-d416369ad45a';
const MARKER='owner_4047_human_reply_recovered_20261112_v1';
const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z ]/g,' ').replace(/\s+/g,' ').trim();

export async function recoverLuciana4047({request=waRequest}={}){
 if(process.env.PROSPECTOR_TENANT_ID)return {state:'OTHER_TENANT'};
 if(process.env.RUN_OWNER_4047_RECOVER_ONCE!=='true')return {state:'DISABLED'};
 if(process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE==='true'||getSetting('paused',false)===true)return {state:'PAUSED'};
 if(getSetting(MARKER,false))return {state:'ALREADY_RECOVERED'};
 const count=one('SELECT COUNT(*) n FROM leads WHERE phone=?',TARGET)?.n||0;
 if(count!==1)return {state:'CONTACT_NOT_FOUND_OR_AMBIGUOUS',count};
 const lead=one('SELECT id,phone,stage,contact_permission FROM leads WHERE phone=?',TARGET);
 const intro=one('SELECT stage,reason,session_id,attempt_at,sent_at,updated_at FROM prospecting_introductions WHERE lead_id=?',lead.id);
 if(!intro||intro.stage!=='CANCELLED'||intro.reason!=='ELIGIBILITY_CHANGED'||
    intro.session_id!==SESSION||intro.attempt_at||intro.sent_at)
  return {state:'INTRO_NOT_SAFELY_REOPENABLE',introStage:intro?.stage||null,reason:intro?.reason||null};
 if(boundLeadSession(lead.id)!==SESSION||!isManagedSession(SESSION)||
    classifyContact({jid:TARGET+'@s.whatsapp.net',sessionId:SESSION}).role!=='PROSPECT_APPROACHED'||
    lead.contact_permission!==1||!conversationAuthorized(lead.id)||
    conversationFinished(lead.id,SESSION)||
    one('SELECT 1 FROM suppressions WHERE phone=?',TARGET)||
    one('SELECT 1 FROM threads WHERE lead_id=? AND manual_takeover=1',lead.id))
  return {state:'CONTACT_NOT_ELIGIBLE'};
 const last=one("SELECT provider_id,body,state,received_at,session_id FROM waakg_inbox WHERE lead_id=? ORDER BY rowid DESC LIMIT 1",lead.id);
 if(!last||last.state!=='REVIEW'||last.session_id!==SESSION||
    clean(last.body)!=='ola boa tarde tudo bem'||detectAutomaticReply(last.body))
  return {state:'LATEST_INBOUND_CHANGED_REVIEW'};
 const age=Date.now()-Date.parse(last.received_at);
 if(!Number.isFinite(age)||age<0||age>6*60*60*1000)return {state:'INBOUND_TOO_OLD_REVIEW'};
 const outbound=one("SELECT 1 FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.lead_id=? AND m.direction='out' AND m.at>=? LIMIT 1",lead.id,last.received_at);
 if(outbound)return {state:'ALREADY_ANSWERED_LOCALLY'};
 let remote=[];
 try{
  const r=await request('/api/chat/'+encodeURIComponent(SESSION)+'/'+encodeURIComponent(TARGET+'@s.whatsapp.net'));
  remote=Array.isArray(r.data)?r.data:[];
 }catch(e){return {state:'PROVIDER_NOT_VERIFIABLE',reason:String(e.message).slice(0,90)}}
 if(!remote.length||remote.at(-1)?.fromMe!==false)return {state:'PROVIDER_LATEST_NOT_INBOUND_REVIEW'};
 // Do not claim delivery or send to provider here; the standard introduction
 // worker will send the existing approved Wesley script to this one lead.
 const changed=run("UPDATE prospecting_introductions SET stage='WAITING',reason='OWNER_4047_EXPLICIT_RECOVERY',first_reply_id=?,first_reply_at=?,due_at=?,updated_at=? WHERE lead_id=? AND stage='CANCELLED' AND reason='ELIGIBILITY_CHANGED' AND attempt_at IS NULL AND sent_at IS NULL",
  last.provider_id,last.received_at,now(),now(),lead.id).changes;
 if(!changed)return {state:'RACE_STATE_CHANGED'};
 setSetting(MARKER,true);
 audit('OWNER_4047_HUMAN_REPLY_RECOVERED',lead.id,{sessionSuffix:'2994',targetSuffix:'4047',
  previouslyCancelledBy:'ELIGIBILITY_CHANGED',providerHistoryChecked:true,noOutboundAfterHuman:true});
 return {state:'REQUEUED_INTRODUCTION',leadId:lead.id,contactSuffix:'4047',sessionSuffix:'2994'};
}
