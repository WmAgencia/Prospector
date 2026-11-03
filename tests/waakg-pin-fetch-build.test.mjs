import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const docker=readFileSync(path.resolve('waakg-voice/Dockerfile'),'utf8');
test('pinned WA-AKG and voice protocol commits are explicitly fetched in shallow clones',()=>{
 assert(!docker.includes('git clone --depth 1'));
 for(const sha of ['40dc3f14b51bdc9e7b0ad96003594adeabb85b34','f9db8e52f8c0d915f1a1c29f009506e7ec2bf02c']){
  assert(docker.includes('git -c protocol.version=2 fetch --depth=1 origin '+sha));
  assert(docker.includes('git checkout --detach FETCH_HEAD'));
  assert(docker.includes('git rev-parse HEAD'));
 }
});
