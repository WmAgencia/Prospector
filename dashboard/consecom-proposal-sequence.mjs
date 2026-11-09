// Consecom: one WhatsApp message per approved block; internal newlines are preserved.
// The prospecting pause, consent, opt-outs and manual handoff take precedence.
// Network sends are reserved before transport; uncertain results are NEVER retried.
import {db,one,run,now,addMessage,audit} from './db.mjs';
import {ownerProspectionPaused} from './prospection-pause.mjs';
import {coldOutreachSwitchEnabled} from './cold-outreach-switch.mjs';
import {documentedOptIn} from './outreach-queue.mjs';
import {operatorOffer,conversationAuthorized} from './operator-outreach.mjs';
import {leadSession,isManagedSession} from './waakg-session-registry.mjs';
import {waControlStatus,waRequest} from './waakg-control.mjs';
import {PROPOSAL_TEXT_VERSION,PROPOSAL_MESSAGES,proposalTypingDelayMs,proposalCopyIsCurrent} from './consecom-proposal-copy.mjs';

export const proposalSequenceEnabled=()=>!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true';
const halted=()=>!coldOutreachSwitchEnabled()||ownerProspectionPaused()||requirePaused();
function requirePaused(){return (one("SELECT value FROM settings WHERE key='paused'")?.value||'true')==='true';}
db.exec(`CREATE TABLE IF NOT EXISTS consecom_proposal_sequences(
 lead_id TEXT PRIMARY KEY REFERENCES leads(id),session_id TEXT NOT NULL,phone TEXT NOT NULL,
 thread_id TEXT NOT NULL,intro_provider_id TEXT NOT NULL,intro_sent_at TEXT NOT NULL,
 version TEXT NOT NULL,next_index INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL CHECK(state IN ('WAITING','SENDING','DONE','UNKNOWN','CANCELLED')),
 due_at TEXT NOT NULL,last_presence_at TEXT,reason TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
)`);
if(!db.prepare('PRAGMA table_info(consecom_proposal_sequences)').all().some(c=>c.name==='typing_started_at'))
 db.exec('ALTER TABLE consecom_proposal_sequences ADD COLUMN typing_started_at TEXT');
run("UPDATE consecom_proposal_sequences SET state='UNKNOWN',reason='PROCESS_INTERRUPTED_CHECK_WHATSAPP',updated_at=? WHERE state='SENDING'",now());

export function scheduleConsecomProposalAfterIntro({leadId,sessionId,phone,threadId,firstReplyId}={}){
 if(!proposalSequenceEnabled()||halted())return {state:'DISABLED_OR_PAUSED'};
 if(!proposalCopyIsCurrent())return {state:'DATE_DEPENDENT_COPY_EXPIRED'};
 if(!leadId||!sessionId||!phone||!threadId||!firstReplyId)return {state:'MISSING_CONTEXT'};
 if(!documentedOptIn(leadId)||operatorOffer(leadId)!=='portfolio'||!conversationAuthorized(leadId))return {state:'NO_AUTHORIZATION'};
 const intro=one('SELECT stage,session_id,phone,first_reply_id,sent_at FROM prospecting_introductions WHERE lead_id=?',leadId);
 if(intro?.stage!=='SENT'||intro.session_id!==sessionId||intro.phone!==phone||
    intro.first_reply_id!==firstReplyId||!intro.sent_at)return {state:'INTRO_NOT_CONFIRMED'};
 const at=now(),due=at; // The fixed delay starts only after WhatsApp accepts 'composing'.
 const result=run("INSERT OR IGNORE INTO consecom_proposal_sequences(lead_id,session_id,phone,thread_id,intro_provider_id,intro_sent_at,version,next_index,state,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,0,'WAITING',?,?,?)",
  leadId,sessionId,phone,threadId,firstReplyId,intro.sent_at,PROPOSAL_TEXT_VERSION,due,at,at);
 if(!result.changes)return {state:'ALREADY_QUEUED'};
 audit('CONSECOM_PROPOSAL_TEXT_SCHEDULED',leadId,{version:PROPOSAL_TEXT_VERSION,parts:PROPOSAL_MESSAGES.length});
 return {state:'WAITING',parts:PROPOSAL_MESSAGES.length};
}

