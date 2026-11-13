// Read-only production audit: counts external workspaces with live WhatsApp
// sessions, without logging tenant names, IDs, numbers, messages or credentials.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {waRequest} from './waakg-control.mjs';
import {validNewTenantSessionId} from './tenant-gateway-policy.mjs';

function roQuery(file,sql,...args){
 if(!fs.existsSync(file))return [];
 let db;
 try{db=new DatabaseSync(file,{readOnly:true});return db.prepare(sql).all(...args);}
 catch{return [];}
 finally{try{db?.close()}catch{}}
}
export function getExternalTenantInventory(dataDir){
 const root=path.resolve(dataDir,'platform');
 const store=path.join(root,'platform.sqlite');
 const clients=roQuery(store,"SELECT id,status,is_internal FROM clients").filter(x=>x.is_internal!==1);
 const tenants=[],owners=new Map();
 for(const client of clients){
  const file=path.join(root,'clients',client.id,'prospector.sqlite');
  let db,sessionIds=[];
  if(fs.existsSync(file)){
   try{
    db=new DatabaseSync(file,{readOnly:true});
    if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='managed_whatsapp_sessions'").get()){
     sessionIds.push(...db.prepare('SELECT session_id FROM managed_whatsapp_sessions').all().map(x=>x.session_id));
    }
    if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get()){
     const raw=db.prepare("SELECT value FROM settings WHERE key='waakg_primary_session_id'").get()?.value;
     if(raw){try{sessionIds.push(JSON.parse(raw))}catch{}}
    }
   }catch{}finally{try{db?.close()}catch{}}
  }
  sessionIds=[...new Set(sessionIds.filter(validNewTenantSessionId))];
  for(const sid of sessionIds){
   if(!owners.has(sid))owners.set(sid,new Set());
   owners.get(sid).add(client.id);
  }
  tenants.push({id:client.id,status:client.status,sessionIds,dbPresent:fs.existsSync(file)});
 }
 return {tenants,owners};
}
export async function auditExternalWhatsappLive({
 dataDir=process.env.PROSPECTOR_DATA_DIR||'data',
 request=waRequest,maxDetailChecks=24
}={}){
 const {tenants,owners}=getExternalTenantInventory(dataDir);
 const externalActive=tenants.filter(x=>x.status==='active');
 const sessionsRecorded=[...owners.keys()];
 const collisions=[...owners.values()].filter(x=>x.size>1).length;
 const counts={totalExternalAccounts:tenants.length,activeExternalAccounts:externalActive.length,
  externalDatabasesFound:tenants.filter(x=>x.dbPresent).length,
  externalAccountsWithSessions:externalActive.filter(x=>x.sessionIds.length).length,
  externalSessionRecords:sessionsRecorded.length,
  sessionOwnershipConflicts:collisions,
  ownerAccountExcluded:true,realMessagesSent:0,disconnectsPerformed:0,
  contactsRead:0,readOnly:true};
 if(!sessionsRecorded.length)return {...counts,gatewayChecked:false,
  activeExternalConnected:0,liveConnectedExternalSessions:0,verdict:'NO_EXTERNAL_SESSION_RECORDS'};
 let list;
 try{
  list=await request('/api/sessions',{method:'GET',brokerTenant:true});
  if(list?.status===false||!Array.isArray(list.data))throw Error('PROVIDER_LIST_UNAVAILABLE');
 }catch{return {...counts,gatewayChecked:false,activeExternalConnected:null,
  liveConnectedExternalSessions:null,verdict:'GATEWAY_READ_UNAVAILABLE'};}
 const found=new Set(list.data.map(x=>x.sessionId));
 let checked=0,connected=0,unverified=0;
 const connectedTenantIds=new Set();
 for(const tenant of externalActive){
  for(const sid of tenant.sessionIds){
   if(owners.get(sid)?.size!==1||!found.has(sid))continue;
   if(checked>=maxDetailChecks){unverified++;continue;}
   checked++;
   try{
    const detail=await request('/api/sessions/'+encodeURIComponent(sid),{method:'GET',brokerTenant:true});
    const instance=detail?.data||{};
    if(instance.status==='CONNECTED'&&instance.hasInstance===true&&Boolean(instance.me?.id||instance.me?.jid)){
     connected++;
     connectedTenantIds.add(tenant.id);
    }
   }catch{unverified++;}
  }
 }
 return {...counts,gatewayChecked:true,gatewaySessionCount:list.data.length,
  liveDetailChecks:checked,detailErrorsOrUnchecked:unverified,
  activeExternalConnected:connectedTenantIds.size,liveConnectedExternalSessions:connected,
  verdict:collisions?'SESSION_OWNERSHIP_CONFLICT':
   connectedTenantIds.size>=2?'TWO_EXTERNAL_ACCOUNTS_CONNECTED':
    externalActive.length<2?'FEWER_THAN_TWO_ACTIVE_EXTERNAL_ACCOUNTS':
     connectedTenantIds.size===0?'NO_LIVE_EXTERNAL_WHATSAPP_CONNECTIONS':
      'FEWER_THAN_TWO_CONNECTED_EXTERNAL_ACCOUNTS'};
}
