import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {tenantSupportReadiness} from '../dashboard/tenant-live-support-readiness.mjs';

test('privacy-safe live audit detects approved and untrained accounts without touching data',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-tenant-live-audit-'));
 try{
  const root=path.join(dir,'platform');fs.mkdirSync(root,{recursive:true});
  const idA=crypto.randomUUID(),idB=crypto.randomUUID(),idOwner=crypto.randomUUID();
  const db=new DatabaseSync(path.join(root,'platform.sqlite'));
  db.exec('CREATE TABLE clients(id TEXT PRIMARY KEY,status TEXT,is_internal INTEGER)');
  for(const [id,internal] of [[idA,0],[idB,0],[idOwner,1]])
   db.prepare('INSERT INTO clients VALUES(?,?,?)').run(id,'active',internal);
  db.close();
  for(const [id,ready] of [[idA,true],[idB,false]]){
   const folder=path.join(root,'clients',id);fs.mkdirSync(folder,{recursive:true});
   const work=new DatabaseSync(path.join(folder,'prospector.sqlite'));
   work.exec([
     'CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);',
     'CREATE TABLE managed_whatsapp_sessions(session_id TEXT PRIMARY KEY);',
     'CREATE TABLE waakg_inbox(received_at TEXT);',
     'CREATE TABLE messages(direction TEXT,provider_id TEXT,at TEXT);',
     'CREATE TABLE threads(manual_takeover INTEGER);',
     'CREATE TABLE groq_auto_events(state TEXT);'
   ].join('\n'));
   work.prepare('INSERT INTO managed_whatsapp_sessions VALUES(?)').run('prospector-'+crypto.randomUUID());
   work.prepare('INSERT INTO waakg_inbox VALUES(?)').run(new Date().toISOString());
   work.prepare('INSERT INTO threads VALUES(?)').run(ready?1:0);
   if(ready){
    const training=path.join(folder,'training');fs.mkdirSync(training,{recursive:true});
    const content='# Manual comercial aprovado da Empresa A\n\nSomente serviços e preços de Empresa A.\n';
    fs.writeFileSync(path.join(training,'francisca.md'),content);
    work.prepare('INSERT INTO settings VALUES(?,?)').run('training_active',
     JSON.stringify({id:'approved',sha256:crypto.createHash('sha256').update(content).digest('hex')}));
    work.prepare('INSERT INTO messages VALUES(?,?,?)').run('out','groq:simulated',new Date().toISOString());
   }else work.prepare('INSERT INTO groq_auto_events VALUES(?)').run('PENDING');
   work.close();
  }
  const result=tenantSupportReadiness({dataDir:dir});
  assert.equal(result.externalAccounts,2);
  assert.equal(result.activeAccounts,2);
  assert.equal(result.externalAccountsWithRegisteredSessions,2);
  assert.equal(result.databasesChecked,2);
  assert.equal(result.trainingApproved,1);
  assert.equal(result.trainingMissing,1);
  assert.equal(result.inboundLast24h,2);
  assert.equal(result.automatedRepliesLast24h,1);
  assert.equal(result.humanTakeoverThreads,1);
  assert.equal(result.pendingAutoEventsWithoutTraining,1);
  assert.equal(result.realMessagesSentByAudit,0);
  assert.equal(result.trainingModifiedByAudit,false);
  assert.doesNotMatch(JSON.stringify(result),new RegExp(idA+'|'+idB+'|idOwner|francisca.md'));
 }finally{fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
