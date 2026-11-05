import test from 'node:test';
import assert from 'node:assert/strict';
import {accessClientKey,createAccessLimiter} from '../dashboard/access-rate-limit.mjs';
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
