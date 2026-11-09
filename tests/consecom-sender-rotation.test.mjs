import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseConsecomAlternatingSender,consecomPairStatus} from '../dashboard/consecom-sender-rotation.mjs';

const sessions=[
 {session_id:'primary-7336',label:'WhatsApp principal',connected:true,number:'5515999997336',numberSuffix:'7336'},
 {session_id:'iphone',label:'iPhone',connected:true,number:'5515999995555',numberSuffix:'5555'},
 {session_id:'secondary-2994',label:'Consecom',connected:true,number:'5515999992994',numberSuffix:'2994'},
];
test('alternate only verified numbers 7336 and 2994, excluding a connected iPhone',()=>{
 let last='';const suffixes=[];const selected=[];
 for(let i=0;i<8;i++){
  const row=chooseConsecomAlternatingSender(sessions,'primary-7336',last);
  assert.equal(row.connected,true);
  suffixes.push(row.numberSuffix);
  selected.push(row.sessionId);
  last=row.sessionId;
 }
 assert.deepEqual(suffixes,['7336','2994','7336','2994','7336','2994','7336','2994']);
 assert.ok(selected.every(x=>x!=='iphone'));
 assert.equal(consecomPairStatus(sessions,'primary-7336').ready,true);
});
test('fail closed for any wrongly numbered, missing, ambiguous or forged identity',()=>{
 const wrongPrimary=sessions.map(x=>x.session_id==='primary-7336'?{...x,number:'5515999999999',numberSuffix:'9999'}:x);
 assert.equal(chooseConsecomAlternatingSender(wrongPrimary,'primary-7336','').connected,false);
 const wrongSecondary=sessions.map(x=>x.session_id==='secondary-2994'?{...x,number:'5515999998888',numberSuffix:'8888'}:x);
 assert.equal(chooseConsecomAlternatingSender(wrongSecondary,'primary-7336','').connected,false);
 const missing=sessions.map(x=>x.session_id==='secondary-2994'?{...x,number:null,numberSuffix:null}:x);
 assert.equal(chooseConsecomAlternatingSender(missing,'primary-7336','').connected,false);
 const mismatch=sessions.map(x=>x.session_id==='primary-7336'?{...x,numberSuffix:'2994'}:x);
 assert.equal(chooseConsecomAlternatingSender(mismatch,'primary-7336','').connected,false);
 const disconnected=sessions.map(x=>x.session_id==='secondary-2994'?{...x,connected:false}:x);
 assert.equal(chooseConsecomAlternatingSender(disconnected,'primary-7336','').connected,false);
 const duplicated=sessions.concat({...sessions[2],session_id:'another-2994'});
 assert.equal(chooseConsecomAlternatingSender(duplicated,'primary-7336','').connected,false);
 assert.equal(chooseConsecomAlternatingSender(sessions,'secondary-2994','').connected,false);
 assert.equal(chooseConsecomAlternatingSender(sessions,'primary-7336','unknown').connected,false);
});
test('session name is never accepted as proof of the number',()=>{
 const renamed=sessions.map(x=>({...x,label:'iPhone'}));
 assert.equal(chooseConsecomAlternatingSender(renamed,'primary-7336','').connected,true);
 const fakeNamed=sessions.map(x=>x.session_id==='secondary-2994'?{...x,label:'Consecom',number:'5515999991111',numberSuffix:'1111'}:x);
 assert.equal(chooseConsecomAlternatingSender(fakeNamed,'primary-7336','').connected,false);
});
