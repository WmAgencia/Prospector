import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';

test('pilot readiness monitoring is owner-only and read-only',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-pilot-monitor-'));
 const portListener=net.createServer();
 await new Promise(r=>portListener.listen(0,'127.0.0.1',r));
 const port=portListener.address().port;
 await new Promise(r=>portListener.close(r));
 const env={...process.env,PROSPECTOR_DATA_DIR:dir,PORT:String(port),
  NODE_ENV:'production',WHATSAPP_TRANSPORT:'waakg',GROQ_API_KEY:'',
  WA_AKG_API_KEY:'',WA_AKG_ADMIN_EMAIL:'',WA_AKG_ADMIN_PASSWORD:'',
  WA_AKG_SESSION_ID:'',ADMIN_SESSION_SECRET:'p'.repeat(64),ADMIN_ACCESS_TOKEN:'test-admin-token-not-production-'+ 'k'.repeat(36),
  PROSPECTOR_FORCE_OUTREACH_PAUSE:'true',PROSPECTOR_AUTONOMOUS_OUTREACH_OPT_IN:'false'};
 for(const key of Object.keys(env))if(key.startsWith('RUN_')||key.includes('DEMO'))delete env[key];
 const child=spawn(process.execPath,['dashboard/server.mjs'],{env,stdio:'ignore'});
 t.after(async()=>{
  const closed=new Promise(resolve=>child.once('exit',resolve));
  if(process.platform==='win32')try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});}catch{}
  else child.kill('SIGTERM');
  await Promise.race([closed,new Promise(resolve=>setTimeout(resolve,8000))]);
  fs.rmSync(dir,{recursive:true,force:true,maxRetries:15,retryDelay:100});
 });
 const url='http://127.0.0.1:'+port;
 let running=false;
 for(let i=0;i<120;i++){
  try{if((await fetch(url+'/health')).ok){running=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.equal(running,true);
 async function request(route,{method='GET',cookie,body}={}){
  const response=await fetch(url+route,{method,headers:{
   ...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})
  },body:body?JSON.stringify(body):undefined});
  const raw=await response.text();
  let parsed=null;try{parsed=JSON.parse(raw);}catch{}
  return {status:response.status,body:parsed,text:raw,cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 const admin=await request('/api/auth/exchange',{method:'POST',
  body:{token:'test-admin-token-not-production-'+ 'k'.repeat(36)}});
 assert.equal(admin.status,200);
 assert.ok(admin.cookie);
 const signup=await request('/api/platform/clients',{cookie:admin.cookie,method:'POST',
  body:{name:'Empresa Piloto de Teste',email:'pilot@example.test'}});
 assert.equal(signup.status,201);
 const external=await request('/api/platform/login',{method:'POST',
  body:{token:signup.body.token}});
 assert.equal(external.status,200);
 assert.ok(external.cookie);
 assert.equal((await request('/api/platform/pilot-readiness')).status,403,
  'unauthenticated visitors must not see pilot inventory');
 assert.equal((await request('/api/platform/pilot-readiness',{cookie:external.cookie})).status,403,
  'customer cookie must not see pilot inventory');
 assert.equal((await request('/pilot-check',{cookie:external.cookie})).status,403,
  'customer cookie must not access owner page');

 const configured=await request('/api/platform/primary-client',{cookie:admin.cookie,method:'POST',
  body:{name:'Conta interna',email:'internal@example.test',phone:'11999998877',password:'internal-password-for-test-123'}});
 assert.equal(configured.status,200);
 const auth=await request('/api/platform/signin',{method:'POST',
  body:{identifier:'11999998877',password:'internal-password-for-test-123'}});
 assert.equal(auth.status,200);
 assert.ok(auth.cookie);
 const status=await request('/api/platform/pilot-readiness',{cookie:auth.cookie});
 assert.equal(status.status,200);
 assert.equal(status.body.totalExternalAccounts,1);
 assert.equal(status.body.activeExternalAccounts,1);
 assert.equal(status.body.externalDatabasesFound,0);
 assert.equal(status.body.externalSessionRecords,0);
 assert.equal(status.body.activeExternalConnected,0);
 assert.equal(status.body.liveConnectedExternalSessions,0);
 assert.equal(status.body.verdict,'NO_EXTERNAL_SESSION_RECORDS');
 assert.equal(status.body.realMessagesSent,0);
 assert.equal(status.body.disconnectsPerformed,0);
 assert.ok(status.body.checkedAt);
 assert.doesNotMatch(status.text,/pilot@example\.test|internal@example\.test|11999998877/,
  'response must not disclose customer identities or phone numbers');
 const page=await request('/pilot-check',{cookie:auth.cookie});
 assert.equal(page.status,200);
 assert.match(page.text,/Validação do piloto multiempresa/);
 assert.match(page.text,/api\/platform\/pilot-readiness/);
},{timeout:50000});
