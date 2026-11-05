import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-master-next-'));
process.env.ADMIN_SESSION_SECRET='master-next-isolated-test-key-for-cpf-hashing';
const {openPlatformStore}=await import('../dashboard/platform-store.mjs');
const {masterAnalytics}=await import('../dashboard/platform-analytics.mjs');
const {verifyStripeSignature,checkoutForRequest,handleStripeWebhook}=await import('../dashboard/stripe-billing.mjs');
const store=openPlatformStore(dir);
const identity={name:'Agência Teste',email:'agencia.teste@example.test',phone:'15999999999',cpf:'529.982.247-25'};

test('Master provisions unlimited and prepaid plans without administrator escalation',()=>{
 const unlimited=store.create({...identity,planId:'unlimited'}).client;
 assert.equal(unlimited.unlimited,true);
 assert.equal(unlimited.internal,false);
 assert.equal(unlimited.available,null);
 assert.equal(unlimited.cpfMasked,'***.***.*47-25');
 assert.equal(store.get(unlimited.id).cpf_digest.length,64);
 assert.ok(!JSON.stringify(store.get(unlimited.id)).includes('52998224725'));
 assert.equal(store.reserve(unlimited.id,crypto.randomUUID()),true);
 assert.equal(store.balance(unlimited.id),0);
 assert.throws(()=>store.adjust(unlimited.id,250,'Créditos indevidos'),/ilimitado/);
 assert.throws(()=>store.create({...identity,email:'repetido@example.test',cpf:'000.000.000-00'}),/CPF inválido/);
});

test('Custom plan stores exact price and credits, without giving them until payment',()=>{
 const custom=store.create({name:'Custom Teste',email:'custom@example.test',planId:'custom',customCredits:800,customPriceCents:3190}).client;
 assert.equal(custom.planId,'custom');assert.equal(custom.customCredits,800);
 assert.equal(custom.customPriceCents,3190);
 assert.equal(custom.balance,0);
});
test('New client invite creates an individual login and invalidates the initial token',()=>{
 const result=store.create({name:'Convite',email:'invite@example.test',phone:'15988887777'});
 assert.equal(store.hasPassword(result.client.id),false);
 const activated=store.setupPassword(result.client.id,'novaSenha123456');
 assert.equal(store.hasPassword(result.client.id),true);
 assert.equal(store.authenticate(result.token),undefined);
 assert.equal(store.signin({email:'invite@example.test',password:'novaSenha123456'}).id,activated.id);
 assert.throws(()=>store.setupPassword(result.client.id,'novaSenha123456'),/convite/);
});
test('Only matching amount and unique verified Stripe session credits an account',()=>{
 const c=store.create({name:'Recebedor',email:'paid@example.test'}).client;
 const r=store.requestCredits(c.id,'padrao',crypto.randomUUID());
 const dateBefore=masterAnalytics(store);
 assert.equal(dateBefore.revenue.todayCents,0,'unpaid request cannot be revenue');
 assert.throws(()=>store.confirmVerifiedPayment({requestId:r.id,packageId:'padrao',amountCents:1990,sessionId:'cs_live_fake1',eventId:'evt_fake1'}),/não confere/);
 assert.equal(store.balance(c.id),0);
 const ok=store.confirmVerifiedPayment({requestId:r.id,packageId:'padrao',amountCents:990,sessionId:'cs_live_fake1',eventId:'evt_fake1'});
 assert.equal(ok.duplicate,false);
 assert.equal(store.balance(c.id),250);
 assert.equal(store.confirmVerifiedPayment({requestId:r.id,packageId:'padrao',amountCents:990,sessionId:'cs_live_fake1',eventId:'evt_fake1'}).duplicate,true);
 assert.equal(store.balance(c.id),250);
 const metrics=masterAnalytics(store);
 assert.equal(metrics.revenue.todayCents,990);
 assert.equal(metrics.revenue.monthCents,990);
 assert.equal(metrics.credits.pendingRequests,0);
});
test('A signed Stripe webhook automatically reconciles a real-reference checkout once',async()=>{
 const c=store.create({name:'Webhook Teste',email:'webhook@example.test'}).client;
 const order=store.requestCredits(c.id,'essencial',crypto.randomUUID());
 process.env.STRIPE_PROSPECTOR_WEBHOOK_SECRET='whsec_test_secret_for_master_next';
 process.env.STRIPE_PROSPECTOR_PAYMENT_LINKS=JSON.stringify(Object.fromEntries([
  ['essencial','plink_essencialtest'],['padrao','plink_padraotest'],['pro','plink_protest'],['agencia','plink_agenciatest']
 ].map(([id,p])=>[id,{id:p,url:'https://buy.stripe.com/test_fake_'+id}])));
 const checkout=checkoutForRequest(order);
 assert.ok(checkout.includes('client_reference_id='+order.id));
 const event={id:'evt_prospectorpaid2',type:'checkout.session.completed',data:{object:{
  object:'checkout.session',id:'cs_live_prospectorpaid2',payment_status:'paid',
  livemode:true,client_reference_id:order.id,payment_link:'plink_essencialtest',currency:'brl',amount_total:490
 }}};
 const raw=Buffer.from(JSON.stringify(event)),timestamp=Math.floor(Date.now()/1000);
 const sig=crypto.createHmac('sha256',process.env.STRIPE_PROSPECTOR_WEBHOOK_SECRET).update(timestamp+'.').update(raw).digest('hex');
 const signature='t='+timestamp+',v1='+sig;
 assert.equal(verifyStripeSignature(raw,signature,process.env.STRIPE_PROSPECTOR_WEBHOOK_SECRET),true);
 assert.equal(verifyStripeSignature(raw,'t='+timestamp+',v1='+'a'.repeat(64),process.env.STRIPE_PROSPECTOR_WEBHOOK_SECRET),false);
 let reply;
 const req={method:'POST',headers:{'stripe-signature':signature},async *[Symbol.asyncIterator](){yield raw;}};
 await handleStripeWebhook(req,{}, {ledger:store,respond:(_,status,obj)=>{reply={status,...obj};}});
 assert.equal(reply.status,200);assert.equal(reply.confirmed,true);
 assert.equal(store.balance(c.id),50);
 await handleStripeWebhook(req,{}, {ledger:store,respond:(_,status,obj)=>{reply={status,...obj};}});
 assert.equal(reply.duplicate,true);assert.equal(store.balance(c.id),50);
});
test.after(()=>{store.db.close();fs.rmSync(dir,{recursive:true,force:true});});
