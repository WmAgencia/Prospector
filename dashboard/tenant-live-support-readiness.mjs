// Privacy-safe production inspection. Reads customer SQLite databases in read-only
// mode and never sends a message, approves training or changes any workspace.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {getExternalTenantInventory} from './tenant-live-whatsapp-audit.mjs';

const table=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const num=(db,sql,...args)=>Number(db.prepare(sql).get(...args)?.n||0);
export function tenantSupportReadiness({dataDir=process.env.PROSPECTOR_DATA_DIR||'data',at=Date.now()}={}){
 const root=path.resolve(dataDir,'platform');
 const {tenants}=getExternalTenantInventory(dataDir);
 const limit=new Date(at-86400000).toISOString();
 const stats={
  externalAccounts:tenants.length,activeAccounts:tenants.filter(x=>x.status==='active').length,
  externalAccountsWithRegisteredSessions:tenants.filter(x=>x.status==='active'&&x.sessionIds.length>0).length,
  databasesChecked:0,trainingApproved:0,trainingMissing:0,trainingIntegrityFailures:0,
  inboundLast24h:0,automatedRepliesLast24h:0,humanTakeoverThreads:0,
  pendingAutoEventsWithoutTraining:0,unavailableDatabases:0,readOnly:true,
  realMessagesSentByAudit:0,trainingModifiedByAudit:false
 };
 for(const tenant of tenants.filter(x=>x.status==='active')){
  const folder=path.join(root,'clients',tenant.id);
  const file=path.join(folder,'prospector.sqlite');
  if(!fs.existsSync(file)){stats.unavailableDatabases++;continue;}
  let db;
  try{
   db=new DatabaseSync(file,{readOnly:true});
   stats.databasesChecked++;
   const raw=table(db,'settings')?
    db.prepare("SELECT value FROM settings WHERE key='training_active'").get()?.value:null;
   let profile=null;
   try{profile=raw?JSON.parse(raw):null;}catch{}
   const md=path.join(folder,'training','francisca.md');
   let ready=false;
   if(profile?.sha256&&fs.existsSync(md)){
    try{
     const body=fs.readFileSync(md);
     ready=crypto.createHash('sha256').update(body).digest('hex')===profile.sha256;
    }catch{}
    if(!ready)stats.trainingIntegrityFailures++;
   }
   if(ready)stats.trainingApproved++;else stats.trainingMissing++;
   if(table(db,'waakg_inbox'))
    stats.inboundLast24h+=num(db,'SELECT COUNT(*) n FROM waakg_inbox WHERE received_at>=?',limit);
   if(table(db,'messages'))
    stats.automatedRepliesLast24h+=num(db,"SELECT COUNT(*) n FROM messages WHERE direction='out' AND provider_id LIKE 'groq:%' AND at>=?",limit);
   if(table(db,'threads'))stats.humanTakeoverThreads+=num(db,'SELECT COUNT(*) n FROM threads WHERE manual_takeover=1');
   if(!ready&&table(db,'groq_auto_events'))
    stats.pendingAutoEventsWithoutTraining+=num(db,"SELECT COUNT(*) n FROM groq_auto_events WHERE state IN ('PENDING','PROCESSING','SENDING')");
  }catch{stats.unavailableDatabases++;}
  finally{try{db?.close();}catch{}}
 }
 return stats;
}
