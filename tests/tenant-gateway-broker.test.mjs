import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {brokerWorkerToken,createTenantGatewayBroker} from '../dashboard/tenant-gateway-broker.mjs';
import {classifyTenantGatewayRequest,TENANT_GATEWAY_BROKER_PATH} from '../dashboard/tenant-gateway-policy.mjs';
import {workerEnvironment} from '../dashboard/platform.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-waakg-broker-test-'));
const secret='test-central-secret-that-is-never-used-in-production-12345';
const a={id:crypto.randomUUID(),secret:'a'.repeat(64),name:'Oficina Piloto A',is_internal:0,status:'active'};
const b={id:crypto.randomUUID(),secret:'b'.repeat(64),name:'Clínica Piloto B',is_internal:0,status:'active'};
const sidA='prospector-'+crypto.randomUUID(),sidB='prospector-'+crypto.randomUUID();
const owner={id:crypto.randomUUID(),secret:'c'.repeat(64),name:'Consecom',is_internal:1,status:'active'};
function seed(client,sid){
 const directory=path.join(root,'clients',client.id);fs.mkdirSync(directory,{recursive:true});
 const db=new DatabaseSync(path.join(directory,'prospector.sqlite'));
 db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 db.exec('CREATE TABLE managed_whatsapp_sessions(session_id TEXT PRIMARY KEY,label TEXT NOT NULL,created_at TEXT NOT NULL)');
 db.prepare('INSERT INTO managed_whatsapp_sessions VALUES(?,?,?)').run(sid,'WhatsApp da empresa',new Date().toISOString());
 db.prepare('INSERT INTO settings VALUES(?,?)').run('waakg_primary_session_id',JSON.stringify(sid));db.close();
}
seed(a,sidA);seed(b,sidB);
const registry=()=>({list:()=>[a,b],get:id=>[a,b].find(x=>x.id===id)});
const calls=[],mediaCalls=[];
const known=new Set([sidA,sidB,'consecom-principal']);
const sendGateway=async(route,{method='GET',data,brokerTenant=false}={})=>{
 calls.push({route,method,brokerTenant,data});
 assert.equal(brokerTenant,true,'broker may bypass only the parent owner pause');
 if(route==='/api/sessions'&&method==='GET')return {status:true,data:[...known].map(sessionId=>({sessionId,status:'CONNECTED'}))};
 if(route==='/api/sessions'&&method==='POST'){known.add(data.sessionId);return {status:true,data:{sessionId:data.sessionId}};}
 return {status:true,data:{sessionId:route.split('/')[3]||null,status:'CONNECTED'}};
};
const broker=createTenantGatewayBroker({
 registry,root,masterSecret:secret,requestGateway:sendGateway,
 getKey:async()=> 'parent-gateway-api-key-not-exposed',
 fetchFn:async(url,opts={})=>{
  mediaCalls.push({url,headers:opts.headers,method:opts.method});
  if(opts.method==='POST')return Response.json({status:true,data:{accepted:true}});
  return new Response(Buffer.alloc(240,1),{headers:{'content-type':'audio/ogg'}});
 }
});
const server=http.createServer((req,res)=>broker(req,res));
test.after(async()=>{
 await new Promise(resolve=>server.close(resolve));
 fs.rmSync(root,{recursive:true,force:true,maxRetries:20,retryDelay:100});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port+TENANT_GATEWAY_BROKER_PATH;
async function call(client,route,{method='GET',data,raw,contentType,token}={}){
 const response=await fetch(base+route,{method,
  headers:{'X-Prospector-Tenant-Id':client?.id||a.id,
   'X-Prospector-Broker-Token':token??brokerWorkerToken(client||a,secret),
   ...(method==='POST'?{'Content-Type':contentType||'application/json'}:{})
  },body:raw??(method==='POST'?JSON.stringify(data||{}):undefined)});
 const type=response.headers.get('content-type')||'';
 return {status:response.status,data:type.startsWith('application/json')?await response.json():await response.arrayBuffer()};
}

test('external worker never gets shared WA-AKG credentials or the master secret',()=>{
 const old={...process.env};Object.assign(process.env,{
  PORT:'39393',WA_AKG_API_KEY:'shared-api-key',
  WA_AKG_ADMIN_EMAIL:'admin@private.example.test',WA_AKG_ADMIN_PASSWORD:'secret-password',
  PROSPECTOR_DATA_DIR:root
 });
 const x=workerEnvironment(a,43434),y=workerEnvironment(b,43435),z=workerEnvironment(owner,43436);
 for(const v of [x,y]){
  assert.equal(Object.hasOwn(v,'WA_AKG_API_KEY'),false);
  assert.equal(Object.hasOwn(v,'WA_AKG_ADMIN_EMAIL'),false);
  assert.equal(Object.hasOwn(v,'WA_AKG_ADMIN_PASSWORD'),false);
  assert.ok(v.PROSPECTOR_GATEWAY_BROKER_URL.endsWith(TENANT_GATEWAY_BROKER_PATH));
  assert.equal(v.PROSPECTOR_GATEWAY_BROKER_TOKEN.length,64);
 }
 assert.notEqual(x.PROSPECTOR_GATEWAY_BROKER_TOKEN,y.PROSPECTOR_GATEWAY_BROKER_TOKEN);
 assert.notEqual(x.PROSPECTOR_GATEWAY_BROKER_TOKEN,a.secret);
 assert.equal(z.WA_AKG_ADMIN_EMAIL,'admin@private.example.test','internal Consecom remains backward compatible');
 assert.equal(Object.hasOwn(z,'PROSPECTOR_GATEWAY_BROKER_TOKEN'),false);
 for(const key of ['PORT','WA_AKG_API_KEY','WA_AKG_ADMIN_EMAIL','WA_AKG_ADMIN_PASSWORD','PROSPECTOR_DATA_DIR']){
  if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];
 }
});

test('broker prevents customers from viewing other WhatsApps or invoking admin routes',async()=>{
 const listA=await call(a,'/api/sessions'),listB=await call(b,'/api/sessions');
 assert.deepEqual(listA.data.data.map(x=>x.sessionId),[sidA]);
 assert.deepEqual(listB.data.data.map(x=>x.sessionId),[sidB]);
 for(const [client,other] of [[a,sidB],[b,sidA],[a,'consecom-principal']]){
  const denied=await call(client,'/api/sessions/'+other);
  assert.equal(denied.status,403);
  assert.equal(denied.data.error,'GATEWAY_ROUTE_DENIED'===denied.data.error?'GATEWAY_ROUTE_DENIED':'FOREIGN_SESSION_DENIED');
 }
 for(const path of ['/api/user/api-key','/api/auth/csrf','/api/admin/users','/api/sessions/'+sidA+'/delete']){
  assert.equal((await call(a,path)).status,403,path);
 }
 assert.equal((await call(a,'/api/sessions/'+sidA,{token:'wrong'})).status,403);
});

test('a tenant cannot logout, send messages or read another tenant media',async()=>{
 const previous=calls.length;
 assert.equal((await call(a,'/api/sessions/'+sidB+'/logout',{method:'POST'})).status,403);
 assert.equal((await call(a,'/api/messages/'+sidB+'/5511999999999@s.whatsapp.net/send',{method:'POST',data:{message:{text:'invasão'}}})).status,403);
 assert.equal((await call(a,'/api/media/'+sidB+'-sample.ogg')).status,403);
 assert.equal(calls.length,previous,'foreign operations never reach WA-AKG');
 assert.equal((await call(a,'/api/messages/'+sidA+'/5511999999999@s.whatsapp.net/send',{method:'POST',data:{message:{text:'teste permitido'}}})).status,200);
});

test('tenant cannot create a forged, duplicate or Consecom WhatsApp session',async()=>{
 for(const id of ['consecom-principal','prospector-other-account',sidB]){
  assert.equal((await call(a,'/api/sessions',{method:'POST',data:{sessionId:id,name:'Falso'}})).status,403);
 }
 const fresh='prospector-'+crypto.randomUUID();
 const ok=await call(a,'/api/sessions',{method:'POST',data:{sessionId:fresh,name:'Novo número de teste'}});
 assert.equal(ok.status,200);
 assert.equal((await call(b,'/api/sessions/'+fresh)).status,403);
 assert.equal((await call(a,'/api/sessions/'+fresh)).status,200);
});

test('tenant webhook and bot settings cannot point to arbitrary destinations',async()=>{
 const forbidden=await call(a,'/api/webhooks/'+sidA,{method:'POST',data:{
  name:'ataque',url:'https://evil.example.test/collect',secret:'forged',events:['message.received','message.sent','connection.update']
 }});
 assert.equal(forbidden.status,403);
 const approved=await call(a,'/api/webhooks/'+sidA,{method:'POST',data:{
  name:'Prospector',url:'https://prospector-operacional-production.up.railway.app/api/wa-akg/webhook?tenant='+a.id,
  secret:a.secret,events:['message.received','message.sent','connection.update']
 }});
 assert.equal(approved.status,200);
 assert.equal((await call(a,'/api/sessions/'+sidA+'/bot-config',{method:'POST',data:{botMode:'ALL',autoReplyMode:'ALL'}})).status,403);
 assert.equal((await call(a,'/api/sessions/'+sidA+'/bot-config',{method:'POST',data:{
  botMode:'SPECIFIC',autoReplyMode:'SPECIFIC',botAllowedJids:[],autoReplyAllowedJids:[]
 }})).status,200);
});

test('voice media is proxied with the parent key and never exposes it to the tenant',async()=>{
 const get=await call(a,'/api/media/'+sidA+'-demo.ogg');
 assert.equal(get.status,200);
 assert.equal(get.data.byteLength,240);
 const multipart='------prospector-test-boundary\r\nContent-Disposition: form-data; name="type"\r\n\r\nvoice\r\n------prospector-test-boundary--\r\n';
 const send=await call(a,'/api/messages/'+sidA+'/5511999999999@s.whatsapp.net/media',{
  method:'POST',raw:Buffer.from(multipart),contentType:'multipart/form-data; boundary=----prospector-test-boundary'
 });
 assert.equal(send.status,200);
 assert.equal(mediaCalls.length,2);
 assert.ok(mediaCalls.every(x=>x.headers['X-API-Key']==='parent-gateway-api-key-not-exposed'));
 assert.ok(mediaCalls.every(x=>!('X-Prospector-Broker-Token' in x.headers)));
});

test('strict path whitelist rejects other providers, groups, traversal and arbitrary routes',()=>{
 for(const route of ['/api/auth/users','/api/sessions/../../api/user/api-key','/api/messages/'+sidA+'/123@g.us/send',
  '/api/media/other.mp3','/api/sessions/'+sidA+'/delete']){
  assert.equal(classifyTenantGatewayRequest('POST',route),null);
 }
 assert.equal(classifyTenantGatewayRequest('DELETE','/api/sessions/'+sidA),null);
});
