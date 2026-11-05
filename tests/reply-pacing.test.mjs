import test from 'node:test';
import assert from 'node:assert/strict';
import {replyDelayMs,waitForReplyPacing} from '../dashboard/reply-pacing.mjs';
test('reply pacing varies by length, has jitter and stays within bounds',()=>{
 assert.equal(replyDelayMs('','',0),8000);
 assert.equal(replyDelayMs('','',4000),12000);
 assert.ok(replyDelayMs('Explique melhor','Uma resposta mais longa',0)>replyDelayMs('Oi','Olá',0));
 assert.equal(replyDelayMs('x'.repeat(10000),'x'.repeat(10000),4000),35000);
});
test('generation time counts, waits are cancellable and slow generation adds no wait',async()=>{
 const previous=process.env.PROSPECTOR_REPLY_PACING_ENABLED;
 process.env.PROSPECTOR_REPLY_PACING_ENABLED='true';
 try{
  let waited=0;
  const wait=async ms=>{waited+=ms;};
  assert.equal(await waitForReplyPacing({incoming:'',reply:'',startedAt:0,stillCurrent:()=>true},{now:()=>3000,wait,jitter:0}),true);
  assert.equal(waited,5000);
  waited=0;
  assert.equal(await waitForReplyPacing({incoming:'',reply:'',startedAt:0,stillCurrent:()=>true},{now:()=>40000,wait,jitter:0}),true);
  assert.equal(waited,0);
  assert.equal(await waitForReplyPacing({incoming:'',reply:'',startedAt:0,stillCurrent:()=>waited===0},{now:()=>0,wait,jitter:0}),false);
  assert.equal(waited,750);
 }finally{if(previous===undefined)delete process.env.PROSPECTOR_REPLY_PACING_ENABLED;else process.env.PROSPECTOR_REPLY_PACING_ENABLED=previous;}
});
