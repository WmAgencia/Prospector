import {ownerProspectionPaused} from './prospection-pause.mjs';
import {coldOutreachSwitchEnabled,autonomousOutreachOperationalEnabled,COLD_OUTREACH_DISABLED_REASON} from './cold-outreach-switch.mjs';
// One explicitly approved list, persisted in the Prospector volume.
// Every send attempt is at least 90 seconds after the previous attempt.
// A send timeout is UNKNOWN and is never retried automatically.
import {db,id,one,all,run,tx,now,audit,getSetting,setSetting,getThread,addMessage} from './db.mjs';
import {daySP} from './radar.mjs';
import {dailyApproachBudget} from './daily-approach-limit.mjs';
import {reserveApproachCredit,settleApproachCredit,availableApproachCredits} from './tenant-credits.mjs';
import {APPROACH_CADENCE,chooseApproachInterval,approachDueAt} from './approach-cadence.mjs';
import {operatorSelected,recordOperatorSelection} from './operator-outreach.mjs';
import {documentedOptIn} from './outreach-queue.mjs';
import {recontactDecision,latestOutreachAt,threeMonthsAfter} from './prospecting-recontact.mjs';
import {insideApproachWindow,isOutboundBusinessDay,prospectingWindowLabel} from './outreach-window.mjs';
import {greetingForProspect,registerGreeting} from './prospecting-introduction.mjs';
import {waRequest,selectedWaSession,waControlStatus,selectApproachSender} from './waakg-control.mjs';
import {bindLeadSession,rotationCursor,advanceRotation,managedSessions} from './waakg-session-registry.mjs';

export const APPROACH_INTERVAL_MS=90_000;
// Railway production always requires documented permission, including cold-first approaches.
export const requiresDocumentedOptIn=()=>process.env.PROSPECTOR_REQUIRE_DOCUMENTED_OPTIN==='true'||process.env.NODE_ENV==='production'||!!process.env.RAILWAY_ENVIRONMENT;
db.exec("CREATE TABLE IF NOT EXISTS prospecting_batches(id TEXT PRIMARY KEY,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS prospecting_batch_items(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES prospecting_batches(id),lead_id TEXT NOT NULL REFERENCES leads(id),phone TEXT NOT NULL,status TEXT NOT NULL,attempt_at TEXT,error TEXT,created_at TEXT NOT NULL,UNIQUE(batch_id,lead_id))");
db.exec("CREATE INDEX IF NOT EXISTS idx_prospecting_batch_items ON prospecting_batch_items(status,batch_id,created_at)");
if(!db.prepare('PRAGMA table_info(prospecting_batches)').all().some(x=>x.name==='origin'))
 db.exec("ALTER TABLE prospecting_batches ADD COLUMN origin TEXT NOT NULL DEFAULT 'MANUAL'");
db.exec("CREATE TABLE IF NOT EXISTS prospecting_send_clock(id INTEGER PRIMARY KEY CHECK(id=1),last_attempt_ms INTEGER NOT NULL DEFAULT 0)");
if(!db.prepare('PRAGMA table_info(prospecting_send_clock)').all().some(c=>c.name==='interval_ms')){
 db.exec('ALTER TABLE prospecting_send_clock ADD COLUMN interval_ms INTEGER NOT NULL DEFAULT 90000');
 run('UPDATE prospecting_send_clock SET interval_ms=?',chooseApproachInterval(90000));
}
run('INSERT OR IGNORE INTO prospecting_send_clock(id,last_attempt_ms,interval_ms) VALUES(1,0,?)',chooseApproachInterval());
const priorInterval=one('SELECT interval_ms FROM prospecting_send_clock WHERE id=1')?.interval_ms;
if(priorInterval<APPROACH_CADENCE.minSeconds*1000||priorInterval>APPROACH_CADENCE.maxSeconds*1000){
 // Honor a conservative 110s wait after migrations from the old 180s cadence.
 run('UPDATE prospecting_send_clock SET interval_ms=? WHERE id=1',APPROACH_CADENCE.maxSeconds*1000);
}

if(!db.prepare('PRAGMA table_info(prospecting_send_clock)').all().some(c=>c.name==='last_finished_ms'))db.exec('ALTER TABLE prospecting_send_clock ADD COLUMN last_finished_ms INTEGER NOT NULL DEFAULT 0');
// Crash safety: an interrupted network send may have been delivered.
run("UPDATE prospecting_batch_items SET status='UNKNOWN',error='Processo interrompido; conferir no WhatsApp' WHERE status='SENDING'");

