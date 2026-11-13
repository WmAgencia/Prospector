// One-shot, owner-authorized test between two verified WhatsApp numbers that
// are both attached to Prospector test workspaces. NEVER used for prospecting,
// customer marketing, automated campaigns or unverified recipients.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {getSetting,setSetting} from './db.mjs';
import {waRequest} from './waakg-control.mjs';
import {getExternalTenantInventory} from './tenant-live-whatsapp-audit.mjs';
import {validNewTenantSessionId} from './tenant-gateway-policy.mjs';

export const REAL_TENANT_QA_MARKER='tenant_live_inbound_7336_to_demo3900_20261113_v1';
const normalizeLiveNumber=x=>String(x?.me?.id||x?.me?.jid||'').split('@')[0].split(':')[0].replace(/\D/g,'');
const active=x=>x?.status==='CONNECTED'&&x?.hasInstance===true&&Boolean(x?.me?.id||x?.me?.jid);

export function validateOneShotPair({source,target,tenantSession,untrained,allowTest,emergencyPaused,recipientSuppressed}={}){
 const s=normalizeLiveNumber(source),t=normalizeLiveNumber(target);
 const safe=(!emergencyPaused&&allowTest===true&&untrained===true&&recipientSuppressed===false&&
  active(source)&&active(target)&&validNewTenantSessionId(tenantSession)&&
  /^55\d{10,11}$/.test(s)&&/^55\d{10,11}$/.test(t)&&s!==t&&
  s.endsWith('7336')&&t.endsWith('3900'));
 return safe?{ok:true,from:s,to:t}:{ok:false,reason:'QA_PAIR_NOT_VERIFIED'};
}
function inspectExternal(file,sourceNumber){
 let db;
 try{
  db=new DatabaseSync(file,{readOnly:true});
  const has=name=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const raw=has('settings')?db.prepare("SELECT value FROM settings WHERE key='training_active'").get()?.value:null;
  let meta=null;try{meta=raw?JSON.parse(raw):null}catch{}
  const markdown=path.join(path.dirname(file),'training','francisca.md');
  // If a training approval exists but its artifact is missing, do not start QA.
  if(meta)return {untrained:false,suppressed:false,uncertain:!fs.existsSync(markdown)};
  const suppressed=has('suppressions')&&!!db.prepare('SELECT 1 FROM suppressions WHERE phone=?').get(sourceNumber);
  return {untrained:true,suppressed,uncertain:false};
 }catch{return {untrained:false,suppressed:true,uncertain:true};}
 finally{try{db?.close()}catch{}}
}
function inboundCount(file,{senderJid,sid,after}){
 let db;
 try{
  db=new DatabaseSync(file,{readOnly:true});
  return Number(db.prepare('SELECT COUNT(*) n FROM waakg_inbox WHERE jid=? AND session_id=? AND received_at>=?')
   .get(senderJid,sid,after)?.n||0);
 }catch{return -1;}
 finally{try{db?.close()}catch{}}
}

export async function runControlledTenantLiveQa({
 dataDir=process.env.PROSPECTOR_DATA_DIR||'data',gateway=waRequest,
 env=process.env,delay=ms=>new Promise(r=>setTimeout(r,ms)),
 markerGet=getSetting,markerSet=setSetting
}={}){
 if(env.RUN_DEMO_3900_INBOUND_QA_ONCE!=='true'||env.PROSPECTOR_TENANT_ID)
  return {status:'NOT_ENABLED',messagesSent:0};
 if(markerGet(REAL_TENANT_QA_MARKER,null))return {status:'ALREADY_ATTEMPTED',messagesSent:0};
 if(env.PROSPECTOR_FORCE_OUTREACH_PAUSE==='true')return {status:'EMERGENCY_PAUSE_ACTIVE',messagesSent:0};
 const root=path.resolve(dataDir,'platform');
 const {tenants}=getExternalTenantInventory(dataDir);
 const external=tenants.filter(t=>t.status==='active');
 if(external.length!==1)return {status:'REQUIRES_EXACTLY_ONE_EXTERNAL_TEST_ACCOUNT',messagesSent:0};
 const tenant=external[0],file=path.join(root,'clients',tenant.id,'prospector.sqlite');
 if(!fs.existsSync(file))return {status:'TEST_ACCOUNT_DATABASE_MISSING',messagesSent:0};
 const requested=[];
 for(const sid of tenant.sessionIds){
  if(!validNewTenantSessionId(sid))continue;
  try{
   const detail=await gateway('/api/sessions/'+sid,{method:'GET'});
   if(active(detail?.data)&&normalizeLiveNumber(detail.data).endsWith('3900'))requested.push({sid,detail:detail.data});
  }catch{}
 }
 if(requested.length!==1)return {status:'EXACT_DEMO_3900_NOT_VERIFIED',messagesSent:0};
 const target=requested[0];
 let source;
 try{
  const detail=await gateway('/api/sessions/consecom-principal',{method:'GET'});
  source=detail?.data;
 }catch{return {status:'OWNER_7336_SESSION_UNAVAILABLE',messagesSent:0};}
 const sender=normalizeLiveNumber(source);
 const checks=inspectExternal(file,sender);
 const pair=validateOneShotPair({source,target:target.detail,tenantSession:target.sid,
  untrained:checks.untrained&&!checks.uncertain,
  allowTest:true,emergencyPaused:false,recipientSuppressed:checks.suppressed});
 if(!pair.ok)return {status:'LIVE_QA_SAFETY_CHECK_FAILED',messagesSent:0};
 const senderJid=pair.from+'@s.whatsapp.net';
 const at=new Date().toISOString();
 const already=inboundCount(file,{senderJid,sid:target.sid,after:at});
 if(already<0)return {status:'INBOX_NOT_INITIALIZED',messagesSent:0};
 // Set the one-time marker BEFORE the attempt. If delivery is ambiguous, NEVER retry.
 markerSet(REAL_TENANT_QA_MARKER,{attemptedAt:at,status:'ATTEMPTED',senderSuffix:'7336',recipientSuffix:'3900'});
 const text='Teste técnico autorizado do Prospector: verificando o recebimento na conta de demonstração. Não é uma proposta comercial; não é necessário responder.';
 let result;
 try{
  result=await gateway('/api/messages/consecom-principal/'+pair.to+'@s.whatsapp.net/send',
   {method:'POST',data:{message:{text}}});
 }catch{return {status:'DELIVERY_UNCONFIRMED_DO_NOT_RETRY',messagesSent:'UNKNOWN'};}
 if(result?.status!==true)return {status:'DELIVERY_UNCONFIRMED_DO_NOT_RETRY',messagesSent:'UNKNOWN'};
 for(let i=0;i<12;i++){
  await delay(2500);
  const count=inboundCount(file,{senderJid,sid:target.sid,after:at});
  if(count>0)return {status:'INBOUND_CONFIRMED',messagesSent:1,inboundRegistered:true,
    recipientTrainingApproved:false,expectedAutomaticReply:false,sourceSuffix:'7336',targetSuffix:'3900'};
 }
 return {status:'PROVIDER_ACCEPTED_WEBHOOK_UNCONFIRMED',messagesSent:1,
  inboundRegistered:false,sourceSuffix:'7336',targetSuffix:'3900'};
}
