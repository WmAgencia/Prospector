import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import {openPlatformStore} from '../dashboard/platform-store.mjs';

test('real HTTP demo invitation, client login, 100 credit balance and blocked outbound actions',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-demo-http-'));
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));
 const port=socket.address().port;await new Promise(r=>socket.close(r));
 const env={...process.env,NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(port),
  PROSPECTOR_DATA_DIR:dir,PROSPECTOR_TENANT_ID:'',
  PROSPECTOR_ENABLE_DEMO_ACCOUNT:'true',
  ADMIN_SESSION_SECRET:'demo-http-test-secret-'+crypto.randomBytes(40).toString('hex'),
  ADMIN_ACCESS_TOKEN:'demo-http-test-admin-'+crypto.randomBytes(25).toString('hex'),
  WA_AKG_API_KEY:'',WA_AKG_SESSION_ID:'',WHATSAPP_TRANSPORT:'waakg'};
 for(const k of Object.keys(env))if(/^RUN_|RAILWAY_/.test(k))delete env[k];
 const child=spawn(process.execPath,['dashboard/server.mjs'],{cwd:path.resolve('.'),env,stdio:'ignore'});
 const stop=async()=>{child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,1500))]);fs.rmSync(dir,{recursive:true,force:true,maxRetries:12,retryDelay:50});};
 t.after(stop);
 const host='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<140;i++){try{if((await fetch(host+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.equal(ready,true,'local Prospector server must start');
 const ledger=openPlatformStore(path.join(dir,'platform'));
 const demo=ledger.list().find(c=>c.demo);
 assert.ok(demo,'demo exists in actual platform database');
 assert.equal(demo.balance,100);
 const token=ledger.rotate(demo.id);
 ledger.db.close();
 const exchange=await fetch(host+'/api/platform/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});
 assert.equal(exchange.status,200);
 const cookie=exchange.headers.get('set-cookie').split(';')[0];
 const get=async uri=>fetch(host+uri,{headers:{cookie}});
 const post=async (uri,obj={})=>fetch(host+uri,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(obj)});
 const context=await (await get('/api/platform/context')).json();
 assert.equal(context.demo,true);
 assert.equal(context.role,'client');
 assert.equal(context.available,100);
 assert.equal(context.needsPasswordSetup,true);
 const credits=await (await get('/api/platform/credits')).json();
 assert.equal(credits.demo,true);
 assert.equal(credits.available,100);
 assert.equal(credits.packages.length,5);
 assert.equal(credits.automaticBilling,false);
 assert.equal((await post('/api/whatsapp/connect',{sessionId:'demo'})).status,403);
 assert.equal((await post('/api/prospecting/search',{niche:'café'})).status,403);
 assert.equal((await post('/api/platform/credit-requests',{packageId:'dia1',requestKey:crypto.randomUUID()})).status,422);
 assert.equal((await get('/client/access')).status,200,'public invitation landing is safe; the fragment token is required for actual account access');
 assert.equal((await get('/api/platform/credits')).status,200);
 assert.equal((await get('/api/state')).status,200,'demo workspace must load normally');
},{timeout:35000});
