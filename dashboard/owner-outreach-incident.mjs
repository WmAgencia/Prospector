// Read-only incident check. Never sends messages or changes prospect state.
import {all,one} from './db.mjs';
import {waSessionList} from './waakg-control.mjs';
import {managedSessions,rotationCursor} from './waakg-session-registry.mjs';

const suffix=phone=>String(phone||'').replace(/\D/g,'').slice(-4);
const iso=number=>Number.isFinite(number)&&number>0?new Date(number).toISOString():null;
const rows=(query)=>{try{return all(query)}catch(error){return {error:String(error.message).slice(0,110)}}};
export async function readOwnerOutreachIncident(){
 const rawInitial=rows(`SELECT q.attempt_at,q.status,q.phone,r.session_id
  FROM prospecting_batch_items q LEFT JOIN lead_whatsapp_routes r ON r.lead_id=q.lead_id
  WHERE q.attempt_at IS NOT NULL ORDER BY q.attempt_at DESC LIMIT 20`);
 const rawIntro=rows(`SELECT p.attempt_at,p.sent_at,p.first_reply_at,p.due_at,p.stage,p.phone,p.session_id
  FROM prospecting_introductions p WHERE p.attempt_at IS NOT NULL
  ORDER BY p.attempt_at DESC LIMIT 20`);
 const initial=Array.isArray(rawInitial)?rawInitial.map(x=>({at:x.attempt_at,status:x.status,phoneSuffix:suffix(x.phone),sessionId:x.session_id||null})):rawInitial;
 const intros=Array.isArray(rawIntro)?rawIntro.map(x=>({attemptedAt:x.attempt_at,sentAt:x.sent_at,firstReplyAt:x.first_reply_at,dueAt:x.due_at,stage:x.stage,phoneSuffix:suffix(x.phone),sessionId:x.session_id})):rawIntro;
 const successful=Array.isArray(rawInitial)?rawInitial.filter(x=>x.status==='SENT').sort((a,b)=>Date.parse(a.attempt_at)-Date.parse(b.attempt_at)):[];
 const gaps=successful.slice(1).map((x,i)=>({seconds:Math.round((Date.parse(x.attempt_at)-Date.parse(successful[i].attempt_at))/1000),
  first:suffix(successful[i].phone),second:suffix(x.phone)}));
 const clock=one('SELECT last_attempt_ms,last_finished_ms,interval_ms FROM prospecting_send_clock WHERE id=1');
 let sessions;try{
  const out=await waSessionList();
  sessions=out.items.map(x=>({sessionId:x.session_id,label:x.label,connected:x.connected,
   status:x.status,numberSuffix:x.numberSuffix||null,transportStale:!!x.transportStale}));
 }catch(error){sessions={error:String(error.message).slice(0,130),configured:managedSessions().map(x=>x.session_id)}}
 return {at:new Date().toISOString(),sessions,lastRotation:rotationCursor(),clock:{
  lastAttemptAt:iso(clock?.last_attempt_ms),lastFinishedAt:iso(clock?.last_finished_ms),intervalSeconds:(clock?.interval_ms||0)/1000},
  initial,gaps,gapViolations:gaps.filter(x=>x.seconds<435),intro:intros};
}
