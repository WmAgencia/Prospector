// One explicitly approved list, persisted in the Prospector volume.
// Every send attempt is at least 90 seconds after the previous attempt.
// A send timeout is UNKNOWN and is never retried automatically.
import {db,id,one,all,run,tx,now,audit,addLead,getThread,addMessage} from './db.mjs';
import {documentedOptIn} from './outreach-queue.mjs';
import {greetingForTime} from './prospecting-approach.mjs';
import {waRequest,selectedWaSession,waControlStatus} from './waakg-control.mjs';

export const APPROACH_INTERVAL_MS=90_000;
db.exec("CREATE TABLE IF NOT EXISTS prospecting_batches(id TEXT PRIMARY KEY,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS prospecting_batch_items(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES prospecting_batches(id),lead_id TEXT NOT NULL REFERENCES leads(id),phone TEXT NOT NULL,status TEXT NOT NULL,attempt_at TEXT,error TEXT,created_at TEXT NOT NULL,UNIQUE(batch_id,lead_id))");
db.exec("CREATE INDEX IF NOT EXISTS idx_prospecting_batch_items ON prospecting_batch_items(status,batch_id,created_at)");
db.exec("CREATE TABLE IF NOT EXISTS prospecting_send_clock(id INTEGER PRIMARY KEY CHECK(id=1),last_attempt_ms INTEGER NOT NULL DEFAULT 0)");
run("INSERT OR IGNORE INTO prospecting_send_clock(id,last_attempt_ms) VALUES(1,0)");
// Crash safety: an interrupted network send may have been delivered.
run("UPDATE prospecting_batch_items SET status='UNKNOWN',error='Processo interrompido; conferir no WhatsApp' WHERE status='SENDING'");

