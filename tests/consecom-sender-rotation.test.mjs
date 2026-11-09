import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseConsecomAlternatingSender,consecomPairStatus} from '../dashboard/consecom-sender-rotation.mjs';

const sessions=[
 {session_id:'primary-7336',label:'WhatsApp principal',connected:true,numberSuffix:'7336'},
 {session_id:'iphone',label:'iphone',connected:false},
 {session_id:'secondary-2994',label:'Consecom',connected:true,numberSuffix:'2994'},
];

test('alternate primary then Consecom and never select disconnected iphone',()=>{
 const a=chooseConsecomAlternatingSender(sessions,'primary-7336','');
 assert.equal(a.connected,true);
 assert.equal(a.sessionId,'primary-7336');
 assert.equal(a.numberSuffix,'7336');
 const b=chooseConsecomAlternatingSender(sessions,'primary-7336',a.sessionId);
 assert.equal(b.sessionId,'secondary-2994');
 assert.equal(b.numberSuffix,'2994');
 const c=chooseConsecomAlternatingSender(sessions,'primary-7336',b.sessionId);
 assert.equal(c.sessionId,'primary-7336');
 assert.deepEqual(a.pair,['primary-7336','secondary-2994']);
});

test('never send consecutive new approaches from the one remaining connected WhatsApp',()=>{
 const disconnected=sessions.map(x=>x.session_id==='secondary-2994'?{...x,connected:false}:x);
 const r=chooseConsecomAlternatingSender(disconnected,'primary-7336','primary-7336');
 assert.deepEqual(r,{connected:false,reason:'SECONDARY_WHATSAPP_OFFLINE'});
 assert.equal(consecomPairStatus(disconnected,'primary-7336').ready,false);
 const missingPrimary=sessions.map(x=>x.session_id==='primary-7336'?{...x,connected:false}:x);
 assert.equal(chooseConsecomAlternatingSender(missingPrimary,'primary-7336','secondary-2994').reason,'PRIMARY_WHATSAPP_OFFLINE');
});

test('only select named Consecom as number two even if iphone also connects',()=>{
 const allConnected=sessions.map(x=>({...x,connected:true}));
 const r=chooseConsecomAlternatingSender(allConnected,'primary-7336','primary-7336');
 assert.equal(r.sessionId,'secondary-2994');
 const unregistered=sessions.filter(x=>x.label!=='Consecom');
 assert.equal(chooseConsecomAlternatingSender(unregistered,'primary-7336','').reason,'SECONDARY_CONSECOM_SESSION_NOT_UNIQUE');
});
