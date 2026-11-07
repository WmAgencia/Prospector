import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openPlatformStore} from '../dashboard/platform-store.mjs';
const key=process.env.ADMIN_SESSION_SECRET;process.env.ADMIN_SESSION_SECRET='paid-onboarding-test-secret';
function sandbox(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-paid-onboard-'));
 const store=openPlatformStore(root);
 t.after(()=>{store.db.close();fs.rmSync(root,{recursive:true,force:true});});
 return store;
}
const makeInfo=(order,email)=>({requestId:order.id,packageId:order.package_id,amountCents:order.price_cents,
 sessionId:'cs_live_'+order.id.replaceAll('-',''),eventId:'evt_'+order.id.replaceAll('-',''),customerEmail:email});
test('paid selection never creates customer before signed payment and activation',t=>{
 const s=sandbox(t);
 const order=s.createPaidSignupOrder('dias7');
 assert.equal(s.list().length,0);
 const info=makeInfo(order,'comprador@exemplo.com');
 s.attachPaidSignupSession(order.id,info.sessionId);
 assert.equal(s.paidSignupStatus(info.sessionId).status,'PENDING');
 assert.throws(()=>s.activatePaidSignup({sessionId:info.sessionId,name:'Agência Teste',password:'senha-segura-123',privacyAcknowledged:true}),/confirmado/);
 assert.equal(s.list().length,0);
 assert.throws(()=>s.confirmPaidSignupPayment({...info,amountCents:15}),/não corresponde/);
 assert.equal(s.list().length,0);
 const result=s.confirmPaidSignupPayment(info);
 assert.equal(result.ok,true);
 assert.equal(s.paidSignupStatus(info.sessionId).status,'PAID');
 assert.equal(s.list().length,0);
 const activated=s.activatePaidSignup({sessionId:info.sessionId,name:'Agência Teste',password:'senha-segura-123',privacyAcknowledged:true});
 assert.equal(activated.existing,false);
 assert.equal(s.list().length,1);
 assert.equal(s.balance(activated.client.id),1750);
 assert.equal(s.signin({email:'comprador@exemplo.com',password:'senha-segura-123'}).id,activated.client.id);
 assert.equal(s.paidSignupStatus(info.sessionId).status,'CLAIMED');
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM verified_payments').get().n,1);
 assert.throws(()=>s.activatePaidSignup({sessionId:info.sessionId,name:'Outra Agência',password:'senha-segura-123',privacyAcknowledged:true}),/ativada/);
});
test('signed payment for an existing account adds credits without creating another account or changing password',t=>{
 const s=sandbox(t);
 const created=s.create({name:'Conta Existente',email:'existente@exemplo.com'});
 const order=s.createPaidSignupOrder('dia1'),info=makeInfo(order,'existente@exemplo.com');
 s.attachPaidSignupSession(order.id,info.sessionId);
 assert.equal(s.confirmPaidSignupPayment(info).ok,true);
 assert.equal(s.balance(created.client.id),250);
 assert.equal(s.list().length,1);
 assert.equal(s.paidSignupStatus(info.sessionId).status,'CLAIMED');
 const dup=s.confirmPaidSignupPayment(info);
 assert.equal(dup.duplicate,true);
 assert.equal(s.balance(created.client.id),250);
});
test('unrecognized session and wrong package cannot activate paid account',t=>{
 const s=sandbox(t);const order=s.createPaidSignupOrder('dias3'),info=makeInfo(order,'pessoa@exemplo.com');
 s.attachPaidSignupSession(order.id,info.sessionId);
 assert.throws(()=>s.confirmPaidSignupPayment({...info,packageId:'dia1'}),/não corresponde/);
 assert.throws(()=>s.activatePaidSignup({sessionId:info.sessionId,name:'Empresa Um',password:'senha-segura-123',privacyAcknowledged:true}),/não confirmado/);
 assert.equal(s.list().length,0);
});
test('Stripe checkout request for signup uses only server-selected price, no client account',async t=>{
 const {embeddedCheckoutForSignup}=await import('../dashboard/stripe-billing.mjs');
 const env=['STRIPE_SECRET_KEY','STRIPE_PUBLISHABLE_KEY','STRIPE_PROSPECTOR_PAYMENT_LINKS','STRIPE_PROSPECTOR_WEBHOOK_SECRET'];
 const old=Object.fromEntries(env.map(k=>[k,process.env[k]])),fetchOriginal=globalThis.fetch;
 t.after(()=>{for(const k of env)old[k]===undefined?delete process.env[k]:process.env[k]=old[k];globalThis.fetch=fetchOriginal;});
 process.env.STRIPE_SECRET_KEY='rk_live_fake';process.env.STRIPE_PUBLISHABLE_KEY='pk_live_fake';
 process.env.STRIPE_PROSPECTOR_WEBHOOK_SECRET='whsec_fake';
 process.env.STRIPE_PROSPECTOR_PAYMENT_LINKS=JSON.stringify(Object.fromEntries(['dia1','dias3','dias7','dias14','dias30'].map(id=>[id,{id:'plink_'+id,url:'https://buy.stripe.com/example'}])));
 globalThis.fetch=async(_url,options)=>{
  const params=new URLSearchParams(options.body);
  assert.equal(params.get('ui_mode'),'embedded_page');
  assert.equal(params.get('client_reference_id'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(params.get('metadata[purchase_kind]'),'signup');
  assert.equal(params.get('metadata[package_id]'),'dia1');
  assert.equal(params.get('allowed_payment_method_types[0]'),'card');
  assert.equal(params.get('allowed_payment_method_types[1]'),'pix');
  assert.ok(params.get('return_url').includes('/cadastro?pagamento=adesao'));
  return {ok:true,json:async()=>({id:'cs_live_test_signup',client_secret:'cs_live_test_signup_secret'})};
 };
 const result=await embeddedCheckoutForSignup({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',package_id:'dia1',price_cents:990});
 assert.equal(result.sessionId,'cs_live_test_signup');
});
