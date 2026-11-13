import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {runControlledTenantLiveQa,validateOneShotPair} from '../dashboard/controlled-tenant-live-qa.mjs';

const sender='5515981817336',target='5515999993900';
const live=number=>({status:'CONNECTED',hasInstance:true,me:{id:number+'@s.whatsapp.net'}});
const session='prospector-'+crypto.randomUUID();
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-controlled-qa-'));
test.after(()=>fs.rmSync(dataDir,{recursive:true,force:true,maxRetries:15,retryDelay:100}));
const folder=path.join(dataDir,'platform'),clientId=crypto.randomUUID();
const tenantDir=path.join(folder,'clients',clientId),dbPath=path.join(tenantDir,'prospector.sqlite');
fs.mkdirSync(tenantDir,{recursive:true});
const db=new DatabaseSync(path.join(folder,'platform.sqlite'));
db.exec('CREATE TABLE clients(id TEXT PRIMARY KEY,status TEXT,is_internal INTEGER)');
db.prepare('INSERT INTO clients VALUES(?,?,?)').run(clientId,'active',0);
db.close();
const client=new DatabaseSync(dbPath);
client.exec([
 'CREATE TABLE managed_whatsapp_sessions(session_id TEXT PRIMARY KEY);',
 'CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);',
 'CREATE TABLE suppressions(phone TEXT PRIMARY KEY);',
 'CREATE TABLE waakg_inbox(jid TEXT,session_id TEXT,received_at TEXT);'
].join('\n'));
client.prepare('INSERT INTO managed_whatsapp_sessions VALUES(?)').run(session);
client.close();

test('deny arbitrary senders, recipients, disconnected or trained accounts',()=>{
 assert.equal(validateOneShotPair({
  source:live(sender),target:live(target),tenantSession:session,
  untrained:true,allowTest:true,emergencyPaused:false,recipientSuppressed:false
 }).ok,true);
 for(const x of [
  {source:live('5515981817337')},
  {target:live('5515999991234')},
  {source:{status:'CONNECTED',hasInstance:false,me:{id:sender+'@s.whatsapp.net'}}},
  {tenantSession:'prospector-forged'},
  {untrained:false},
  {allowTest:false},
  {emergencyPaused:true},
  {recipientSuppressed:true}
 ]){
  const trial={source:live(sender),target:live(target),tenantSession:session,
   untrained:true,allowTest:true,emergencyPaused:false,recipientSuppressed:false,...x};
  assert.equal(validateOneShotPair(trial).ok,false,JSON.stringify(x));
 }
});

test('one verified QA send is received by the demo account; repeats are forbidden',async()=>{
 const state=new Map(),calls=[];
 let sends=0;
 const gateway=async(route,{method='GET',data}={})=>{
  calls.push({route,method});
  if(route==='/api/sessions/'+session)return {status:true,data:live(target)};
  if(route==='/api/sessions/consecom-principal')return {status:true,data:live(sender)};
  if(route==='/api/messages/consecom-principal/'+target+'@s.whatsapp.net/send'&&method==='POST'){
   sends++;
   assert.match(data.message.text,/Teste técnico autorizado do Prospector/);
   const x=new DatabaseSync(dbPath);
   x.prepare('INSERT INTO waakg_inbox VALUES(?,?,?)').run(sender+'@s.whatsapp.net',session,new Date().toISOString());
   x.close();
   return {status:true,data:{acknowledged:true}};
  }
  throw Error('Unexpected mock gateway operation');
 };
 const settings={dataDir,gateway,env:{RUN_DEMO_3900_INBOUND_QA_ONCE:'true',PROSPECTOR_FORCE_OUTREACH_PAUSE:'false'},
  delay:async()=>{},markerGet:key=>state.get(key),markerSet:(key,v)=>state.set(key,v)};
 const good=await runControlledTenantLiveQa(settings);
 assert.equal(good.status,'INBOUND_CONFIRMED',JSON.stringify(good));
 assert.equal(good.messagesSent,1);
 assert.equal(sends,1);
 const repeated=await runControlledTenantLiveQa(settings);
 assert.equal(repeated.status,'ALREADY_ATTEMPTED');
 assert.equal(sends,1,'never send twice');
 assert.equal(calls.some(x=>x.route.includes('/send')),true);
});
test('disabled and paused gates cause no WhatsApp operation',async()=>{
 const disabled=await runControlledTenantLiveQa({dataDir,env:{RUN_DEMO_3900_INBOUND_QA_ONCE:'false'},
  gateway:async()=>{throw Error('must not call')}});
 assert.equal(disabled.messagesSent,0);
 assert.equal(disabled.status,'NOT_ENABLED');
 const paused=await runControlledTenantLiveQa({dataDir,env:{RUN_DEMO_3900_INBOUND_QA_ONCE:'true',
  PROSPECTOR_FORCE_OUTREACH_PAUSE:'true'},markerGet:()=>null,
  gateway:async()=>{throw Error('must not call')}});
 assert.equal(paused.status,'EMERGENCY_PAUSE_ACTIVE');
});
test('approved tenant training blocks this pre-training smoke test',async()=>{
 const db=new DatabaseSync(dbPath);
 db.prepare('INSERT INTO settings VALUES(?,?)').run('training_active',JSON.stringify({id:'approved'}));
 db.close();
 const result=await runControlledTenantLiveQa({dataDir,
  env:{RUN_DEMO_3900_INBOUND_QA_ONCE:'true'},
  markerGet:()=>null,markerSet:()=>{throw Error('not permitted')},
  gateway:async route=>{
   if(route==='/api/sessions/'+session)return {status:true,data:live(target)};
   if(route==='/api/sessions/consecom-principal')return {status:true,data:live(sender)};
   throw Error('wrong route');
  }
 });
 assert.equal(result.status,'LIVE_QA_SAFETY_CHECK_FAILED');
 assert.equal(result.messagesSent,0);
});
