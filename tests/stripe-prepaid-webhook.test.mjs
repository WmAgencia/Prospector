import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {CREDIT_PACKAGES} from '../dashboard/credit-packages.mjs';
import {openPlatformStore} from '../dashboard/platform-store.mjs';
import {billingReady,checkoutForRequest,verifyStripeSignature,handleStripeWebhook} from '../dashboard/stripe-billing.mjs';
const envBefore={secret:process.env.STRIPE_PROSPECTOR_WEBHOOK_SECRET,links:process.env.STRIPE_PROSPECTOR_PAYMENT_LINKS};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-stripe-check-'));
const ledger=openPlatformStore(dir);
const client=ledger.create({name:'Stripe QA fictícia',email:'stripe-qa@example.test'}).client.id;
const secret='whsec_'+crypto.randomBytes(28).toString('hex');
const links=Object.fromEntries(CREDIT_PACKAGES.map((p,i)=>[p.id,{id:'plink_TestPackage'+i,url:'https://buy.stripe.com/testPackage'+i}]));
process.env.STRIPE_PROSPECTOR_WEBHOOK_SECRET=secret;
process.env.STRIPE_PROSPECTOR_PAYMENT_LINKS=JSON.stringify(links);
const paymentEvent=(request,eventId='evt_TestStripeEvent001',amount=request.price_cents,type='checkout.session.completed')=>({
 id:eventId,type,data:{object:{object:'checkout.session',livemode:true,payment_status:'paid',
 id:'cs_live_TestStripeSession001',client_reference_id:request.id,
 payment_link:links[request.package_id].id,amount_total:amount,currency:'brl'}}
});
const send=async(event,signatureOverride)=>{
 const raw=Buffer.from(JSON.stringify(event)),timestamp=Math.floor(Date.now()/1000);
 const header=signatureOverride??'t='+timestamp+',v1='+crypto.createHmac('sha256',secret).update(timestamp+'.').update(raw).digest('hex');
 const req=Object.assign(Readable.from([raw]),{method:'POST',headers:{'stripe-signature':header}});
 let status,body;
 await handleStripeWebhook(req,null,{ledger,respond:(_res,code,obj)=>{status=code;body=obj;}});
 return {status,body};
};
test('checkout URLs use opaque credit request references, not CPF or email',()=>{
 assert.equal(billingReady(),true);
 const request=ledger.requestCredits(client,'dia1',crypto.randomUUID());
 const checkout=checkoutForRequest(request);
 assert.ok(checkout.startsWith('https://buy.stripe.com/'));
 assert.equal(new URL(checkout).searchParams.get('client_reference_id'),request.id);
 assert.ok(!checkout.includes('stripe-qa@example.test'));
});
test('unauthenticated or mismatched events do NOT release credits',async()=>{
 const request=ledger.listCreditRequests(client)[0];
 const event=paymentEvent(request);
 assert.equal((await send(event,'t=1,v1='+'0'.repeat(64))).status,400);
 assert.equal(ledger.balance(client),0);
 const wrong=await send(paymentEvent(request,'evt_DifferentAmount123',request.price_cents+100));
 assert.equal(wrong.status,503);
 assert.equal(ledger.balance(client),0);
 const unpaid=paymentEvent(request,'evt_UnpaidEvent123');unpaid.data.object.payment_status='unpaid';
 assert.equal((await send(unpaid)).body.ignored,true);
 assert.equal(ledger.balance(client),0);
});
test('only signed paid Stripe event adds credits exactly once, even on retry',async()=>{
 const request=ledger.listCreditRequests(client)[0],event=paymentEvent(request);
 const processed=await send(event);
 assert.equal(processed.status,200);assert.equal(processed.body.confirmed,true);
 assert.equal(ledger.balance(client),250);
 assert.equal(ledger.listCreditRequests(client)[0].status,'APPROVED');
 const retry=await send(event);
 assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);
 assert.equal(ledger.balance(client),250);
});
test('signature rejects old timestamps',()=>{
 const t=Math.floor(Date.now()/1000)-600,body=Buffer.from('{}');
 const header='t='+t+',v1='+crypto.createHmac('sha256',secret).update(t+'.').update(body).digest('hex');
 assert.equal(verifyStripeSignature(body,header,secret),false);
});
test.after(()=>{
 ledger.db.close();fs.rmSync(dir,{recursive:true,force:true});
 if(envBefore.secret===undefined)delete process.env.STRIPE_PROSPECTOR_WEBHOOK_SECRET;else process.env.STRIPE_PROSPECTOR_WEBHOOK_SECRET=envBefore.secret;
 if(envBefore.links===undefined)delete process.env.STRIPE_PROSPECTOR_PAYMENT_LINKS;else process.env.STRIPE_PROSPECTOR_PAYMENT_LINKS=envBefore.links;
});
