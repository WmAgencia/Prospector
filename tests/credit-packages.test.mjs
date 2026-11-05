import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {openPlatformStore} from '../dashboard/platform-store.mjs';
import {CREDIT_PACKAGES,getCreditPackage} from '../dashboard/credit-packages.mjs';

test('all published credit packages have unique names and positive price/volume',()=>{
 assert.deepEqual(CREDIT_PACKAGES.map(x=>[x.id,x.credits,x.priceCents]),[
  ['essencial',50,490],['padrao',250,990],['pro',1000,3490],['agencia',5000,14990]
 ]);
 assert.equal(getCreditPackage('inexistente'),null);
});

test('credit purchase requests are tenant scoped, idempotent, and require manual payment confirmation',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-credit-orders-')),store=openPlatformStore(dir);
 try{
  const alice=store.create({name:'Agência A',email:'test-a@example.test'}).client.id;
  const bob=store.create({name:'Agência B',email:'test-b@example.test'}).client.id;
  const key=crypto.randomUUID(),first=store.requestCredits(alice,'padrao',key);
  assert.equal(first.credits,250);assert.equal(first.price_cents,990);
  assert.equal(first.status,'PENDING');assert.equal(store.balance(alice),0);
  assert.equal(store.requestCredits(alice,'padrao',key).id,first.id);
  assert.equal(store.listCreditRequests(alice).length,1);
  assert.equal(store.listCreditRequests(bob).length,0);
  assert.throws(()=>store.settleCreditRequest(first.id,{approved:true}),/Confirme o pagamento/);
  assert.equal(store.balance(alice),0);
  assert.equal(store.settleCreditRequest(first.id,{approved:true,confirmedPayment:true}).status,'APPROVED');
  assert.equal(store.balance(alice),250);
  assert.equal(store.settleCreditRequest(first.id,{approved:true,confirmedPayment:true}).status,'APPROVED');
  assert.equal(store.balance(alice),250,'retrying approval may not double-credit');
  const rejected=store.requestCredits(bob,'essencial',crypto.randomUUID());
  assert.equal(store.settleCreditRequest(rejected.id,{approved:false}).status,'DECLINED');
  assert.equal(store.balance(bob),0);
  assert.throws(()=>store.requestCredits(bob,'invalid',crypto.randomUUID()),/Pacote inválido/);
  assert.equal(store.listCreditRequests().length,2);
 }finally{store.db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('limit pending requests to avoid unwanted duplicate orders',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-credit-pending-')),store=openPlatformStore(dir);
 try{
  const client=store.create({name:'Gestor',email:'gestor@example.test'}).client.id;
  for(let i=0;i<3;i++)store.requestCredits(client,'pro',crypto.randomUUID());
  assert.throws(()=>store.requestCredits(client,'pro',crypto.randomUUID()),/três pedidos/);
 }finally{store.db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
