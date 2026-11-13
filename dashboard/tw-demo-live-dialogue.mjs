// Single real WhatsApp question to the user's own test session, gated on
// verified live identity. Observe the AI answer from tenant SQLite read-only.
// No campaigns, no prospecting, no retries and no other recipients.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {waRequest} from './waakg-control.mjs';
import {getExternalTenantInventory} from './tenant-live-whatsapp-audit.mjs';
import {getSetting,setSetting,now} from './db.mjs';
import {validNewTenantSessionId} from './tenant-gateway-policy.mjs';

export const TW_LIVE_QA_MARKER='owner_twco_live_7336_to_3900_20261113_v1';
const number=x=>String(x?.me?.id||x?.me?.jid||'').split('@')[0].split(':')[0].replace(/\D/g,'');
const isLive=x=>x?.status==='CONNECTED'&&x?.hasInstance===true&&Boolean(x?.me?.id||x?.me?.jid);
const question='Onde fica a oficina TW & CO em Sorocaba? Preciso do endereço, por favor.';
function query(file,callback){
 let db;
 try{db=new DatabaseSync(file,{readOnly:true});return callback(db);}
 finally{try{db?.close()}catch{}}
}
const stored=(db,key)=>{
 const raw=db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
 try{return raw?JSON.parse(raw):null;}catch{return null;}
};
export async function runTwLiveDialogue({
 env=process.env,dataDir=env.PROSPECTOR_DATA_DIR||'data',
 gateway=waRequest,delay=ms=>new Promise(r=>setTimeout(r,ms)),
 getMarker=getSetting,setMarker=setSetting,pollAttempts=48
}={}){
 if(env.RUN_TW_REAL_DIALOGUE_ONCE!=='true'||env.PROSPECTOR_TENANT_ID)
  return {status:'NOT_ENABLED',realMessagesSent:0};
 if(getMarker(TW_LIVE_QA_MARKER,null))return {status:'ALREADY_ATTEMPTED',realMessagesSent:0};
 if(env.PROSPECTOR_FORCE_OUTREACH_PAUSE==='true')return {status:'EMERGENCY_STOP',realMessagesSent:0};
 const inv=getExternalTenantInventory(dataDir);
 const active=inv.tenants.filter(x=>x.status==='active');
 if(inv.tenants.length!==1||active.length!==1||active[0].sessionIds.length!==1)
  return {status:'DEMO_ACCOUNT_NOT_UNIQUE',realMessagesSent:0};
 const session=active[0].sessionIds[0];
 if(!validNewTenantSessionId(session))return {status:'INVALID_EXTERNAL_SESSION',realMessagesSent:0};
 const folder=path.resolve(dataDir,'platform','clients',active[0].id);
 const file=path.join(folder,'prospector.sqlite');
 if(!fs.existsSync(file))return {status:'DEMO_DATABASE_MISSING',realMessagesSent:0};
 let name;
 try{name=query(path.resolve(dataDir,'platform','platform.sqlite'),db=>
  db.prepare('SELECT name FROM clients WHERE id=? AND status=? AND is_internal=0').get(active[0].id,'active')?.name);}
 catch{return {status:'REGISTRY_READ_FAILED',realMessagesSent:0};}
 if(!/^Ag[eê]ncia Exemplo.*Demonstra[cç][aã]o$/i.test(String(name||'')))
  return {status:'NOT_DEMO_ACCOUNT',realMessagesSent:0};
 let source,target;
 try{[source,target]=await Promise.all([
  gateway('/api/sessions/consecom-principal',{method:'GET'}),
  gateway('/api/sessions/'+encodeURIComponent(session),{method:'GET'})]);}
 catch{return {status:'WHATSAPP_STATUS_UNAVAILABLE',realMessagesSent:0};}
 const from=number(source?.data),to=number(target?.data);
 if(!isLive(source?.data)||!isLive(target?.data)||
  !/^55\d{10,11}$/.test(from)||!/^55\d{10,11}$/.test(to)||
  !from.endsWith('7336')||!to.endsWith('3900')||from===to)
  return {status:'WHATSAPP_IDENTITY_MISMATCH',realMessagesSent:0};
 const senderJid=from+'@s.whatsapp.net';
 let safe=false;
 try{safe=query(file,db=>{
  const metadata=stored(db,'training_active'),guard=stored(db,'twco_demo_test_reply_guard_v1'),
   business=stored(db,'training_business');
  const activeMd=path.join(folder,'training','francisca.md');
  if(!metadata?.sha256||!guard?.enabled||guard.senderJid!==senderJid||
   guard.sessionId!==session||!fs.existsSync(activeMd))return false;
  const body=fs.readFileSync(activeMd);
  if(crypto.createHash('sha256').update(body).digest('hex')!==metadata.sha256||
   !body.toString('utf8').includes('TW & CO Premium')||
   !String(business?.name||'').includes('TW & CO Premium'))return false;
  if(stored(db,'autonomous_outreach_enabled')===true||stored(db,'paused')!==true)return false;
  if(db.prepare('SELECT 1 FROM suppressions WHERE phone=?').get(from))return false;
  const taken=db.prepare("SELECT manual_takeover FROM threads WHERE jid=?").get(senderJid);
  if(taken?.manual_takeover===1)return false;
  const existing=db.prepare("SELECT COUNT(*) n FROM groq_auto_events e JOIN waakg_inbox i ON i.provider_id=e.provider_id WHERE i.jid=? AND e.state IN ('PENDING','PROCESSING','SENDING')").get(senderJid)?.n||0;
  return existing===0;
 });}
 catch{return {status:'TENANT_QA_SAFETY_UNAVAILABLE',realMessagesSent:0};}
 if(!safe)return {status:'TRAINING_OR_SAFETY_GATE_NOT_READY',realMessagesSent:0};
 const at=now();
 // Reserve before attempting the send. A rejected or ambiguous provider result
 // is never resent automatically.
 setMarker(TW_LIVE_QA_MARKER,{at,sourceSuffix:'7336',targetSuffix:'3900',status:'ATTEMPTED'});
 let result;
 try{result=await gateway('/api/messages/consecom-principal/'+encodeURIComponent(to+'@s.whatsapp.net')+'/send',
  {method:'POST',data:{message:{text:question}}});}
 catch{return {status:'SEND_UNCONFIRMED_DO_NOT_RETRY',realMessagesSent:'UNKNOWN'};}
 if(result?.status!==true)return {status:'SEND_UNCONFIRMED_DO_NOT_RETRY',realMessagesSent:'UNKNOWN'};
 let seenInbound=false,lastAi='';
 for(let i=0;i<pollAttempts;i++){
  await delay(2500);
  let observed;
  try{observed=query(file,db=>{
   const inbox=db.prepare("SELECT provider_id FROM waakg_inbox WHERE jid=? AND session_id=? AND body=? AND received_at>=? ORDER BY rowid DESC LIMIT 1").get(senderJid,session,question,at);
   if(!inbox)return {inbound:false};
   const event=db.prepare('SELECT state,error FROM groq_auto_events WHERE provider_id=?').get(inbox.provider_id);
   const reply=db.prepare("SELECT body FROM messages WHERE direction='out' AND provider_id=?").get('groq:'+inbox.provider_id);
   return {inbound:true,state:event?.state||'NOT_QUEUED',error:event?.error||'',
    reply:reply?.body||''};
  });}catch{continue;}
  if(!observed.inbound)continue;
  seenInbound=true;lastAi=observed.state;
  if(observed.state==='SENT'&&observed.reply){
   return {status:'REAL_AI_REPLY_ACCEPTED',realMessagesSent:1,
    inboundRecorded:true,modelReplyAccepted:true,
    responseMentionsAddress:/j[úu]lio|vila santana|sorocaba/i.test(observed.reply),
    replyPreview:observed.reply.slice(0,350),sourceSuffix:'7336',demoSuffix:'3900',
    deliveryOnPhoneVerified:false};
  }
  if(['HANDOFF','SKIPPED','UNKNOWN','HOT','CLOSED','SUPERSEDED','DISABLED','PARTIAL'].includes(observed.state))
   return {status:'NO_AI_REPLY',reason:observed.state,realMessagesSent:1,inboundRecorded:true,
    modelReplyAccepted:false};
 }
 return {status:'AI_REPLY_NOT_CONFIRMED',realMessagesSent:1,inboundRecorded:seenInbound,
  latestAiState:lastAi||'NOT_OBSERVED',modelReplyAccepted:false};
}
