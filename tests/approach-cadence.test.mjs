import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseApproachInterval} from '../dashboard/approach-cadence.mjs';
test('all possible choices are between 90 and 110 seconds and at least 5 seconds apart',()=>{
 for(let previous=90000;previous<=110000;previous+=1000){
  let count;
  chooseApproachInterval(previous,n=>{count=n;return 0;});
  const values=Array.from({length:count},(_,i)=>chooseApproachInterval(previous,()=>i));
  assert.equal(new Set(values).size,count);
  for(const value of values){assert.ok(value>=90000&&value<=110000);assert.ok(Math.abs(value-previous)>=5000);}
 }
});
test('repeated random selections keep the bounds and difference',()=>{
 let previous=0;
 const values=new Set();
 for(let i=0;i<1000;i++){
  const next=chooseApproachInterval(previous);values.add(next);
  assert.ok(next>=90000&&next<=110000);
  assert.ok(Math.abs(next-previous)>=5000);
  previous=next;
 }
 assert.ok(values.size>1);
});