function eligibleLead(leadId,ignoreQueueItemId='',operatorApproved=false,automaticApproved=false){
 const l=one("SELECT id,business,phone,stage,contact_permission FROM leads WHERE id=?",leadId);
 if(!l||!l.phone)return null;
 if(ignoreQueueItemId&&one('SELECT phone FROM prospecting_batch_items WHERE id=?',ignoreQueueItemId)?.phone!==l.phone)return null;
 if(!recontactDecision(l,Date.now(),ignoreQueueItemId).eligible)return null;
 // Production safeguard: public business contact details and operator selection
 // are NOT evidence of WhatsApp marketing permission. Validate again at send time.
 // Abordagem fria liberada pelo operador dispensa opt-in prévio (nome vem da empresa).
 if(requiresDocumentedOptIn()&&!documentedOptIn(l.id))return null;
 if(!documentedOptIn(l.id)&&!operatorApproved&&!automaticApproved&&!(ignoreQueueItemId&&operatorSelected(l.id)))return null;
 if(one('SELECT phone FROM suppressions WHERE phone=?',l.phone))return null;


 if(one("SELECT 1 FROM prospecting_batch_items WHERE (lead_id=? OR phone=?) AND id<>? AND status IN ('QUEUED','SENDING','UNKNOWN') LIMIT 1",l.id,l.phone,ignoreQueueItemId))return null;
 return l;
}
function currentBatch(){
 return one("SELECT * FROM prospecting_batches WHERE status='ACTIVE' ORDER BY created_at ASC LIMIT 1");
}
// Um lote que ficou ACTIVE além do seu dia trava o ciclo seguinte: as 07:00 de
// amanhã recusariam carregar a fila nova. Encerra lotes de dias anteriores sem
// tocar em itens já enviados ou com entrega incerta.
function closeStaleBatch(at=new Date()){
 const batch=currentBatch();
 if(!batch)return null;
 const created=Date.parse(batch.created_at);
 if(!Number.isFinite(created))return null;
 // Só expira lote de dia ANTERIOR. Lote do mesmo dia (ou com data futura por
 // desvio de relógio) continua válido.
 const batchDay=daySP(new Date(created)),today=daySP(at);
 if(batchDay>=today)return null;
 const pending=one("SELECT COUNT(*) AS n FROM prospecting_batch_items WHERE batch_id=? AND status='QUEUED'",batch.id)?.n||0;
 if(!pending)return null;
 run("UPDATE prospecting_batch_items SET status='CANCELLED',error='Janela encerrada; lote expirado' WHERE batch_id=? AND status='QUEUED'",batch.id);
 run("UPDATE prospecting_batches SET status='EXPIRED',updated_at=? WHERE id=? AND status='ACTIVE'",now(),batch.id);
 audit('PROSPECTING_BATCH_EXPIRED',null,{batchId:batch.id,cancelled:pending});
 return {status:'EXPIRED',batchId:batch.id,cancelled:pending};
}
// Operador liberou a abordagem fria (2026-11-04). O opt-in por contato continua
// valendo para o Groq: a primeira resposta da pessoa é o que libera a conversa.
export const coldFirstApproachEnabled=()=>coldOutreachSwitchEnabled();
// Read-only inventory using the sender's eligibility checks. Consent statistics
// from legacy workflows do not describe the autonomous first-greeting queue.
export function autonomousReadyCount(at=new Date()){
 const rows=all("SELECT id,business,city,phone,stage FROM leads WHERE phone IS NOT NULL ORDER BY created_at DESC LIMIT 6000");
 const byIdentity=new Map();
 for(const lead of rows){const key=businessIdentity(lead);if(key){if(!byIdentity.has(key))byIdentity.set(key,[]);byIdentity.get(key).push(lead);}}
 const keys=new Set();let ready=0;
 for(const lead of rows){
  if(!['DISCOVERED','NO_INTEREST'].includes(lead.stage)||!recontactDecision(lead,at.getTime()).eligible||!eligibleLead(lead.id,'',false,true))continue;
  const key=businessIdentity(lead);
  if(key&&(keys.has(key)||(byIdentity.get(key)||[]).some(other=>other.id!==lead.id&&unsafeSister(other,at.getTime()))))continue;
  ready++;if(key)keys.add(key);
 }
 return ready;
}
export function approachQueueStatus(){
 const b=currentBatch();
 const clock=one('SELECT last_attempt_ms,last_finished_ms,interval_ms FROM prospecting_send_clock WHERE id=1');
 const waiting=one("SELECT COUNT(*) AS n FROM prospecting_batch_items WHERE status='QUEUED'")?.n||0;
 const unknown=one("SELECT COUNT(*) AS n FROM prospecting_batch_items WHERE status='UNKNOWN'")?.n||0;
 const sent=one("SELECT COUNT(*) AS n FROM prospecting_batch_items WHERE status='SENT'")?.n||0;
 return {active:!!b,batchId:b?.id||null,origin:b?.origin||null,automaticEnabled:autonomousOutreachOperationalEnabled(getSetting('autonomous_outreach_enabled',false)),startDate:process.env.PROSPECTOR_APPROACH_START_DATE||null,window:prospectingWindowLabel(),waiting,sent,unknown,
  intervalSeconds:clock.interval_ms/1000,cadence:APPROACH_CADENCE,senderRotation:{mode:'round_robin',sessions:managedSessions().length,lastSession:rotationCursor()},nextEarliestAt:b&&waiting?new Date(Math.max(Date.now(),approachDueAt(clock))).toISOString():null,
  status:b?.status||'IDLE',dailyBudget:dailyApproachBudget(),availableCredits:availableApproachCredits(),repliesIndependent:true,requiresDocumentedOptIn:requiresDocumentedOptIn(),requiresOperatorApproval:false};
}
export function enqueueApprovedApproaches(input={}){
 if(input.operatorApproved===true&&input.offerType!==undefined&&!['portfolio','promotion','corporate'].includes(input.offerType))return {status:400,body:{error:'Tipo de oferta inválido'}};
 const ids=Array.isArray(input.leadIds)?[...new Set(input.leadIds.map(v=>String(v||'')))]:[];
 if(input.approve!==true||ids.length<1||ids.length>1000||ids.some(v=>!/^[a-f0-9-]{36}$/i.test(v)))return {status:400,body:{error:'Selecione empresas e confirme a inclusão na fila'}};
 const result=tx(()=>{
  if(currentBatch())return {status:409,body:{error:'Já existe uma fila em andamento. Conclua ou cancele antes de iniciar outra.'}};
  const approved=ids.map(leadId=>eligibleLead(leadId,'',input.operatorApproved===true)).filter(Boolean);
  if(process.env.PROSPECTOR_TENANT_ID&&approved.length>availableApproachCredits())return {status:402,body:{error:'Saldo insuficiente para esta seleção. Reduza a lista ou solicite uma recarga.'}};
  if(!approved.length)return {status:403,body:{error:input.operatorApproved===true?'Nenhuma selecionada está elegível para abordagem. Confira bloqueios, contatos anteriores e atendimento humano.':'Nenhuma selecionada tem autorização de contato documentada. Confirme a seleção manual no painel para aprovar a primeira abordagem.'}};
  const batchId=id(),at=now();
  run('INSERT INTO prospecting_batches(id,status,created_at,updated_at) VALUES(?,?,?,?)',batchId,'ACTIVE',at,at);
  for(const l of approved){
   const itemId=id();
   run('INSERT INTO prospecting_batch_items(id,batch_id,lead_id,phone,status,created_at) VALUES(?,?,?,?,?,?)',itemId,batchId,l.id,l.phone,'QUEUED',at);
   if(input.operatorApproved===true)recordOperatorSelection({itemId,batchId,leadId:l.id,offerType:input.offerType||'portfolio'});
  }
  audit('PROSPECTING_BATCH_APPROVED',null,{batchId,selected:ids.length,queued:approved.length,excluded:ids.length-approved.length,cadence:APPROACH_CADENCE});
  return {status:202,body:{ok:true,batchId,queued:approved.length,excluded:ids.length-approved.length,intervalSeconds:approachQueueStatus().intervalSeconds,cadence:APPROACH_CADENCE,started:false}};
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
// Enrollment uses the same durable queue and 90-second clock as manual selections.
// This authorization is limited to the autonomous research program. It does
// not invent customer consent, override opt-outs, or contact existing clients.
const normalizeIdentity=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const businessIdentity=l=>l?.business&&l?.city?normalizeIdentity(l.city)+'|'+normalizeIdentity(l.business):'';
function unsafeSister(sibling,at){
 if(['INTERESTED','CONVERSING','CLOSED_WON'].includes(sibling.stage))return true;
 if(sibling.phone&&one('SELECT 1 FROM suppressions WHERE phone=?',sibling.phone))return true;
 const last=latestOutreachAt(sibling.id,sibling.phone);
 const due=last?threeMonthsAfter(new Date(last)):null;
 return !!due&&Date.parse(due)>at;
}
export function enrollAutonomousApproaches({at=new Date(),maxBatch=80}={}){
 if(!coldOutreachSwitchEnabled())return {status:COLD_OUTREACH_DISABLED_REASON};
 if(ownerProspectionPaused())return {status:'PAUSED_BY_OWNER'};
 if(!autonomousOutreachOperationalEnabled(getSetting('autonomous_outreach_enabled',false)))return {status:'DISABLED'};
 if(getSetting('paused',true))return {status:'PAUSED'};
 closeStaleBatch(at);
 if(currentBatch())return {status:'ACTIVE'};
 if(!insideApproachWindow(at))return {status:'OUTSIDE_WINDOW'};
 const atMs=at.getTime();
 const rows=all("SELECT id,business,city,phone,stage,contact_permission FROM leads WHERE phone IS NOT NULL ORDER BY created_at DESC LIMIT 6000");
 const byIdentity=new Map();
 for(const lead of rows){const key=businessIdentity(lead);if(key){if(!byIdentity.has(key))byIdentity.set(key,[]);byIdentity.get(key).push(lead);}}
 const selected=[],keys=new Set();
 for(const lead of rows){
  if(selected.length>=Math.max(1,Math.min(100,Number(maxBatch)||80)))break;
  if(!['DISCOVERED','NO_INTEREST'].includes(lead.stage))continue;
  if(!recontactDecision(lead,atMs).eligible)continue;
  const key=businessIdentity(lead);
  if(key&&(keys.has(key)||(byIdentity.get(key)||[]).some(other=>other.id!==lead.id&&unsafeSister(other,atMs))))continue;
  selected.push(lead);if(key)keys.add(key);
 }
 if(!selected.length)return {status:'NO_ELIGIBLE_LEADS'};
 return createAutonomousBatch(selected);
}
function createAutonomousBatch(selected){
 return tx(()=>{
  if(currentBatch())return {status:'ACTIVE'};
  const batchId=id(),created=now();
  run("INSERT INTO prospecting_batches(id,status,created_at,updated_at,origin) VALUES(?,'ACTIVE',?,?,'AUTONOMOUS')",batchId,created,created);
  let queued=0;
  for(const lead of selected){
   // Recheck eligibility inside the transaction, including manual queue changes.
   if(!eligibleLead(lead.id,'',false,true))continue;
   run("INSERT INTO prospecting_batch_items(id,batch_id,lead_id,phone,status,created_at) VALUES(?,?,?,?,'QUEUED',?)",id(),batchId,lead.id,lead.phone,created);
   queued++;
  }
  if(!queued){run('DELETE FROM prospecting_batches WHERE id=?',batchId);return {status:'NO_ELIGIBLE_LEADS'};}
  audit('AUTONOMOUS_APPROACH_BATCH',null,{batchId,queued,window:prospectingWindowLabel(),cadence:APPROACH_CADENCE,threeCalendarMonths:true});
  return {status:'QUEUED',batchId,queued};
 });
}
// Pré-aquecimento 07:00–08:00: a pesquisa do dia já virou leads no CRM, então a
// fila nasce antes da janela e o trabalhador envia a partir das 08:00, 90s cada.
export function preloadApproachQueue({at=new Date(),maxBatch=200}={}){
 if(!coldOutreachSwitchEnabled())return {status:COLD_OUTREACH_DISABLED_REASON};
 if(getSetting('paused',true))return {status:'PAUSED'};
 if(!isOutboundBusinessDay(at))return {status:'OUTSIDE_WINDOW'};
 closeStaleBatch(at);
 if(currentBatch())return {status:'ACTIVE'};
 const atMs=at.getTime();
 const rows=all("SELECT id,business,city,phone,stage,contact_permission FROM leads WHERE phone IS NOT NULL AND created_at>=? ORDER BY created_at DESC LIMIT 3000",new Date(atMs-18*3600_000).toISOString());
 const selected=[];
 for(const lead of rows){
  if(selected.length>=Math.max(1,Math.min(300,Number(maxBatch)||200)))break;
  if(!['DISCOVERED','NO_INTEREST'].includes(lead.stage))continue;
  if(!recontactDecision(lead,atMs).eligible)continue;
  selected.push(lead);
 }
 if(!selected.length)return {status:'NO_ELIGIBLE_LEADS'};
 return createAutonomousBatch(selected);
}

let locked=false;
export async function tickApproachQueue(deps={}){
 if(!coldOutreachSwitchEnabled())return {status:COLD_OUTREACH_DISABLED_REASON};
 if(ownerProspectionPaused())return {status:'PAUSED_BY_OWNER'};
 if(locked)return {status:'BUSY'};
 const {currentTime=()=>Date.now(),getWaStatus=waControlStatus,getSession=selectedWaSession,send=waRequest}=deps;
 locked=true;
 try{
  const time=currentTime(),batch=currentBatch();
  if(!batch)return {status:'IDLE'};
  if(batch.origin==='AUTONOMOUS'&&getSetting('paused',true))return {status:'PAUSED'};
  if(batch.origin==='AUTONOMOUS'&&!autonomousOutreachOperationalEnabled(getSetting('autonomous_outreach_enabled',false)))return {status:'DISABLED'};
  const expired=closeStaleBatch(new Date(time));
  if(expired)return expired;
  if(!insideApproachWindow(new Date(time)))return {status:'OUTSIDE_WINDOW'};
  if(dailyApproachBudget(new Date(time)).remaining===0)return {status:'DAILY_LIMIT',limit:250};
  const clock=one('SELECT last_attempt_ms,last_finished_ms,interval_ms FROM prospecting_send_clock WHERE id=1');
  const next=one("SELECT * FROM prospecting_batch_items WHERE batch_id=? AND status='QUEUED' ORDER BY created_at,id LIMIT 1",batch.id);
  if(!next){run("UPDATE prospecting_batches SET status='COMPLETED',updated_at=? WHERE id=? AND status='ACTIVE'",now(),batch.id);return {status:'COMPLETED'};}
  if(time<approachDueAt(clock))return {status:'WAITING',remainingMs:approachDueAt(clock)-time};
  if(!eligibleLead(next.lead_id,next.id,false,batch.origin==='AUTONOMOUS')){
   run("UPDATE prospecting_batch_items SET status='SKIPPED',error='Elegibilidade alterada',attempt_at=? WHERE id=?",now(),next.id);
   return {status:'SKIPPED'};
  }
  const rotating=!deps.getWaStatus&&!deps.getSession;
  const wa=rotating?await selectApproachSender():await getWaStatus(),session=rotating?wa.sessionId:(getSession()||wa.sessionId);
  if(!wa.connected||!session)return {status:wa.reason||'OFFLINE'};
  if(process.env.PROSPECTOR_TENANT_ID&&!getSetting('training_active',null))return {status:'TRAINING_REVIEW_REQUIRED'};
  if(!reserveApproachCredit(next.id))return {status:'NO_CREDITS'};
  // Show WhatsApp's composing indicator before an authorized first approach.
  // If presence cannot be confirmed, do not send the greeting.
  const presencePath='/api/chat/'+encodeURIComponent(session)+'/'+encodeURIComponent(next.phone+'@s.whatsapp.net')+'/presence';
  try{
   const typing=await send(presencePath,{method:'POST',data:{presence:'composing'}}).catch(()=>null);
   if(typing?.status!==true){settleApproachCredit(next.id,false);return {status:'PRESENCE_UNAVAILABLE'};}
   await new Promise(resolve=>setTimeout(resolve,2600));
   if(!coldOutreachSwitchEnabled()||ownerProspectionPaused()){
    settleApproachCredit(next.id,false);return {status:'PAUSED'};
   }
  // Transaction reserves the global clock *before* invoking the provider.
  // Timestamp can only move forward. The interval is enforced after restarts.
  const reserved=tx(()=>{
   if(!coldOutreachSwitchEnabled())return false;
   if(!currentBatch()||currentBatch().id!==batch.id)return false;
   const latest=one('SELECT last_attempt_ms,last_finished_ms,interval_ms FROM prospecting_send_clock WHERE id=1');
   const nowMs=currentTime();
   if(nowMs<approachDueAt(latest)||!insideApproachWindow(new Date(nowMs)))return false;
   if(dailyApproachBudget(new Date(nowMs)).remaining===0)return false;
   if(batch.origin==='AUTONOMOUS'&&getSetting('paused',true))return false;
   if(batch.origin==='AUTONOMOUS'&&!autonomousOutreachOperationalEnabled(getSetting('autonomous_outreach_enabled',false)))return false;
   if(one('SELECT status FROM prospecting_batch_items WHERE id=?',next.id)?.status!=='QUEUED')return false;
   if(!eligibleLead(next.lead_id,next.id,false,batch.origin==='AUTONOMOUS'))return false;
   if(rotating&&rotationCursor()!==wa.cursor)return false;
   // Reserve both the attempt and its next random interval atomically. Polling,
   // failures and process restarts never reroll or shorten the chosen wait.
   run('UPDATE prospecting_send_clock SET last_attempt_ms=?,interval_ms=? WHERE id=1',nowMs,chooseApproachInterval(latest.interval_ms));
   bindLeadSession(next.lead_id,session);
   if(rotating)advanceRotation(session);
   run("UPDATE prospecting_batch_items SET status='SENDING',attempt_at=? WHERE id=? AND status='QUEUED'",new Date(nowMs).toISOString(),next.id);
   // No duplicate recipient attempts even after crashes.
   run('INSERT OR IGNORE INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',next.lead_id,next.phone,'UNKNOWN',next.id,new Date(nowMs).toISOString());
   return true;
  });
  if(!reserved){settleApproachCredit(next.id,false);return {status:'WAITING'};}
  const recipient=one('SELECT name,business FROM leads WHERE id=?',next.lead_id);
  const message=greetingForProspect(recipient,new Date(time));
  try{
   const result=await send('/api/messages/'+encodeURIComponent(session)+'/'+encodeURIComponent(next.phone+'@s.whatsapp.net')+'/send',{method:'POST',data:{message:{text:message}}});
   run('UPDATE prospecting_send_clock SET last_finished_ms=MAX(last_finished_ms,?) WHERE id=1',currentTime());
   if(result.status!==true)throw Error('Gateway não confirmou entrega');
   settleApproachCredit(next.id,true);
   run("UPDATE prospecting_batch_items SET status='SENT',error=NULL WHERE id=?",next.id);
   run("UPDATE initial_contacts SET status='SENT' WHERE job_id=?",next.id);
   const lead=one('SELECT * FROM leads WHERE id=?',next.lead_id);
   const thread=getThread(lead.id,next.phone+'@s.whatsapp.net');
   addMessage({threadId:thread.id,providerId:'prospect-queue:'+next.id,direction:'out',body:message,status:'sent'});
   registerGreeting({leadId:lead.id,greetingId:next.id,sessionId:session});
   if(lead.stage==='NO_INTEREST')run("UPDATE leads SET stage='CONTACTED',last_activity_at=? WHERE id=?",now(),lead.id);
   audit('PROSPECTING_GREETING_ACCEPTED',lead.id,{batchId:batch.id,intervalSeconds:clock.interval_ms/1000,
    cadence:APPROACH_CADENCE,senderSession:session,senderLabel:rotating?wa.sessionLabel:null,senderNumberLast4:rotating?wa.numberSuffix:null});
   if(rotating)console.info('[approach rotation]',JSON.stringify({sender:wa.sessionLabel||'WhatsApp',lastFour:wa.numberSuffix||null,
    alternationCursor:session,nextExpected:wa.pair?.find(x=>x!==session)||null,acknowledged:true}));
   return {status:'SENT',batchId:batch.id};
  }catch(error){
   settleApproachCredit(next.id,false);
   run('UPDATE prospecting_send_clock SET last_finished_ms=MAX(last_finished_ms,?) WHERE id=1',currentTime());
   run("UPDATE prospecting_batch_items SET status='UNKNOWN',error='Entrega incerta; verificar manualmente' WHERE id=?",next.id);
   audit('PROSPECTING_GREETING_UNKNOWN',next.lead_id,{batchId:batch.id});
   // Failure-closed: one ambiguous autonomous delivery pauses the entire
   // prospecting queue. Never try another recipient until a human reviews
   // the gateway and resumes; the unknown item is never automatically retried.
   if(batch.origin==='AUTONOMOUS'){
    setSetting('paused',true);
    audit('AUTONOMOUS_OUTREACH_PAUSED_UNCERTAIN',null,{batchId:batch.id,manualReviewRequired:true});
    console.warn('[automatic approach] paused: uncertain gateway delivery');
   }
   return {status:'UNKNOWN',batchId:batch.id};
  }
  }finally{
   try{await send(presencePath,{method:'POST',data:{presence:'paused'}});}catch{}
  }
 }finally{locked=false;}
}
