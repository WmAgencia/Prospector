import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';

test('prelaunch: tenant training and advertised client API contract',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-prelaunch-'));
 const sock=net.createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));
 const port=sock.address().port;await new Promise(r=>sock.close(r));
 const env={...process.env,PORT:String(port),PROSPECTOR_DATA_DIR:dir,WHATSAPP_TRANSPORT:'waakg',NODE_ENV:'test',
  PROSPECTOR_TENANT_ID:'',WA_AKG_SESSION_ID:'',GROQ_API_KEY:'',WA_AKG_API_KEY:'',
  WA_AKG_ADMIN_EMAIL:'',WA_AKG_ADMIN_PASSWORD:'',
  ADMIN_SESSION_SECRET:'prelaunch-test-only-not-production'};
 for(const key of Object.keys(env))if(key.startsWith('RUN_')||key.includes('DEMO')||key.includes('VERIFY'))delete env[key];
 const server=spawn(process.execPath,['dashboard/server.mjs'],{env,stdio:'ignore',windowsHide:true});
 t.after(async()=>{try{server.kill('SIGTERM')}catch{}await new Promise(r=>setTimeout(r,200));
  fs.rmSync(dir,{recursive:true,force:true,maxRetries:30,retryDelay:100});});
 const base='http://127.0.0.1:'+port;
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.equal(ready,true,'sandbox backend must start');
 async function call(route,{method='GET',cookie='',body,raw,contentType}={}){
  const r=await fetch(base+route,{method,headers:{...(cookie?{cookie}:{}),
   ...(body?{'Content-Type':'application/json'}:{}),...(contentType?{'Content-Type':contentType}:{})},
   body:body?JSON.stringify(body):raw});
  const text=await r.text();let value;try{value=JSON.parse(text)}catch{value={raw:text.slice(0,100)}}
  return {status:r.status,body:value,cookie:r.headers.get('set-cookie')?.split(';')[0]};
 }
 const a=(await call('/api/platform/clients',{method:'POST',body:{name:'Piloto A',email:'pilot-a@example.test'}})).body;
 const b=(await call('/api/platform/clients',{method:'POST',body:{name:'Piloto B',email:'pilot-b@example.test'}})).body;
 assert.ok(a.token&&b.token);
 const cookieA=(await call('/api/platform/login',{method:'POST',body:{token:a.token}})).cookie;
 const cookieB=(await call('/api/platform/login',{method:'POST',body:{token:b.token}})).cookie;
 assert.ok(cookieA&&cookieB);
 await t.test('private Francisca interview belongs exclusively to its client',async()=>{
  const start=await call('/api/training/interview/start',{method:'POST',cookie:cookieA,body:{mode:'text'}});
  assert.equal(start.status,200,JSON.stringify(start.body));
  assert.equal(start.body.interview.step,'company');
  const turn=await call('/api/training/interview/turn',{method:'POST',cookie:cookieA,body:{text:'Papelaria Piloto A'}});
  assert.equal(turn.status,200,JSON.stringify(turn.body));
  assert.equal(turn.body.interview.step,'audience');
  const aTraining=await call('/api/training',{cookie:cookieA});
  const bTraining=await call('/api/training',{cookie:cookieB});
  assert.equal(aTraining.body.interview.step,'audience');
  assert.equal(bTraining.body.interview,null);
  const save=await call('/api/training/business',{method:'POST',cookie:cookieA,body:{name:'Papelaria Piloto A'}});
  assert.equal(save.status,200);
  assert.equal((await call('/api/training',{cookie:cookieB})).body.business.name,'Piloto B');
 });
 await t.test('portfolio media upload from client is functional',async()=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/D9kAAAAASUVORK5CYII=','base64');
  const r=await call('/api/media?kind=image&name=Piloto',{method:'POST',cookie:cookieA,raw:png,contentType:'image/png'});
  assert.equal(r.status,201,'the training UI offers this API and expects 201; got '+r.status+' '+JSON.stringify(r.body));
 });
 await t.test('tenant can load overview metrics used by its dashboard',async()=>{
  const result=await call('/api/overview/dimensions',{cookie:cookieA});
  assert.equal(result.status,200,'the dashboard invokes this route; got '+result.status);
 });
 await t.test('tenant cannot access master operations or owner WhatsApp',async()=>{
  assert.equal((await call('/api/platform/clients',{cookie:cookieA})).status,403);
  const wa=await call('/api/whatsapp/status?sessionId=consecom-principal',{cookie:cookieA});
  assert.equal(wa.body.status,'UNAUTHORIZED_SESSION');
 });
},{timeout:45000});
