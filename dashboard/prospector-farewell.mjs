// Exactly one polite closing for a clear "not interested" prospect reply.
// This is a persisted, at-most-once queue; uncertainty requires manual review.
import {db,one,run,now,addMessage,audit} from './db.mjs';
import {waControlStatus,waRequest} from './waakg-control.mjs';
import {isManagedSession,leadSession} from './waakg-session-registry.mjs';
export const PROSPECTOR_FAREWELL='Beleza, muito obrigado pela atenção! Qualquer coisa, é só chamar.';
db.exec("CREATE TABLE IF NOT EXISTS prospector_farewell_outbox(lead_id TEXT PRIMARY KEY REFERENCES leads(id),session_id TEXT NOT NULL,jid TEXT NOT NULL,status TEXT NOT NULL,attempted_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
run("UPDATE prospector_farewell_outbox SET status='UNKNOWN',updated_at=? WHERE status='SENDING'",now());
export function queueProspectorFarewell({leadId,sessionId,jid}={}){
 if(!leadId||!isManagedSession(sessionId)||!/^[0-9]{10,15}@s\.whatsapp\.net$/.test(String(jid||''))||leadSession(leadId)!==sessionId)return false;
 const lead=one('SELECT stage,phone FROM leads WHERE id=?',leadId);
 if(lead?.stage!=='NO_INTEREST'||jid.split('@')[0]!==lead.phone||
  one('SELECT phone FROM suppressions WHERE phone=?',lead.phone))return false;
 return run("INSERT OR IGNORE INTO prospector_farewell_outbox(lead_id,session_id,jid,status,created_at,updated_at) VALUES(?,?,?,'PENDING',?,?)",leadId,sessionId,jid,now(),now()).changes===1;
}
let busy=false;
export async function tickProspectorFarewells(deps={}){
 if(busy)return {state:'BUSY'};
 busy=true;
 try{
  const entry=one("SELECT f.*,l.stage,l.phone FROM prospector_farewell_outbox f JOIN leads l ON l.id=f.lead_id WHERE f.status='PENDING' ORDER BY f.created_at LIMIT 1");
  if(!entry)return {state:'IDLE'};
  const valid=()=>one('SELECT stage,phone FROM leads WHERE id=?',entry.lead_id)?.stage==='NO_INTEREST'&&
   !one('SELECT phone FROM suppressions WHERE phone=?',entry.phone)&&
   isManagedSession(entry.session_id)&&leadSession(entry.lead_id)===entry.session_id&&
   entry.phone+'@s.whatsapp.net'===entry.jid;
  if(!valid()){
   run("UPDATE prospector_farewell_outbox SET status='CANCELLED',updated_at=? WHERE lead_id=? AND status='PENDING'",now(),entry.lead_id);
   return {state:'CANCELLED'};
  }
  const status=await (deps.status||waControlStatus)(entry.session_id);
  if(!status?.connected)return {state:'OFFLINE'};
  if(!valid())return {state:'NOT_ELIGIBLE'};
  if(!run("UPDATE prospector_farewell_outbox SET status='SENDING',attempted_at=?,updated_at=? WHERE lead_id=? AND status='PENDING'",now(),now(),entry.lead_id).changes)return {state:'BUSY'};
  try{
   const send=deps.send||waRequest;
   const ack=await send('/api/messages/'+encodeURIComponent(entry.session_id)+'/'+encodeURIComponent(entry.jid)+'/send',{
    method:'POST',data:{message:{text:PROSPECTOR_FAREWELL}}});
   if(ack?.status!==true)throw Error('NOT_CONFIRMED');
   run("UPDATE prospector_farewell_outbox SET status='SENT',updated_at=? WHERE lead_id=? AND status='SENDING'",now(),entry.lead_id);
   const thread=one('SELECT id FROM threads WHERE lead_id=?',entry.lead_id);
   if(thread){
    addMessage({threadId:thread.id,providerId:'prospector-farewell:'+entry.lead_id,direction:'out',body:PROSPECTOR_FAREWELL,status:'sent'});
    run('UPDATE threads SET manual_takeover=1 WHERE id=?',thread.id);
   }
   audit('PROSPECTOR_FAREWELL_SENT',entry.lead_id,{oneTime:true});
   return {state:'SENT'};
  }catch(error){
   run("UPDATE prospector_farewell_outbox SET status='UNKNOWN',updated_at=? WHERE lead_id=? AND status='SENDING'",now(),entry.lead_id);
   audit('PROSPECTOR_FAREWELL_UNKNOWN',entry.lead_id,{manualReview:true});
   return {state:'UNKNOWN'};
  }
 }finally{busy=false;}
}
