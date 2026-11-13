import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {auditExternalWhatsappLive} from '../dashboard/tenant-live-whatsapp-audit.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-live-read-only-audit-'));
test.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
const folder=path.join(root,'platform');fs.mkdirSync(folder,{recursive:true});
const a=crypto.randomUUID(),b=crypto.randomUUID(),owner=crypto.randomUUID();
const sessionA='prospector-'+crypto.randomUUID(),sessionB='prospector-'+crypto.randomUUID();
const central=new DatabaseSync(path.join(folder,'platform.sqlite'));
central.exec('CREATE TABLE clients(id TEXT PRIMARY KEY,status TEXT NOT NULL,is_internal INTEGER NOT NULL)');
for(const [id,internal] of [[a,0],[b,0],[owner,1]])
 central.prepare('INSERT INTO clients VALUES(?,?,?)').run(id,'active',internal);
central.close();
for(const [id,session] of [[a,sessionA],[b,sessionB]]){
 const dir=path.join(folder,'clients',id);fs.mkdirSync(dir,{recursive:true});
 const db=new DatabaseSync(path.join(dir,'prospector.sqlite'));
 db.exec('CREATE TABLE managed_whatsapp_sessions(session_id TEXT PRIMARY KEY); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
 db.prepare('INSERT INTO managed_whatsapp_sessions(session_id) VALUES(?)').run(session);
 db.prepare("INSERT INTO settings VALUES('waakg_primary_session_id',?)").run(JSON.stringify(session));
 db.close();
}
const request=async(p)=>{
 if(p==='/api/sessions')return {status:true,data:[
  {sessionId:sessionA},{sessionId:sessionB},{sessionId:'consecom-principal'}]};
 const sid=p.split('/')[3];
 return {status:true,data:{sessionId:sid,status:'CONNECTED',hasInstance:true,me:{id:'5511999999999@s.whatsapp.net'}}};
};
test('realistic two-company inventory is read-only and excludes owner',async()=>{
 const result=await auditExternalWhatsappLive({dataDir:root,request});
 assert.equal(result.totalExternalAccounts,2);
 assert.equal(result.activeExternalAccounts,2);
 assert.equal(result.externalDatabasesFound,2);
 assert.equal(result.activeExternalConnected,2);
 assert.equal(result.liveConnectedExternalSessions,2);
 assert.equal(result.gatewaySessionCount,3);
 assert.equal(result.verdict,'TWO_EXTERNAL_ACCOUNTS_CONNECTED');
 assert.equal(result.ownerAccountExcluded,true);
 assert.equal(result.realMessagesSent,0);
 assert.equal(result.disconnectsPerformed,0);
 assert.doesNotMatch(JSON.stringify(result),new RegExp(sessionA+'|'+sessionB+'|'+a+'|'+b));
});
test('provider list with stale sessions does not falsely claim two connected',async()=>{
 const stale=await auditExternalWhatsappLive({dataDir:root,request:async p=>{
  if(p==='/api/sessions')return {status:true,data:[{sessionId:sessionA},{sessionId:sessionB}]};
  const sid=p.split('/')[3];
  return {status:true,data:{sessionId:sid,status:'CONNECTED',hasInstance:false,me:null}};
 }});
 assert.equal(stale.activeExternalConnected,0);
 assert.equal(stale.verdict,'NO_LIVE_EXTERNAL_WHATSAPP_CONNECTIONS');
});
test('gateway unavailable produces unknown, not a false no-connection verdict',async()=>{
 const r=await auditExternalWhatsappLive({dataDir:root,request:async()=>{throw Error('provider unavailable')}});
 assert.equal(r.gatewayChecked,false);
 assert.equal(r.activeExternalConnected,null);
 assert.equal(r.verdict,'GATEWAY_READ_UNAVAILABLE');
});
