import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createTenantGatewayBroker,brokerWorkerToken} from '../dashboard/tenant-gateway-broker.mjs';
import {TENANT_GATEWAY_BROKER_PATH} from '../dashboard/tenant-gateway-policy.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-pairing-end-to-end-'));
const companies=[0,1].map(n=>({
 id:crypto.randomUUID(),secret:crypto.randomBytes(48).toString('base64url'),
 name:n?'Clínica de Teste':'Oficina de Teste',status:'active',is_internal:0
}));
const sessions=new Map();
const operations=[];
const fakeGateway=async (route,{method='GET',data,brokerTenant}={})=>{
 assert.equal(brokerTenant,true,'backend must use central authenticated broker');
 operations.push({route,method});
 if(route==='/api/sessions'&&method==='GET')
  return {status:true,data:[...sessions.values()].map(v=>({sessionId:v.id,status:v.status}))};
 if(route==='/api/sessions'&&method==='POST'){
  if(sessions.has(data.sessionId))throw Error('DUPLICATE_SESSION');
  sessions.set(data.sessionId,{id:data.sessionId,status:'INITIALIZING',me:null,hasInstance:false,webhooks:[]});
  return {status:true,data:{sessionId:data.sessionId}};
 }
 const sessionId=route.match(/^\/api\/(?:sessions|webhooks)\/([^/]+)/)?.[1];
 const item=sessions.get(sessionId);
 if(!item)throw Error('UNKNOWN_SESSION');
 if(route==='/api/sessions/'+sessionId&&method==='GET')
  return {status:true,data:{sessionId:item.id,status:item.status,me:item.me,hasInstance:item.hasInstance}};
 if(route==='/api/sessions/'+sessionId+'/bot-config'&&method==='POST')
  return {status:true,data:{...data}};
 if(['/api/sessions/'+sessionId+'/start','/api/sessions/'+sessionId+'/restart'].includes(route)&&method==='POST'){
  item.status='SCAN_QR';item.me=null;item.hasInstance=false;return {status:true,data:{status:item.status}};
 }
 if(route==='/api/sessions/'+sessionId+'/qr'&&method==='GET')
  return {status:true,base64:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/D9kAAAAASUVORK5CYII='};
 if(route==='/api/webhooks/'+sessionId&&method==='GET')
  return {status:true,data:item.webhooks};
 if(route==='/api/webhooks/'+sessionId&&method==='POST'){
  item.webhooks.push({...data,isActive:true});return {status:true,data:data};
 }
 if(route==='/api/sessions/'+sessionId+'/logout'&&method==='POST'){
  item.status='LOGGED_OUT';item.me=null;item.hasInstance=false;return {status:true,data:{status:item.status}};
 }
 throw Error('MOCK_PATH_NOT_ALLOWED: '+route);
};
const broker=createTenantGatewayBroker({
 registry:()=>({list:()=>companies,get:id=>companies.find(x=>x.id===id)}),
 root,masterSecret:'integration-test-secret-do-not-use-in-production',
 requestGateway:fakeGateway
});
const httpServer=http.createServer(broker);
test.after(async()=>{
 await new Promise(resolve=>httpServer.close(resolve));
 fs.rmSync(root,{recursive:true,force:true,maxRetries:20,retryDelay:100});
});
await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
const brokerUrl='http://127.0.0.1:'+httpServer.address().port+TENANT_GATEWAY_BROKER_PATH;
const childSource=`
 import assert from 'node:assert/strict';
 import {waCreateSession,waControlStatus,waGetQR,waSessionList,waDisconnect,waOperationalStatus,getGatewayApiKey} from './dashboard/waakg-control.mjs';
 const mode=process.env.PAIRING_STAGE,own=process.env.PAIRING_SESSION;
 await assert.rejects(getGatewayApiKey(),/GATEWAY_ADMIN_CREDENTIALS_NOT_AVAILABLE_TO_TENANT/);
 if(mode==='create'){
  const before=await waControlStatus();
  assert.equal(before.connected,false);
  const created=await waCreateSession('WhatsApp de teste');
  assert.match(created.sessionId,/^prospector-[0-9a-f-]{36}$/i);
  const qr=await waGetQR(created.sessionId);
  assert.match(qr.qr||'',/^data:image\\/png;base64,/);
  const state=await waControlStatus(created.sessionId);
  assert.equal(state.connected,false);
  const list=await waSessionList();
  assert.equal(list.items.length,1);
  assert.equal(list.items[0].session_id,created.sessionId);
  console.log('PAIRING='+JSON.stringify({sessionId:created.sessionId,qrReady:true,connected:false}));
 }else if(mode==='scanned'){
  const state=await waControlStatus(own);
  assert.equal(state.connected,true);
  assert.equal(state.numberSuffix,'0001');
  const qr=await waGetQR(own);
  assert.equal(qr.connected,true);
  assert.equal(qr.qr,null);
  const live=await waOperationalStatus();
  assert.equal(live.connected,true);
  const list=await waSessionList();
  assert.equal(list.items.length,1);
  assert.equal(list.items[0].session_id,own);
  console.log('PAIRING='+JSON.stringify({sessionId:own,connected:true,qrReady:false}));
 }else if(mode==='disconnect'){
  const done=await waDisconnect(own);
  assert.equal(done.connected,false);
  assert.equal(done.verified,true);
  console.log('PAIRING='+JSON.stringify({sessionId:own,disconnected:true}));
 }else throw Error('Unknown test stage');
`;
async function childRun(client,stage,sessionId=''){
 const env={...process.env,PROSPECTOR_DATA_DIR:path.join(root,'clients',client.id),
  PROSPECTOR_TENANT_ID:client.id,PROSPECTOR_TENANT_NAME:client.name,
  PROSPECTOR_TENANT_INTERNAL:'false',PROSPECTOR_GATEWAY_BROKER_URL:brokerUrl,
  PROSPECTOR_GATEWAY_BROKER_TOKEN:brokerWorkerToken(client,'integration-test-secret-do-not-use-in-production'),
  WA_AKG_SESSION_ID:'',WA_AKG_API_KEY:'',WA_AKG_ADMIN_EMAIL:'',WA_AKG_ADMIN_PASSWORD:'',
  WA_AKG_WEBHOOK_SECRET:client.secret,WHATSAPP_TRANSPORT:'waakg',GROQ_API_KEY:'',
  PROSPECTOR_AUTONOMOUS_OUTREACH_OPT_IN:'false',PROSPECTOR_COLD_FIRST_APPROACH:'false',
  PROSPECTOR_FORCE_OUTREACH_PAUSE:'false',PAIRING_STAGE:stage,PAIRING_SESSION:sessionId};
 for(const key of Object.keys(env))if(key.startsWith('RUN_'))delete env[key];
 const sub=spawn(process.execPath,['--input-type=module','-e',childSource],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
 let output='',errors='';
 sub.stdout.on('data',b=>output+=b.toString());
 sub.stderr.on('data',b=>errors+=b.toString());
 const exitCode=await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{sub.kill('SIGKILL');reject(Error('Child timed out '+stage));},15000);
  sub.once('close',code=>{clearTimeout(timeout);resolve(code)});
  sub.once('error',reject);
 });
 assert.equal(exitCode,0,'client '+client.name+' stage '+stage+': '+errors.slice(0,2500));
 const line=output.split('\n').find(x=>x.startsWith('PAIRING='));
 assert.ok(line,'child should report completed state: '+output.slice(0,500));
 return JSON.parse(line.slice(8));
}
test('two distinct client workspaces can create, scan and independently disconnect WhatsApps',async()=>{
 const a=await childRun(companies[0],'create'),b=await childRun(companies[1],'create');
 assert.notEqual(a.sessionId,b.sessionId);
 assert.equal(sessions.size,2);
 assert.equal(sessions.get(a.sessionId).webhooks.length,1);
 assert.equal(sessions.get(b.sessionId).webhooks.length,1);
 for(const [index,id] of [a.sessionId,b.sessionId].entries()){
  const config=sessions.get(id).webhooks[0];
  assert.equal(config.secret,companies[index].secret);
  assert.equal(config.url,'https://prospector-operacional-production.up.railway.app/api/wa-akg/webhook?tenant='+companies[index].id);
  const instance=sessions.get(id);
  instance.status='CONNECTED';instance.hasInstance=true;instance.me={id:'5511999900001@s.whatsapp.net'};
 }
 assert.equal((await childRun(companies[0],'scanned',a.sessionId)).connected,true);
 assert.equal((await childRun(companies[1],'scanned',b.sessionId)).connected,true);
 await childRun(companies[1],'disconnect',b.sessionId);
 assert.equal(sessions.get(a.sessionId).status,'CONNECTED','disconnect B must not interrupt A');
 assert.equal((await childRun(companies[0],'scanned',a.sessionId)).connected,true);
 assert.equal(sessions.get(b.sessionId).status,'LOGGED_OUT');
 assert.equal(operations.filter(x=>x.route==='/api/sessions'&&x.method==='POST').length,2,'exactly two new gateway sessions');
},{timeout:80000});
