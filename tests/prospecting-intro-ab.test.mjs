import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initIntroAB,reserveIntroAB,WESLEY_INTRO,WESLEY_INTRO_B} from '../dashboard/prospecting-intro-ab.mjs';
test('two senders alternate A A B B independently, with persistent idempotent allocations',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'intro-ab-')),file=path.join(dir,'db.sqlite');
 let db=new DatabaseSync(file);
 const allocate=(sessionId,greetingId,enabled=true)=>reserveIntroAB(db,{sessionId,greetingId,enabled});
 try{
  initIntroAB(db);
  assert.deepEqual(allocate('one','g1'),{variant:'A',message:WESLEY_INTRO});
  assert.deepEqual(allocate('two','g2'),{variant:'A',message:WESLEY_INTRO});
  assert.deepEqual(allocate('one','g3'),{variant:'B',message:WESLEY_INTRO_B});
  assert.deepEqual(allocate('two','g4'),{variant:'B',message:WESLEY_INTRO_B});
  db.close();db=new DatabaseSync(file);initIntroAB(db);
  assert.equal(allocate('one','g3').variant,'B');
  assert.equal(allocate('one','g5').variant,'A');
  assert.equal(allocate('two','g6').variant,'A');
  assert.equal(allocate('one','g7').variant,'B');
  assert.equal(allocate('two','g8').variant,'B');
  assert.throws(()=>allocate('two','g1'),/session mismatch/);
  assert.equal(allocate('three','g9',false).variant,'A');
  assert.equal(allocate('three','g10',false).variant,'A');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM prospector_intro_ab').get().n,10);
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('independent allocation remains balanced when one number is offline',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  initIntroAB(db);
  const variant=(sessionId,greetingId)=>reserveIntroAB(db,{sessionId,greetingId}).variant;
  assert.deepEqual([variant('1','a'),variant('1','b'),variant('2','c'),variant('1','d'),variant('2','e')],['A','B','A','A','B']);
 }finally{db.close();}
});
