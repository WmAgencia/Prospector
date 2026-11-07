import test from 'node:test';
import assert from 'node:assert/strict';
import {offerVariantForOrdinal} from '../dashboard/consecom-offer-rotation.mjs';

test('approved offer alternates between audio and text per eligible contact',()=>{
 const sequence=Array.from({length:12},(_,index)=>offerVariantForOrdinal(index));
 assert.deepEqual(sequence,['AUDIO','TEXT','AUDIO','TEXT','AUDIO','TEXT','AUDIO','TEXT','AUDIO','TEXT','AUDIO','TEXT']);
 assert.equal(sequence.filter(x=>x==='AUDIO').length,6);
 assert.equal(sequence.filter(x=>x==='TEXT').length,6);
});

test('offer rotation rejects missing, negative and malformed sequence positions',()=>{
 for(const index of [-1,1.5,NaN,undefined,'1'])assert.throws(()=>offerVariantForOrdinal(index));
});
