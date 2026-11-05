import test from 'node:test';
import assert from 'node:assert/strict';
import {insideApproachWindow} from '../dashboard/outreach-window.mjs';
test('scheduled start date prevents early outreach and preserves the São Paulo window',()=>{
 const previous=process.env.PROSPECTOR_APPROACH_START_DATE;
 try{
  process.env.PROSPECTOR_APPROACH_START_DATE='2026-11-06';
  assert.equal(insideApproachWindow(new Date('2026-11-05T15:00:00Z')),false);
  assert.equal(insideApproachWindow(new Date('2026-11-06T10:59:59Z')),false);
  assert.equal(insideApproachWindow(new Date('2026-11-06T11:00:00Z')),true);
  assert.equal(insideApproachWindow(new Date('2026-11-06T20:30:00Z')),false);
  assert.equal(insideApproachWindow(new Date('2026-11-07T11:00:00Z')),true);
  for(const invalid of ['2026-02-30','invalid','2026-13-01']){
   process.env.PROSPECTOR_APPROACH_START_DATE=invalid;
   assert.equal(insideApproachWindow(new Date('2026-11-06T11:00:00Z')),false);
  }
 }finally{if(previous===undefined)delete process.env.PROSPECTOR_APPROACH_START_DATE;else process.env.PROSPECTOR_APPROACH_START_DATE=previous;}
});
