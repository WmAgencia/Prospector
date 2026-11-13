import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
const customers=6;
const rounds=9;
const parallel=12;
test('six independent SaaS accounts survive a concurrent API load without cross-tenant data',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-multitenant-load-'));
 const tempServer=net.createServer();await new Promise(r=>tempServer.listen(0,'127.0.0.1',r));
 const port=tempServer.address().port;await new Promise(r=>tempServer.close(r));
 const env={...process.env,PORT:String(port),PROSPECTOR_DATA_DIR:dir,NODE_ENV:'test',
  WHATSAPP_TRANSPORT:'waakg',WA_AKG_BASE_URL:'http://wa-akg.railway.internal:3000',
  WA_AKG_ADMIN_EMAIL:'',WA_AKG_ADMIN_PASSWORD:'',WA_AKG_API_KEY:'',
  WA_AKG_SESSION_ID:'',GROQ_API_KEY:'',ADMIN_SESSION_SECRET:'load-test-only-synthetic-secret',
  PROSPECTOR_FORCE_OUTREACH_PAUSE:'true',PROSPECTOR_AUTONOMOUS_OUTREACH_OPT_IN:'false'};
 for(const key of Object.keys(env))if(key.startsWith('RUN_')||key.includes('DEMO')||key.includes('VERIFY'))delete env[key];
 const child=spawn(process.execPath,['dashboard/server.mjs'],{env,stdio:'ignore',windowsHide:true});
 t.after(async()=>{
  const closed=new Promise(resolve=>child.once('exit',resolve));
  if(process.platform==='win32'){try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}catch{}}
  else child.kill('SIGTERM');
  await Promise.race([closed,new Promise(resolve=>setTimeout(resolve,8000))]);
  fs.rmSync(dir,{recursive:true,force:true,maxRetries:30,retryDelay:100});
 });
 const host='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<140;i++){
  try{if((await fetch(host+'/health')).ok){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 assert.equal(ready,true,'synthetic backend should start');
 const request=async(route,{cookie,method='GET',body}={})=>{
  const started=Date.now();
  const response=await fetch(host+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),
   ...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,
   signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  return {ms:Date.now()-started,status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
 };
 const tenants=[];
 for(let i=0;i<customers;i++){
  const name='Empresa de teste '+String(i+1);
  const created=await request('/api/platform/clients',{method:'POST',body:{name,email:'pilot-'+i+'@example.test'}});
  assert.equal(created.status,201);
  const logged=await request('/api/platform/login',{method:'POST',body:{token:created.data.token}});
  assert.equal(logged.status,200);
  tenants.push({name,cookie:logged.cookie,id:created.data.client.id});
 }
 for(const tenant of tenants){
  const trained=await request('/api/training/business',{method:'POST',cookie:tenant.cookie,
   body:{name:tenant.name,description:'Material exclusivo da empresa de teste'}});
  assert.equal(trained.status,200,'each tenant can save private training');
 }
 // Warm the six workers: avoid counting worker cold-start time as load latency.
 await Promise.all(tenants.map(async tenant=>{
  const r=await request('/api/training',{cookie:tenant.cookie});
  assert.equal(r.status,200);
  assert.equal(r.data.business.name,tenant.name);
 }));
 const work=[];
 for(const tenant of tenants){
  for(let i=0;i<rounds;i++){
   work.push({tenant,route:'/api/training'});
   work.push({tenant,route:'/api/overview/dimensions'});
   work.push({tenant,route:'/api/platform/context'});
  }
 }
 const durations=[],errors=[];
 for(let i=0;i<work.length;i+=parallel){
  const responses=await Promise.all(work.slice(i,i+parallel).map(async task=>{
   try{
    const r=await request(task.route,{cookie:task.tenant.cookie});
    if(r.status!==200)errors.push({route:task.route,status:r.status});
    if(task.route==='/api/training'&&r.data.business?.name!==task.tenant.name)
     errors.push({route:task.route,status:'TENANT_DATA_MIXED'});
    durations.push(r.ms);return r;
   }catch(e){errors.push({route:task.route,status:'REQUEST_FAILED'});return null}
  }));
  assert.equal(responses.length,Math.min(parallel,work.length-i));
 }
 assert.deepEqual(errors,[],'no failed API call or tenant data crossover');
 durations.sort((a,b)=>a-b);
 const p95=durations[Math.min(durations.length-1,Math.ceil(durations.length*.95)-1)];
 const max=durations.at(-1);
 assert.ok(p95<12000,'95th percentile should not exceed 12 sec in a small synthetic concurrent load');
 console.log('LOAD_AUDIT='+JSON.stringify({synthetic:true,tenantCount:customers,
  requests:work.length,simultaneousRequests:parallel,successes:durations.length,
  failed:errors.length,p95Ms:p95,maxMs:max,outboundMessagesSent:0,productionDataUsed:false}));
},{timeout:180000});