function currentSequence(row){
 if(halted())return {ok:false,reason:'PAUSED'};
 if(!proposalSequenceEnabled())return {ok:false,reason:'TENANT_NOT_ALLOWED'};
 if(row.version!==PROPOSAL_TEXT_VERSION)return {ok:false,reason:'OUTDATED_VERSION'};
 if(!proposalCopyIsCurrent())return {ok:false,reason:'DATE_DEPENDENT_COPY_EXPIRED'};
 const intro=one('SELECT stage,session_id,phone,first_reply_id,sent_at FROM prospecting_introductions WHERE lead_id=?',row.lead_id);
 if(!intro||intro.stage!=='SENT'||intro.sent_at!==row.intro_sent_at||
    intro.first_reply_id!==row.intro_provider_id||intro.session_id!==row.session_id||
    intro.phone!==row.phone)return {ok:false,reason:'INTRO_OR_CONVERSATION_CHANGED'};
 const lead=one("SELECT phone,stage FROM leads WHERE id=?",row.lead_id);
 const thread=one("SELECT id,manual_takeover FROM threads WHERE lead_id=?",row.lead_id);
 if(!lead||lead.phone!==row.phone||!thread||thread.id!==row.thread_id||thread.manual_takeover===1||
    ['NO_INTEREST','INTERESTED','CLOSED_WON'].includes(lead.stage))return {ok:false,reason:'LEAD_OR_HUMAN_CHANGED'};
 if(!isManagedSession(row.session_id)||leadSession(row.lead_id)!==row.session_id||
    !documentedOptIn(row.lead_id)||operatorOffer(row.lead_id)!=='portfolio'||
    !conversationAuthorized(row.lead_id)||one('SELECT 1 FROM suppressions WHERE phone=?',row.phone))
  return {ok:false,reason:'NOT_AUTHORIZED'};
 const jid=row.phone+'@s.whatsapp.net';
 if(one('SELECT 1 FROM waakg_inbox WHERE jid=? AND received_at>? LIMIT 1',jid,row.intro_sent_at))
  return {ok:false,reason:'CUSTOMER_REPLIED'};
 if(one("SELECT 1 FROM messages WHERE thread_id=? AND direction='out' AND at>? AND provider_id NOT LIKE 'consecom-proposal-text:%' AND provider_id NOT LIKE 'intro:%' LIMIT 1",
     row.thread_id,row.intro_sent_at))
  return {ok:false,reason:'OTHER_OUTBOUND_SENT'};
 return {ok:true,jid};
}
let workerBusy=false;
export async function tickConsecomProposalSequence({clock=Date.now,presence=waRequest,send=waRequest,status=waControlStatus}={}){
 if(workerBusy||halted())return {state:halted()?'PAUSED':'BUSY'};
 workerBusy=true;
 try{
  const row=one("SELECT * FROM consecom_proposal_sequences WHERE state='WAITING' ORDER BY created_at LIMIT 1");
  if(!row)return {state:'IDLE'};
  const current=currentSequence(row);
  if(!current.ok){
   run("UPDATE consecom_proposal_sequences SET state='CANCELLED',reason=?,updated_at=? WHERE lead_id=? AND state='WAITING'",current.reason,now(),row.lead_id);
   audit('CONSECOM_PROPOSAL_TEXT_CANCELLED',row.lead_id,{reason:current.reason});
   return {state:'CANCELLED',reason:current.reason};
  }
  const text=PROPOSAL_MESSAGES[row.next_index];
  if(!text)return {state:'INVALID_INDEX'};
  const time=clock();
  const presencePath='/api/chat/'+encodeURIComponent(row.session_id)+'/'+encodeURIComponent(current.jid)+'/presence';
  const firstAt=Date.parse(row.typing_started_at||'');
  const lastPing=Date.parse(row.last_presence_at||'');
  // Start (or restart after an outage/pause) a FULL fixed-duration typing window.
  // The recipient sees 'digitando...' for the entire 13/25/11/9 seconds.
  if(!Number.isFinite(firstAt)||!Number.isFinite(lastPing)||time-lastPing>8500){
   try{
    const signal=await presence(presencePath,{method:'POST',data:{presence:'composing'}});
    if(signal?.status!==true)return {state:'PRESENCE_UNAVAILABLE'};
   }catch{
    audit('CONSECOM_PROPOSAL_PRESENCE_UNAVAILABLE',row.lead_id,{index:row.next_index});
    return {state:'PRESENCE_UNAVAILABLE'};
   }
   if(!currentSequence(row).ok)return {state:'CANCELLED_PENDING'};
   const started=clock(),startedIso=new Date(started).toISOString();
   const dueAt=new Date(started+proposalTypingDelayMs(row.next_index)).toISOString();
   run("UPDATE consecom_proposal_sequences SET typing_started_at=?,due_at=?,last_presence_at=?,updated_at=? WHERE lead_id=? AND state='WAITING'",
    startedIso,dueAt,startedIso,now(),row.lead_id);
   return {state:'TYPING',part:row.next_index+1,dueAt};
  }
  if(time<Date.parse(row.due_at)){
   // Reaffirm composing periodically, never issue 'paused' between the pings.
   if(time-lastPing>=3500){
    try{
     const signal=await presence(presencePath,{method:'POST',data:{presence:'composing'}});
     if(signal?.status!==true)return {state:'PRESENCE_UNAVAILABLE'};
    }catch{
     audit('CONSECOM_PROPOSAL_PRESENCE_UNAVAILABLE',row.lead_id,{index:row.next_index});
     return {state:'PRESENCE_UNAVAILABLE'};
    }
    run("UPDATE consecom_proposal_sequences SET last_presence_at=?,updated_at=? WHERE lead_id=? AND state='WAITING'",
     new Date(clock()).toISOString(),now(),row.lead_id);
   }
   return {state:'TYPING',part:row.next_index+1,dueAt:row.due_at};
  }
  const wa=await status(row.session_id);
  if(!wa?.connected)return {state:'WA_OFFLINE'};
  if(!currentSequence(row).ok)return {state:'CANCELLED_PENDING'};
  // Before the provider request, reserve this exact part. Any network failure
  // is uncertain (delivery may have happened) and requires manual review.
  if(!run("UPDATE consecom_proposal_sequences SET state='SENDING',updated_at=? WHERE lead_id=? AND state='WAITING' AND next_index=?",
    now(),row.lead_id,row.next_index).changes)return {state:'BUSY'};
  try{
   // Recheck pause even between reservation and send.
   if(halted()||!currentSequence({...row,state:'SENDING'}).ok)throw Error('STATE_CHANGED_BEFORE_SEND');
   const ack=await send('/api/messages/'+encodeURIComponent(row.session_id)+'/'+encodeURIComponent(current.jid)+'/send',
      {method:'POST',data:{message:{text}}});
   if(ack?.status!==true)throw Error('DELIVERY_UNCONFIRMED');
   addMessage({threadId:row.thread_id,providerId:'consecom-proposal-text:'+row.lead_id+':'+row.next_index,
     direction:'out',body:text,status:'sent'});
   const nextIndex=row.next_index+1,done=nextIndex===PROPOSAL_MESSAGES.length;
   const nextAt=now(); // Each next typing window starts from its own first composing ACK.
   run("UPDATE consecom_proposal_sequences SET state=?,next_index=?,due_at=?,typing_started_at=NULL,last_presence_at=NULL,updated_at=? WHERE lead_id=? AND state='SENDING'",
     done?'DONE':'WAITING',nextIndex,nextAt,now(),row.lead_id);
   audit('CONSECOM_PROPOSAL_PART_SENT',row.lead_id,{version:PROPOSAL_TEXT_VERSION,part:nextIndex,total:PROPOSAL_MESSAGES.length});
   return {state:done?'DONE':'SENT',part:nextIndex,total:PROPOSAL_MESSAGES.length};
  }catch(error){
   run("UPDATE consecom_proposal_sequences SET state='UNKNOWN',reason=?,updated_at=? WHERE lead_id=? AND state='SENDING'",
     String(error?.message||'TRANSPORT_UNCERTAIN').slice(0,100),now(),row.lead_id);
   audit('CONSECOM_PROPOSAL_PART_UNKNOWN',row.lead_id,{part:row.next_index+1,manualReview:true});
   return {state:'UNKNOWN',part:row.next_index+1};
  }finally{
   try{await presence(presencePath,{method:'POST',data:{presence:'paused'}});}catch{}
  }
 }finally{workerBusy=false;}
}