function eligibleLead(leadId,ignoreQueueItemId=''){
 const l=one("SELECT id,business,phone,stage,contact_permission FROM leads WHERE id=?",leadId);
 if(!l||!l.phone||l.stage!=='DISCOVERED'||l.contact_permission!==1)return null;
 if(!documentedOptIn(l.id))return null;
 if(one('SELECT phone FROM suppressions WHERE phone=?',l.phone))return null;
 if(one('SELECT lead_id FROM initial_contacts WHERE lead_id=? OR phone=?',l.id,l.phone))return null;
 if(one("SELECT 1 FROM threads t JOIN messages m ON m.thread_id=t.id WHERE t.lead_id=? AND m.direction='out' LIMIT 1",l.id))return null;
 if(one("SELECT 1 FROM prospecting_batch_items WHERE (lead_id=? OR phone=?) AND id<>? AND status IN ('QUEUED','SENDING','SENT','UNKNOWN') LIMIT 1",l.id,l.phone,ignoreQueueItemId))return null;
 return l;
}
function currentBatch(){
 return one("SELECT * FROM prospecting_batches WHERE status='ACTIVE' ORDER BY created_at ASC LIMIT 1");
}
export function approachQueueStatus(){
 const b=currentBatch();
 const clock=one('SELECT last_attempt_ms FROM prospecting_send_clock WHERE id=1')?.last_attempt_ms||0;
 const waiting=one("SELECT COUNT(*) AS n FROM prospecting_batch_items WHERE status='QUEUED'")?.n||0;
 const unknown=one("SELECT COUNT(*) AS n FROM prospecting_batch_items WHERE status='UNKNOWN'")?.n||0;
 const sent=one("SELECT COUNT(*) AS n FROM prospecting_batch_items WHERE status='SENT'")?.n||0;
 return {active:!!b,batchId:b?.id||null,waiting,sent,unknown,
  intervalSeconds:90,nextEarliestAt:b&&waiting?new Date(Math.max(Date.now(),clock+APPROACH_INTERVAL_MS)).toISOString():null,
  status:b?.status||'IDLE',repliesIndependent:true,requiresDocumentedOptIn:true};
}
export function enqueueApprovedApproaches(input={}){
 const ids=Array.isArray(input.leadIds)?[...new Set(input.leadIds.map(v=>String(v||'')))]:[];
 if(input.approve!==true||ids.length<1||ids.length>100||ids.some(v=>!/^[a-f0-9-]{36}$/i.test(v)))return {status:400,body:{error:'Selecione empresas e confirme a inclusão na fila'}};
 const result=tx(()=>{
  if(currentBatch())return {status:409,body:{error:'Já existe uma fila em andamento. Conclua ou cancele antes de iniciar outra.'}};
  const approved=ids.map(eligibleLead).filter(Boolean);
  if(!approved.length)return {status:403,body:{error:'Nenhuma selecionada tem autorização de contato documentada. Não é permitido iniciar disparos a contatos encontrados publicamente.'}};
  const batchId=id(),at=now();
  run('INSERT INTO prospecting_batches(id,status,created_at,updated_at) VALUES(?,?,?,?)',batchId,'ACTIVE',at,at);
  for(const l of approved)run('INSERT INTO prospecting_batch_items(id,batch_id,lead_id,phone,status,created_at) VALUES(?,?,?,?,?,?)',id(),batchId,l.id,l.phone,'QUEUED',at);
  audit('PROSPECTING_BATCH_APPROVED',null,{batchId,selected:ids.length,queued:approved.length,excluded:ids.length-approved.length,intervalSeconds:90});
  return {status:202,body:{ok:true,batchId,queued:approved.length,excluded:ids.length-approved.length,intervalSeconds:90,started:false}};
 });
 return result;
}
export function cancelApproachQueue(){
 const batch=currentBatch();
 if(!batch)return {ok:true,cancelled:0,active:false};
 const result=tx(()=>{
  run("UPDATE prospecting_batches SET status='CANCELLED',updated_at=? WHERE id=?",now(),batch.id);
  const count=run("UPDATE prospecting_batch_items SET status='CANCELLED' WHERE batch_id=? AND status='QUEUED'",batch.id).changes;
  audit('PROSPECTING_BATCH_CANCELLED',null,{batchId:batch.id,remaining:count});
  return {ok:true,cancelled:count,active:false};
 });
 return result;
}
let locked=false;
export async function tickApproachQueue(deps={}){
 if(locked)return {status:'BUSY'};
 const {currentTime=()=>Date.now(),getWaStatus=waControlStatus,getSession=selectedWaSession,send=waRequest}=deps;
 locked=true;
 try{
  const time=currentTime(),batch=currentBatch();
  if(!batch)return {status:'IDLE'};
  const clock=one('SELECT last_attempt_ms FROM prospecting_send_clock WHERE id=1')?.last_attempt_ms||0;
  const next=one("SELECT * FROM prospecting_batch_items WHERE batch_id=? AND status='QUEUED' ORDER BY created_at,id LIMIT 1",batch.id);
  if(!next){run("UPDATE prospecting_batches SET status='COMPLETED',updated_at=? WHERE id=? AND status='ACTIVE'",now(),batch.id);return {status:'COMPLETED'};}
  if(time-clock<APPROACH_INTERVAL_MS)return {status:'WAITING',remainingMs:APPROACH_INTERVAL_MS-(time-clock)};
  if(!eligibleLead(next.lead_id,next.id)){
   run("UPDATE prospecting_batch_items SET status='SKIPPED',error='Elegibilidade alterada',attempt_at=? WHERE id=?",now(),next.id);
   return {status:'SKIPPED'};
  }
  const wa=await getWaStatus(),session=getSession()||wa.sessionId;
  if(!wa.connected||!session)return {status:'OFFLINE'};
  // Transaction reserves the global clock *before* invoking the provider.
  // Timestamp can only move forward. The interval is enforced after restarts.
  const reserved=tx(()=>{
   if(!currentBatch()||currentBatch().id!==batch.id)return false;
   const latest=one('SELECT last_attempt_ms FROM prospecting_send_clock WHERE id=1')?.last_attempt_ms||0;
   const nowMs=currentTime();
   if(nowMs-latest<APPROACH_INTERVAL_MS)return false;
   if(one('SELECT status FROM prospecting_batch_items WHERE id=?',next.id)?.status!=='QUEUED')return false;
   run('UPDATE prospecting_send_clock SET last_attempt_ms=? WHERE id=1',nowMs);
   run("UPDATE prospecting_batch_items SET status='SENDING',attempt_at=? WHERE id=? AND status='QUEUED'",new Date(nowMs).toISOString(),next.id);
   // No duplicate recipient attempts even after crashes.
   run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',next.lead_id,next.phone,'UNKNOWN',next.id,new Date(nowMs).toISOString());
   return true;
  });
  if(!reserved)return {status:'WAITING'};
  const message='Olá, '+greetingForTime(new Date(currentTime()))+', como vai?';
  try{
   const result=await send('/api/messages/'+encodeURIComponent(session)+'/'+encodeURIComponent(next.phone+'@s.whatsapp.net')+'/send',{method:'POST',data:{message:{text:message}}});
   if(result.status!==true)throw Error('Gateway não confirmou entrega');
   run("UPDATE prospecting_batch_items SET status='SENT',error=NULL WHERE id=?",next.id);
   run("UPDATE initial_contacts SET status='SENT' WHERE job_id=?",next.id);
   const lead=one('SELECT * FROM leads WHERE id=?',next.lead_id);
   const thread=getThread(lead.id,next.phone+'@s.whatsapp.net');
   addMessage({threadId:thread.id,providerId:'prospect-queue:'+next.id,direction:'out',body:message,status:'sent'});
   audit('PROSPECTING_GREETING_ACCEPTED',lead.id,{batchId:batch.id,intervalSeconds:90});
   return {status:'SENT',batchId:batch.id};
  }catch(error){
   run("UPDATE prospecting_batch_items SET status='UNKNOWN',error='Entrega incerta; verificar manualmente' WHERE id=?",next.id);
   audit('PROSPECTING_GREETING_UNKNOWN',next.lead_id,{batchId:batch.id});
   return {status:'UNKNOWN',batchId:batch.id};
  }
 }finally{locked=false;}
}
