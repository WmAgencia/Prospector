import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-primary-switch-'));
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.NODE_ENV='test';
process.env.ADMIN_SESSION_SECRET='primary-switch-test-secret-key-no-production';
const {openPlatformStore}=await import('../dashboard/platform-store.mjs');
const {clientCookie,handlePlatform,isPrimaryClient}=await import('../dashboard/platform.mjs');
const {handleFranciscaPanel}=await import('../dashboard/francisca-panel.mjs');
const store=openPlatformStore(path.join(dir,'platform'));
const primary=store.configurePrimary({name:'Conta interna',email:'primary@example.test',phone:'5515999991988',password:'senhaForte123456'});
const ordinary=store.signup({name:'Cliente externo',email:'customer@example.test',phone:'5515999991989',password:'senhaSegura12345',privacyAcknowledged:true});
const token=row=>clientCookie(store.get(row.id)).split(';')[0];

async function call(requestPath,{method='GET',cookie='',data={}}={}){
 const headers={cookie},req={method,headers},res={headers:{},setHeader(key,val){this.headers[key.toLowerCase()]=val;},writeHead(){},end(){}};
 let response=null;
 const handled=await handlePlatform(req,res,new URL('http://localhost'+requestPath),{
  authorized:()=>false,json:async()=>data,respond:(_,status,payload)=>{response={status,payload};}
 });
 return {handled,response,setCookie:res.headers['set-cookie']};
}
test('internal account starts in normal production workspace; external tenants never gain Master',async()=>{
 const result=await call('/api/platform/context',{cookie:token(primary)});
 assert.equal(result.response.status,200);
 assert.equal(result.response.payload.role,'client');
 assert.equal(result.response.payload.canSwitchWorkspace,true);
 const outsider=await call('/api/platform/context',{cookie:token(ordinary)});
 assert.equal(outsider.response.payload.canSwitchWorkspace,false);
 assert.equal(isPrimaryClient({headers:{cookie:token(ordinary)}}),false);
 const blocked=await call('/api/platform/workspace',{method:'POST',cookie:token(ordinary),data:{mode:'master'}});
 assert.equal(blocked.response.status,403);
 assert.equal(blocked.setCookie,undefined);
 const bypass=await call('/api/platform/clients',{cookie:token(ordinary)});
 assert.equal(bypass.response.status,403);
});
test('only signed primary-account mode cookie allows Master and back without logging out',async()=>{
 const initial=token(primary);
 const switched=await call('/api/platform/workspace',{method:'POST',cookie:initial,data:{mode:'master'}});
 assert.equal(switched.response.status,200);
 assert.equal(switched.response.payload.role,'master');
 assert.match(switched.setCookie,/ps_primary_mode=/);
 const masterCookie=switched.setCookie.split(';')[0];
 const combined=initial+'; '+masterCookie;
 const context=await call('/api/platform/context',{cookie:combined});
 assert.equal(context.response.payload.role,'master');
 assert.equal(context.response.payload.canSwitchWorkspace,true);
 assert.equal((await call('/api/platform/clients',{cookie:combined})).response.status,200);
 assert.equal((await call('/api/platform/clients',{cookie:initial})).response.status,403);
 const tampered=await call('/api/platform/context',{cookie:initial+'; '+masterCookie.split('.')[0]+'.invalid'});
 assert.equal(tampered.response.payload.role,'client');
 const copied=await call('/api/platform/context',{cookie:token(ordinary)+'; '+masterCookie});
 assert.equal(copied.response.payload.role,'client');
 const back=await call('/api/platform/workspace',{method:'POST',cookie:combined,data:{mode:'production'}});
 assert.equal(back.response.payload.role,'client');
 const after=await call('/api/platform/context',{cookie:initial+'; '+back.setCookie.split(';')[0]});
 assert.equal(after.response.payload.role,'client');
});
test('Francisca guard still blocks unauthorized master requests but accepts authenticated owner',async()=>{
 const endpoint='/api/ai/francisca-turn',url={pathname:endpoint};
 const req={method:'GET',headers:{}},res={};
 let result;
 const deps={json:async()=>({}),respond:(_,status,payload)=>{result={status,payload};}};
 await handleFranciscaPanel(req,res,url,deps,{masterAuthorized:false});
 assert.equal(result.status,403);
 await handleFranciscaPanel(req,res,url,deps,{masterAuthorized:true});
 assert.equal(result.status,405);
});
test.after(()=>{
 store.db.close();
 fs.rmSync(dir,{recursive:true,force:true});
});
