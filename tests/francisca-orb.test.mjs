import test from 'node:test';
import assert from 'node:assert/strict';
import {contourRadius,rmsIntensity,syncFranciscaOrbs,attachFranciscaAudio,detachFranciscaAudio} from '../dashboard/public/francisca-orb.mjs';
test('contours expand with simulated speech energy without scaling the whole sphere',()=>{
 for(const layer of [0,1,2]){
  for(const angle of [0,.4,1,2,4,6]){
   const quiet=contourRadius(angle,1,0,layer);
   const loud=contourRadius(angle,1,1,layer);
   assert.ok(loud>quiet,{layer,angle,quiet,loud});
   assert.ok(loud<114,{layer,angle,loud});
  }
 }
});
test('RMS normalization ignores silence and reacts to louder voice',()=>{
 const silent=new Uint8Array(512).fill(128);
 const soft=new Uint8Array(512).map((_,i)=>128+(i%2?4:-4));
 const loud=new Uint8Array(512).map((_,i)=>128+(i%2?32:-32));
 assert.equal(rmsIntensity(silent),0);
 assert.ok(rmsIntensity(loud)>rmsIntensity(soft));
 assert.ok(rmsIntensity(loud)<=1);
});
test('browser-only operations do not throw in node tests without DOM or microphone',()=>{
 assert.doesNotThrow(()=>syncFranciscaOrbs({floating:'speaking'}));
 assert.equal(attachFranciscaAudio(null,'floating'),false);
 assert.doesNotThrow(()=>detachFranciscaAudio('training'));
});
