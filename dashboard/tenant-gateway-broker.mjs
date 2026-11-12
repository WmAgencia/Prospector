// Parent-only WA-AKG broker. Customer workers never receive gateway admin credentials.
// Authorization is checked here IN ADDITION to the worker-local session registry.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {getGatewayApiKey,waRequest} from './waakg-control.mjs';
import {TENANT_GATEWAY_BROKER_PATH,validNewTenantSessionId,classifyTenantGatewayRequest,
 validateBrokerPostBody,BROKER_MEDIA_MAX_BYTES} from './tenant-gateway-policy.mjs';

const localAddress=address=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(String(address||''));
const equal=(a,b)=>{
 const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
 return x.length===y.length&&crypto.timingSafeEqual(x,y);
};
const respond=(res,status,body)=>{
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 res.end(JSON.stringify(body));
};
const gatewayBase=String(process.env.WA_AKG_BASE_URL||'https://wa-akg-production-f9f0.up.railway.app').replace(/\/$/,'');
if(!/^https:\/\//.test(gatewayBase)&&gatewayBase!=='http://wa-akg.railway.internal:3000')
 throw Error('WA-AKG broker requires HTTPS or approved Railway private transport');
function readOwnedSessions(root,client){
 const file=path.join(root,'clients',client.id,'prospector.sqlite');
 if(!fs.existsSync(file))return [];
 let db;
 try{
  db=new DatabaseSync(file,{readOnly:true});
  const ids=[];
  const table=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='managed_whatsapp_sessions'").get();
  if(table)for(const row of db.prepare('SELECT session_id FROM managed_whatsapp_sessions').all())ids.push(row.session_id);
  const setting=db.prepare("SELECT value FROM settings WHERE key='waakg_primary_session_id'").get();
  if(setting){try{ids.push(JSON.parse(setting.value));}catch{}}
  return [...new Set(ids.filter(x=>validNewTenantSessionId(x)))];
 }catch{return [];}
 finally{try{db?.close();}catch{}}
}
async function bodyLimited(req,max){
 const parts=[];let size=0;
 for await(const item of req){
  size+=item.length;
  if(size>max){const e=Error('TOO_LARGE');e.status=413;throw e;}
  parts.push(item);
 }
 return Buffer.concat(parts,size);
}
export function brokerWorkerToken(client,masterSecret){
 return crypto.createHmac('sha256',String(masterSecret||'')).update('tenant-waakg-broker-v1:'+client.id+':'+client.secret).digest('hex');
}
export function createTenantGatewayBroker({registry,root,masterSecret,requestGateway=waRequest,getKey=getGatewayApiKey,fetchFn=fetch}){
 const owners=new Map(),buckets=new Map();
 let loaded=false;
 function syncOwners(){
  for(const client of registry().list()){
   for(const session of readOwnedSessions(root,client)){
    const old=owners.get(session);
    if(old&&old!==client.id)owners.set(session,'CONFLICT');
    else if(!old)owners.set(session,client.id);
   }
  }
  loaded=true;
 }
 function isOwned(client,sid){
  if(!loaded)syncOwners();
  if(!owners.has(sid))syncOwners();
  return owners.get(sid)===client.id;
 }
 function rateAllowed(client){
  const minute=Math.floor(Date.now()/60000),b=buckets.get(client.id);
  if(!b||b.minute!==minute){buckets.set(client.id,{minute,count:1});return true;}
  if(b.count>=240)return false;
  b.count++;return true;
 }
 return async function gatewayBroker(req,res){
  if(!localAddress(req.socket?.remoteAddress))return respond(res,403,{error:'INTERNAL_ONLY'});
  const id=String(req.headers['x-prospector-tenant-id']||'');
  const client=/^[a-f0-9-]{36}$/i.test(id)?registry().get(id):null;
  if(!client||client.status!=='active'||client.is_internal===1||
   !equal(req.headers['x-prospector-broker-token'],brokerWorkerToken(client,masterSecret)))
   return respond(res,403,{error:'INVALID_TENANT_CREDENTIALS'});
  if(!rateAllowed(client))return respond(res,429,{error:'TENANT_GATEWAY_RATE_LIMIT'});
  const url=new URL(req.url,'http://localhost');
  const gatewayPath=url.pathname.slice(TENANT_GATEWAY_BROKER_PATH.length);
  if(!url.pathname.startsWith(TENANT_GATEWAY_BROKER_PATH+'/')||url.search||
     !classifyTenantGatewayRequest(req.method,gatewayPath))
   return respond(res,403,{error:'GATEWAY_ROUTE_DENIED'});
  const policy=classifyTenantGatewayRequest(req.method,gatewayPath);
  if(policy.sessionId&&!isOwned(client,policy.sessionId))
   return respond(res,403,{error:'FOREIGN_SESSION_DENIED'});
  try{
   let raw=null,data=null;
   if(req.method==='POST'){
    raw=await bodyLimited(req,policy.media?BROKER_MEDIA_MAX_BYTES+65536:131072);
    if(policy.media){
     if(!/^multipart\/form-data; boundary=[A-Za-z0-9'()+_,./:=?-]{1,150}$/i.test(String(req.headers['content-type']||'')))
      return respond(res,415,{error:'MEDIA_TYPE_DENIED'});
    }else{
     if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(String(req.headers['content-type']||'')))
      return respond(res,415,{error:'JSON_REQUIRED'});
     try{data=raw.length?JSON.parse(raw.toString('utf8')):{};}
     catch{return respond(res,400,{error:'INVALID_JSON'});}
     if(!validateBrokerPostBody({kind:policy.kind,body:data,tenantId:client.id,secret:client.secret}))
      return respond(res,403,{error:'GATEWAY_BODY_DENIED'});
    }
   }
   if(policy.kind==='create'){
    if(!loaded)syncOwners();else syncOwners();
    if(owners.has(data.sessionId))return respond(res,409,{error:'SESSION_ALREADY_RESERVED'});
    const existing=await requestGateway('/api/sessions',{method:'GET',brokerTenant:true});
    if((existing.data||[]).some(x=>x.sessionId===data.sessionId))
     return respond(res,409,{error:'SESSION_ALREADY_EXISTS'});
   }
   if(policy.kind==='list'){
    if(!loaded)syncOwners();
    const result=await requestGateway('/api/sessions',{method:'GET',brokerTenant:true});
    return respond(res,200,{status:result.status!==false,data:(Array.isArray(result.data)?result.data:[]).filter(x=>isOwned(client,x.sessionId))});
   }
   // Binary audio is never sent through the JSON transport. File paths must
   // contain the exact tenant-owned session prefix, and payloads are bounded.
   if(policy.media){
    const key=await getKey();
    const response=await fetchFn(gatewayBase+gatewayPath,{
     method:req.method,
     headers:{'X-API-Key':key,Accept:policy.kind==='download'?'audio/*':'application/json',
      ...(policy.kind==='media'?{'Content-Type':String(req.headers['content-type'])}:{})},
     ...(raw?{body:raw}:{}),
     redirect:'error',signal:AbortSignal.timeout(policy.kind==='media'?35000:23000)
    });
    const size=Number(response.headers.get('content-length')||0);
    if(size>BROKER_MEDIA_MAX_BYTES)return respond(res,502,{error:'GATEWAY_MEDIA_TOO_LARGE'});
    const buffer=Buffer.from(await response.arrayBuffer());
    if(buffer.length>BROKER_MEDIA_MAX_BYTES)return respond(res,502,{error:'GATEWAY_MEDIA_TOO_LARGE'});
    if(!response.ok)return respond(res,502,{error:'GATEWAY_MEDIA_UNAVAILABLE'});
    res.writeHead(response.status,{'Content-Type':String(response.headers.get('content-type')||'application/octet-stream'),
     'Content-Length':buffer.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(buffer);return;
   }
   const result=await requestGateway(gatewayPath,{method:req.method,data:req.method==='POST'?data:undefined,brokerTenant:true});
   if(policy.kind==='create'){
    if(result.data?.sessionId!==data.sessionId)return respond(res,502,{error:'SESSION_CREATE_UNCONFIRMED'});
    owners.set(data.sessionId,client.id);
   }
   return respond(res,200,result);
  }catch(e){
   const status=e?.status===413?413:502;
   return respond(res,status,{error:status===413?'GATEWAY_REQUEST_TOO_LARGE':'TENANT_GATEWAY_TEMPORARILY_UNAVAILABLE'});
  }
 };
}
