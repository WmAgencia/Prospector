import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {runTwLiveDialogue} from '../dashboard/tw-demo-live-dialogue.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'twco-live-dialogue-qa-'));
const master=path.join(root,'platform'),clientId=crypto.randomUUID(),sid='prospector-'+crypto.randomUUID();
const dbFile=path.join(master,'clients',clientId,'prospector.sqlite'),owner='5515981817336',testNumber='5515999993900';
fs.mkdirSync(path.dirname(dbFile),{recursive:true});
const platform=new DatabaseSync(path.join(master,'platform.sqlite'));
platform.exec('CREATE TABLE clients(id TEXT PRIMARY KEY,name TEXT,status TEXT,is_internal INTEGER)');
platform.prepare('INSERT INTO clients VALUES(?,?,?,?)').run(clientId,'Agência Exemplo · Demonstração','active',0);
platform.close();
const profile=path.join(master,'clients',clientId,'training');fs.mkdirSync(profile,{recursive:true});
const doc='# TW & CO Premium — demonstração\n\nRua Júlio Ribeiro, 876, Sorocaba. Valores só sob orçamento.\n';
fs.writeFileSync(path.join(profile,'francisca.md'),doc);
const db=new DatabaseSync(dbFile);
db.exec([
 'CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);',
 'CREATE TABLE managed_whatsapp_sessions(session_id TEXT PRIMARY KEY);',
 'CREATE TABLE suppressions(phone TEXT PRIMARY KEY);',
 'CREATE TABLE threads(jid TEXT,manual_takeover INTEGER);',
 'CREATE TABLE waakg_inbox(provider_id TEXT PRIMARY KEY,session_id TEXT,jid TEXT,body TEXT,received_at TEXT);',
 'CREATE TABLE groq_auto_events(provider_id TEXT PRIMARY KEY,state TEXT,error TEXT);',
 'CREATE TABLE messages(provider_id TEXT,direction TEXT,body TEXT);'
].join('\n'));
db.prepare('INSERT INTO managed_whatsapp_sessions VALUES(?)').run(sid);
const put=(key,value)=>db.prepare('INSERT INTO settings VALUES(?,?)').run(key,JSON.stringify(value));
put('training_active',{sha256:crypto.createHash('sha256').update(doc).digest('hex')});
put('training_business',{name:'TW & CO Premium — demonstração'});
put('twco_demo_test_reply_guard_v1',{enabled:true,sessionId:sid,senderJid:owner+'@s.whatsapp.net'});
put('paused',true);put('autonomous_outreach_enabled',false);db.close();
test.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
const live=n=>({status:'CONNECTED',hasInstance:true,me:{id:n+'@s.whatsapp.net'}});
const settings=new Map();
let sends=0;
const provider=async(route,{method='GET',data}={})=>{
 if(route==='/api/sessions/consecom-principal')return {status:true,data:live(owner)};
 if(route==='/api/sessions/'+sid)return {status:true,data:live(testNumber)};
 if(method==='POST'&&route==='/api/messages/consecom-principal/'+testNumber+'@s.whatsapp.net/send'){
  sends++;
  assert.equal(data.message.text,'Onde fica a oficina TW & CO em Sorocaba? Preciso do endereço, por favor.');
  const work=new DatabaseSync(dbFile);
  const providerId=sid+':mock-test-1';
  work.prepare('INSERT INTO waakg_inbox VALUES(?,?,?,?,?)')
   .run(providerId,sid,owner+'@s.whatsapp.net',data.message.text,new Date().toISOString());
  work.prepare('INSERT INTO groq_auto_events VALUES(?,?,?)').run(providerId,'SENT','');
  work.prepare('INSERT INTO messages VALUES(?,?,?)').run('groq:'+providerId,'out','A TW & CO está na Rua Júlio Ribeiro, 876, Vila Santana, Sorocaba.');
  work.close();
  return {status:true,data:{acknowledged:true}};
 }
 throw Error('Unexpected gateway path: '+route);
};

test('restricted real QA runs exactly one message for verified demo and confirms provider model response',async()=>{
 const args={dataDir:root,
  env:{RUN_TW_REAL_DIALOGUE_ONCE:'true',PROSPECTOR_FORCE_OUTREACH_PAUSE:'false'},
  gateway:provider,delay:async()=>{},pollAttempts:1,
  getMarker:k=>settings.get(k),setMarker:(k,v)=>settings.set(k,v)};
 const first=await runTwLiveDialogue(args);
 assert.equal(first.status,'REAL_AI_REPLY_ACCEPTED',JSON.stringify(first));
 assert.equal(first.realMessagesSent,1);
 assert.equal(first.responseMentionsAddress,true);
 assert.equal(first.deliveryOnPhoneVerified,false);
 assert.equal(sends,1);
 const second=await runTwLiveDialogue(args);
 assert.equal(second.status,'ALREADY_ATTEMPTED');
 assert.equal(sends,1,'never retry a verified send');
});

test('missing flag and emergency stop perform zero gateway operations',async()=>{
 const disabled=await runTwLiveDialogue({dataDir:root,env:{RUN_TW_REAL_DIALOGUE_ONCE:'false'},gateway:async()=>{throw Error('should not call')}});
 assert.equal(disabled.status,'NOT_ENABLED');
 assert.equal(disabled.realMessagesSent,0);
 const stopped=await runTwLiveDialogue({dataDir:root,env:{RUN_TW_REAL_DIALOGUE_ONCE:'true',PROSPECTOR_FORCE_OUTREACH_PAUSE:'true'},
  getMarker:()=>null,gateway:async()=>{throw Error('should not call')}});
 assert.equal(stopped.status,'EMERGENCY_STOP');
 assert.equal(stopped.realMessagesSent,0);
});
