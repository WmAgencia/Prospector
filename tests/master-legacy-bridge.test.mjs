import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-master-bridge-'));
process.env.PROSPECTOR_DATA_DIR=tmp;
process.env.ADMIN_SESSION_SECRET='master-bridge-test-isolated-secret-64-symbols-locally';
const {openPlatformStore}=await import('../dashboard/platform-store.mjs');
const {handlePlatform,clientCookie}=await import('../dashboard/platform.mjs');
const store=openPlatformStore(path.join(tmp,'platform'));
const owner=store.configurePrimary({name:'Owner',email:'owner@example.test',phone:'11999990001',password:'mock-owner-password-123'});
const client=store.create({name:'Customer',email:'client@example.test'}).client;

async function request(route,{method='GET',cookie='',ownerAuth=false,input={}}={}){
 let record={status:null,headers:null,body:null,ended:false};
 const req={method,headers:{cookie}};
 const res={headers:{},setHeader(name,value){this.headers[name]=value;},writeHead(status,headers){record.status=status;record.headers=headers;},end(){record.ended=true;}};
 const handled=await handlePlatform(req,res,new URL('https://localhost'+route),{
  authorized:()=>ownerAuth,
  json:async()=>input,
  respond:(response,status,body)=>{record.status=status;record.body=body;record.headers={...response.headers};}
 });
 assert.equal(handled,true);
 return record;
}
const pairs=arr=>Array.isArray(arr)?arr.map(x=>x.split(';')[0]):[arr.split(';')[0]];
test('legacy administrator enters the existing internal Master account',async()=>{
 const r=await request('/master',{ownerAuth:true});
 assert.equal(r.status,302);
 assert.equal(r.headers.Location,'/#/dashboard');
 assert.equal(r.headers['Set-Cookie'].length,2);
 assert.ok(r.headers['Set-Cookie'].some(x=>x.startsWith('ps_client=')));
 assert.ok(r.headers['Set-Cookie'].some(x=>x.startsWith('ps_primary_mode=')));
 const initial=pairs(r.headers['Set-Cookie']).join('; ');
 const ctx=await request('/api/platform/context',{cookie:initial});
 assert.equal(ctx.status,200);
 assert.equal(ctx.body.role,'master');
 assert.equal(ctx.body.internalAccount,true);
 assert.equal(ctx.body.canSwitchWorkspace,true);
 const switched=await request('/api/platform/workspace',{method:'POST',cookie:initial,input:{mode:'production'}});
 assert.equal(switched.status,200);
 assert.equal(switched.body.role,'client');
 const updatedCookie=pairs(r.headers['Set-Cookie']).find(x=>x.startsWith('ps_client='))+'; '+pairs(switched.headers['Set-Cookie'])[0];
 const production=await request('/api/platform/context',{cookie:updatedCookie});
 assert.equal(production.status,200);
 assert.equal(production.body.role,'client');
 assert.equal(production.body.internalAccount,true);
 assert.equal(production.body.canSwitchWorkspace,true);
 const back=await request('/api/platform/workspace',{method:'POST',cookie:updatedCookie,input:{mode:'master'}});
 assert.equal(back.body.role,'master');
 const finalCookie=pairs(r.headers['Set-Cookie']).find(x=>x.startsWith('ps_client='))+'; '+pairs(back.headers['Set-Cookie'])[0];
 assert.equal((await request('/api/platform/context',{cookie:finalCookie})).body.role,'master');
 assert.equal(store.db.prepare('SELECT COUNT(*) n FROM clients WHERE is_internal=1').get().n,1);
});
test('legacy authenticated context also issues an owner session for switch UI',async()=>{
 const r=await request('/api/platform/context',{ownerAuth:true});
 assert.equal(r.status,200);
 assert.equal(r.body.canSwitchWorkspace,true);
 assert.equal(r.body.internalAccount,true);
 assert.equal(r.headers['Set-Cookie'].length,2);
});
test('non-owner is never promoted by opening Master',async()=>{
 const unknown=await request('/master');
 assert.equal(unknown.status,302);
 assert.equal(unknown.headers.Location,'/entrar');
 assert.equal(unknown.headers['Set-Cookie'],undefined);
 const external=await request('/master',{cookie:clientCookie(store.get(client.id))});
 assert.equal(external.status,302);
 assert.equal(external.headers.Location,'/#/overview');
 assert.equal(external.headers['Set-Cookie'],undefined);
});
test.after(()=>{store.db.close();fs.rmSync(tmp,{recursive:true,force:true});});
