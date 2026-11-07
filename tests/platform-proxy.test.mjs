import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
const source=fs.readFileSync(new URL('../infra/railway/prospector-ui.ts',import.meta.url),'utf8').split('// Safe startup smoke test:')[0].replace(/import \{createHmac,randomBytes,timingSafeEqual\} from "node:crypto";/,'');
test('public proxy forwards client sessions without borrowing or retrying with master credentials',async()=>{
 const calls=[];let handler;
 const env={ACCESS_LINK_TOKEN:'t'.repeat(45),ACCESS_LOGIN_PASSWORD:'test-password-long',ACCESS_SESSION_KEY:'s'.repeat(45),UPSTREAM_URL:'https://backend.example',UPSTREAM_ACCESS_TOKEN:'b'.repeat(45)};
 const context=vm.createContext({Bun:{env,serve:config=>{handler=config.fetch;}},createHmac,randomBytes,timingSafeEqual,Buffer,Headers,Request,Response,URL,AbortSignal,console,
  fetch:async(url,opts={})=>{
   const p=new URL(url).pathname;calls.push({p,cookie:opts.headers?.get?.('cookie')||'',body:opts.body});
   if(p==='/api/auth/exchange')return Response.json({ok:true},{headers:{'Set-Cookie':'ps_session=internal-master; HttpOnly; Secure; Path=/'}});
   if(p==='/api/platform/signin'){
    const headers=new Headers();
    headers.append('Set-Cookie','ps_client=issued-owner; HttpOnly; Secure; Path=/');
    headers.append('Set-Cookie','ps_primary_mode=owner-master; HttpOnly; Secure; Path=/');
    return Response.json({ok:true,next:'/#/dashboard'},{headers});
   }
   if(p==='/api/platform/login')return Response.json({ok:true},{headers:{'Set-Cookie':'ps_client=issued-client; HttpOnly; Secure; Path=/'}});
   if(p.endsWith('/open'))return Response.json({ok:true},{headers:{'Set-Cookie':'ps_client=opened-client; HttpOnly; Secure; Path=/'}});
   if(p==='/api/platform/context')return Response.json({error:'expired'},{status:401});
   return Response.json({items:[]});
  }});
 vm.runInContext(stripTypeScriptTypes(source),context);
 const send=(p,{method='GET',cookie='',origin,body}={})=>handler(new Request('https://prospector-ui-production.up.railway.app'+p,{method,headers:{...(cookie?{cookie}:{}),...(origin?{origin}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}));
 assert.equal((await send('/api/platform/clients')).status,401);assert.equal(calls.length,0);
 const signed=await send('/api/platform/signin',{method:'POST',body:{identifier:'synthetic@example.test',password:'synthetic-test-password'}});
 assert.equal(signed.status,200);
 const signedCookies=signed.headers.getSetCookie();
 assert.ok(signedCookies.some(x=>x.startsWith('ps_client=')));
 assert.ok(signedCookies.some(x=>x.startsWith('ps_primary_mode=')),'Master workspace mode cookie must be forwarded');
 const login=await send('/api/platform/login',{method:'POST',body:{token:'client-token'}});assert.match(login.headers.get('set-cookie'),/^ps_client=/);assert.equal(calls[0].cookie,'');
 calls.length=0;assert.equal((await send('/api/platform/context',{cookie:'ps_client=forged'})).status,401);assert.equal(calls.length,1);assert.equal(calls[0].cookie,'ps_client=forged');
 assert.equal((await send('/api/platform/login',{method:'POST',origin:'https://evil.example',body:{token:'x'}})).status,403);
 const masterLogin=await send('/_access/exchange',{method:'POST',body:{password:env.ACCESS_LOGIN_PASSWORD}});const cookie=masterLogin.headers.get('set-cookie').split(';')[0];calls.length=0;
 const opened=await send('/api/platform/clients/fictitious/open',{method:'POST',cookie,body:{}});assert.equal(opened.status,200);assert.match(opened.headers.get('set-cookie'),/^ps_client=opened-client/);assert.equal(calls[0].p,'/api/auth/exchange');assert.equal(calls.at(-1).cookie,'ps_session=internal-master');
 calls.length=0;assert.equal((await send('/api/platform/context',{cookie:cookie+'; ps_client=expired'})).status,401);assert.equal(calls.length,1);assert.equal(calls[0].cookie,'ps_session=internal-master; ps_client=expired');
});
