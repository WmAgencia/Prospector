import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

function gateway(fetcher){
 const source=fs.readFileSync(new URL('../infra/railway/prospector-ui.ts',import.meta.url),'utf8')
  .split('// Safe startup smoke test:')[0].replace(/import \{createHmac,randomBytes,timingSafeEqual\} from "node:crypto";/,'');
 let handler;
 const context={Buffer,URL,URLSearchParams,Headers,Request,Response,AbortSignal,Date,Set,Map,console,
  createHmac,randomBytes,timingSafeEqual,fetch:fetcher,
  Bun:{env:{ACCESS_LINK_TOKEN:'t'.repeat(40),ACCESS_LOGIN_PASSWORD:'test-only-password',ACCESS_SESSION_KEY:'s'.repeat(40),
   UPSTREAM_URL:'https://backend.example',UPSTREAM_ACCESS_TOKEN:'b'.repeat(40),RAILWAY_PUBLIC_DOMAIN:'panel.example'},
   serve:options=>{handler=options.fetch;}}};
 vm.runInNewContext(stripTypeScriptTypes(source),context);
 return async(path,options={})=>handler(new Request('https://panel.example'+path,options));
}
async function login(call){
 const response=await call('/_access/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'test-only-password'})});
 assert.equal(response.status,200);
 return response.headers.get('set-cookie').split(';')[0];
}
const backendCookie=n=>new Response('{}',{headers:{'set-cookie':'ps_session=session-'+n+'; Max-Age=7776000; HttpOnly; Secure'}});

test('gateway renews a rejected backend session and recovers the original GET',async()=>{
 let exchanges=0,calls=0;
 const call=gateway(async(url,options)=>{
  if(String(url).endsWith('/api/auth/exchange'))return backendCookie(++exchanges);
  calls++;
  return options.headers.get('cookie')==='ps_session=session-1'?new Response('{}',{status:401}):new Response('{"ok":true}');
 });
 const cookie=await login(call);
 const response=await call('/api/state',{headers:{cookie}});
 assert.equal(response.status,200);
 assert.equal(exchanges,2);
 assert.equal(calls,2);
});

test('gateway contains backend authentication failures as HTTP 502',async()=>{
 const call=gateway(async()=>new Response('{}',{status:503}));
 const cookie=await login(call);
 const response=await call('/api/state',{headers:{cookie}});
 assert.equal(response.status,502);
});

test('gateway shares concurrent backend authentication and bounds rejected retries',async()=>{
 let exchanges=0;
 const call=gateway(async url=>{
  if(String(url).endsWith('/api/auth/exchange')){exchanges++;await new Promise(resolve=>setTimeout(resolve,5));return backendCookie(exchanges);}
  return new Response('{}',{status:401});
 });
 const cookie=await login(call);
 const responses=await Promise.all([call('/api/state',{headers:{cookie}}),call('/api/state',{headers:{cookie}})]);
 assert.ok(responses.every(r=>r.status===401));
 assert.equal(exchanges,2);
});

test('gateway sends bearer MCP traffic without exchanging an administrator session',async()=>{
 let seen;
 const call=gateway(async(url,options)=>{seen={url:String(url),headers:options.headers};return new Response('{}',{status:401,headers:{'www-authenticate':'Bearer resource_metadata="https://panel.example/.well-known/oauth-protected-resource/mcp"'}});});
 const response=await call('/mcp',{method:'POST',headers:{authorization:'Bearer test-client-token','mcp-protocol-version':'2025-11-25','content-type':'application/json'},body:'{}'});
 assert.equal(seen?.url,'https://backend.example/mcp');
 assert.equal(seen.headers.get('authorization'),'Bearer test-client-token');
 assert.equal(seen.headers.get('cookie'),null);
 assert.equal(seen.headers.get('mcp-protocol-version'),'2025-11-25');
 assert.match(response.headers.get('www-authenticate'),/resource_metadata/);
});

test('gateway does not expose arbitrary API routes to an anonymous bearer client',async()=>{
 let calls=0;
 const call=gateway(async()=>{calls++;return new Response('{}');});
 assert.equal((await call('/api/state',{headers:{authorization:'Bearer fake'}})).status,401);
 assert.equal(calls,0);
});

test('gateway preserves OAuth login return path and forwards only its approval cookie',async()=>{
 let seen;
 const call=gateway(async(url,options)=>{
  if(String(url).endsWith('/api/auth/exchange'))return backendCookie(1);
  seen=options.headers;
  return new Response(null,{status:302,headers:{location:'https://client.example/callback?code=test',
   'set-cookie':'ps_mcp_approval=nonce; HttpOnly; Secure; SameSite=Strict; Path=/oauth'}});
 });
 const authorize='/oauth/authorize?client_id=test&state=state';
 const redirected=await call(authorize);
 assert.equal(redirected.status,302);
 assert.equal(new URL('https://panel.example'+redirected.headers.get('location')).searchParams.get('next'),authorize);
 const cookie=await login(call);
 const response=await call('/oauth/approve',{method:'POST',headers:{cookie:cookie+'; ps_mcp_approval=nonce; other=private',origin:'https://panel.example'},body:'approve=1'});
 assert.equal(seen.get('origin'),'https://panel.example');
 assert.equal(seen.get('x-forwarded-host'),'panel.example');
 assert.equal(seen.get('cookie'),'ps_session=session-1; ps_mcp_approval=nonce');
 assert.equal(response.headers.get('location'),'https://client.example/callback?code=test');
 assert.match(response.headers.get('set-cookie'),/^ps_mcp_approval=/);
});

test('gateway renews before replaying a rejected write and preserves its exact body',async()=>{
 let exchanges=0;
 const bodies=[];
 const call=gateway(async(url,options)=>{
  if(String(url).endsWith('/api/auth/exchange'))return backendCookie(++exchanges);
  bodies.push(await new Response(options.body).text());
  return options.headers.get('cookie')==='ps_session=session-1'?new Response('{}',{status:401}):new Response('{}');
 });
 const cookie=await login(call);
 const response=await call('/api/settings',{method:'POST',headers:{cookie,origin:'https://panel.example'},body:'{"paused":true}'});
 assert.equal(response.status,200);
 assert.deepEqual(bodies,['{"paused":true}','{"paused":true}']);
 assert.equal(exchanges,2);
});
