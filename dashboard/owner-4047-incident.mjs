// One-shot read-only diagnostic for a customer-owned WhatsApp conversation.
// Never sends, queues, edits, or exports messages; logs only the last four digits.
import {all,one,getSetting} from './db.mjs';
import {waRequest} from './waakg-control.mjs';
import {boundLeadSession} from './waakg-session-registry.mjs';
const TARGET='5511948384047';
const SESSIONS=['consecom-principal','prospector-f5997b3d-687c-4d31-9878-d416369ad45a'];
const rows=(sql,...params)=>{try{return all(sql,...params)}catch(e){return {error:String(e.message).slice(0,100)}}};
const singular=(sql,...params)=>{try{return one(sql,...params)||null}catch(e){return {error:String(e.message).slice(0,100)}}};
const asArray=x=>Array.isArray(x)?x:[];
export async function inspectLuciana4047({request=waRequest}={}){
 const found=rows("SELECT id,phone,business,stage,contact_permission,created_at,last_activity_at FROM leads WHERE phone LIKE ? ORDER BY created_at DESC LIMIT 12",'%4047');
 const matches=asArray(found).filter(x=>String(x.phone||'').replace(/\D/g,'')===TARGET);
 const local=[];
 for(const lead of matches){
  const id=lead.id, session=boundLeadSession(id);
  const batches=rows("SELECT status,attempt_at,error,created_at FROM prospecting_batch_items WHERE lead_id=? ORDER BY created_at DESC LIMIT 8",id);
  const intro=singular("SELECT stage,first_reply_at,due_at,attempt_at,sent_at,reason,session_id FROM prospecting_introductions WHERE lead_id=?",id);
  const pitch=singular("SELECT stage,created_at,updated_at,attempt_at,due_at,audio_sent_at,followup_sent_at,last_error,session_id FROM owner_pitch_sequences WHERE lead_id=?",id);
  const inbox=rows("SELECT provider_id,state,received_at,session_id,substr(body,1,150) snippet FROM waakg_inbox WHERE lead_id=? ORDER BY received_at DESC LIMIT 12",id);
  const ai=rows("SELECT e.state,e.at,e.error,e.provider_id FROM groq_auto_events e JOIN waakg_inbox i ON i.provider_id=e.provider_id WHERE i.lead_id=? ORDER BY e.at DESC LIMIT 12",id);
  const msgs=rows("SELECT m.direction,m.type,m.status,m.at,m.provider_id,substr(m.body,1,100) snippet FROM messages m JOIN threads t ON m.thread_id=t.id WHERE t.lead_id=? ORDER BY m.at DESC LIMIT 12",id);
  const handoff=singular('SELECT manual_takeover,last_message_at,unread_count FROM threads WHERE lead_id=?',id);
  const audits=rows('SELECT action,at FROM audit WHERE lead_id=? ORDER BY at DESC LIMIT 14',id);
  const terminal=singular('SELECT reason,created_at FROM prospect_terminal_conversations WHERE lead_id=?',id);
  local.push({suffix:'4047',business:lead.business,stage:lead.stage,consent:lead.contact_permission===1,
   lastActivityAt:lead.last_activity_at,boundSession:session,manualTakeover:handoff?.manual_takeover===1,
   batches,intro,pitch,inbox,ai,localMessages:msgs,terminal,audits});
 }
 const remote=[];
 for(const session of SESSIONS){
  try{
   const out=await request('/api/chat/'+encodeURIComponent(session)+'/'+encodeURIComponent(TARGET+'@s.whatsapp.net'));
   const xs=Array.isArray(out.data)?out.data:[];
   remote.push({session,status:out.status===false?'ERROR':'OK',count:xs.length,
     last:xs.slice(-12).map(m=>({
      fromMe:m.fromMe===true,type:String(m.type||'').slice(0,24),
      at:m.timestamp||m.createdAt||null,
      textPreview:String(m.body||m.text||m.message?.conversation||'').slice(0,120)
     }))});
  }catch(e){remote.push({session,status:'ERROR',error:String(e.message).slice(0,110)})}
 }
 return {at:new Date().toISOString(),targetSuffix:'4047',matchCount:local.length,pausedFlag:process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE==='true',
  settingPaused:getSetting('paused',null),local,remote};
}
