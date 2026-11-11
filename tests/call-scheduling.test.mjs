import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Run in a fresh database to avoid side effects on existing campaigns.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-call-scheduling-'));
try {
 const script=String.raw`
 const {availableCallSlots}=await import('./dashboard/call-scheduling.mjs');
 const at=(s)=>availableCallSlots(Date.parse(s)).map(x=>
  new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(x)));
 const morning=at('2026-11-11T13:00:00.000Z');  // 10:00 local
 const lunch=at('2026-11-11T15:40:00.000Z');    // 12:40 local
 const evening=at('2026-11-11T20:40:00.000Z');  // 17:40 local
 const before=at('2026-11-11T14:11:00.000Z');   // 11:11 local
 console.log(JSON.stringify({morning,lunch,evening,before}));
 \`.replace(/^\\\`|\\\`$/g,'');
 const child=spawnSync(process.execPath,['--input-type=module','-e',script],{
  cwd:process.cwd(),encoding:'utf8',
  env:{...process.env,PROSPECTOR_DATA_DIR:dir,PROSPECTOR_TENANT_ID:''}
 });
 test('Available slots respect Brasília time, half-hours, lunch and 17:30 cutoff',()=>{
  assert.equal(child.status,0,child.stderr);
  const r=JSON.parse(child.stdout.trim().split('\n').at(-1));
  assert.equal(r.morning[0],'10:30');
  assert.equal(r.morning.at(-1),'17:30');
  assert.equal(r.morning.length,15);
  assert.deepEqual(r.lunch,['15:00','15:30','16:00','16:30','17:00','17:30']);
  assert.equal(r.before[0],'12:00');
  assert.deepEqual(r.evening,[]);
 });
} finally {fs.rmSync(dir,{recursive:true,force:true});}
