import test from 'node:test';
import assert from 'node:assert/strict';
import {accessClientKey,createAccessLimiter} from '../dashboard/access-rate-limit.mjs';
import {createHmac} from 'node:crypto';

test('only a fresh gateway signature can establish the public client IP',()=>{
 const previous=process.env.ADMIN_ACCESS_TOKEN;process.env.ADMIN_ACCESS_TOKEN='synthetic-gateway-test-key';
 try{const ip='198.51.100.10',at=String(Date.now()),headers={'x-prospector-client-ip':ip,'x-prospector-client-at':at,'x-prospector-client-signature':'0'.repeat(64)},req={headers,socket:{remoteAddress:'127.0.0.1'}};
  assert.equal(accessClientKey(req),'127.0.0.1');headers['x-prospector-client-signature']=createHmac('sha256',process.env.ADMIN_ACCESS_TOKEN).update(ip+'|'+at).digest('hex');assert.equal(accessClientKey(req),'proxy:'+ip);
  headers['x-prospector-client-at']=String(Date.now()-120000);assert.equal(accessClientKey(req),'127.0.0.1');
 }finally{if(previous===undefined)delete process.env.ADMIN_ACCESS_TOKEN;else process.env.ADMIN_ACCESS_TOKEN=previous;}
});
test('forged forwarding headers cannot bypass the default access limit',()=>{
 const previous=process.env.PROSPECTOR_TRUST_PROXY;
 try{
  delete process.env.PROSPECTOR_TRUST_PROXY;
  const req={headers:{'x-forwarded-for':'1.2.3.4'},socket:{remoteAddress:'127.0.0.1'}};
  assert.equal(accessClientKey(req),'127.0.0.1');
  process.env.PROSPECTOR_TRUST_PROXY='true';
  req.headers['x-forwarded-for']='1.2.3.4, 5.6.7.8';
  assert.equal(accessClientKey(req),'5.6.7.8');
  req.headers['x-forwarded-for']='forged';
  assert.equal(accessClientKey(req),'127.0.0.1');
 }finally{if(previous===undefined)delete process.env.PROSPECTOR_TRUST_PROXY;else process.env.PROSPECTOR_TRUST_PROXY=previous;}
});
test('attempts expire, success clears, and new identities cannot evict active limits',()=>{
 const limiter=createAccessLimiter({maxEntries:2,windowMs:100,limit:2});
 limiter.failed('a',0);limiter.failed('a',1);
 assert.equal(limiter.blocked('a',2),true);
 limiter.failed('b',2);
 assert.equal(limiter.blocked('c',3),true);
 assert.equal(limiter.blocked('a',100),false);
 assert.equal(limiter.blocked('c',100),false);
 limiter.clear('b');
 assert.equal(limiter.blocked('b',100),false);
});
