import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {embeddedReady,embeddedCheckoutForRequest,verifyStripeSignature,handleStripeWebhook} from '../dashboard/stripe-billing.mjs';
import {CREDIT_PACKAGES} from '../dashboard/credit-packages.mjs';

const keys=['STRIPE_PROSPECTOR_PAYMENT_LINKS','STRIPE_PROSPECTOR_WEBHOOK_SECRET','STRIPE_SECRET_KEY','STRIPE_PUBLISHABLE_KEY','STRIPE_PROSPECTOR_RETURN_URL'];
const original=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
const realFetch=globalThis.fetch;
const restore=()=>{for(const k of keys){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];}globalThis.fetch=realFetch;};
const configure=()=>{process.env.STRIPE_PROSPECTOR_WEBHOOK_SECRET='whsec_unit_test';
 process.env.STRIPE_PROSPECTOR_PAYMENT_LINKS=JSON.stringify(Object.fromEntries(CREDIT_PACKAGES.map(p=>[p.id,{id:'plink_test_'+p.id,url:'https://buy.stripe.com/test/'+p.id}])));
 process.env.STRIPE_PUBLISHABLE_KEY='pk_live_unit_test';
 process.env.STRIPE_PROSPECTOR_RETURN_URL='https://prospector.consecom.com.br';
};
const request={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',package_id:'dias7'};
test('embedded checkout is disabled without a server secret, keeping hosted payment links',t=>{
 t.after(restore);configure();delete process.env.STRIPE_SECRET_KEY;
 assert.equal(embeddedReady(),false);
 assert.equal(embeddedCheckoutForRequest(request) instanceof Promise,true);
});
test('checkout session uses current Stripe embedded API and card + Pix',async t=>{
 t.after(restore);configure();process.env.STRIPE_SECRET_KEY='rk_live_unit_test';
 let called=0;
 globalThis.fetch=async (url,init)=>{called++;assert.equal(url,'https://api.stripe.com/v1/checkout/sessions');
 const body=new URLSearchParams(init.body);
 assert.equal(body.get('ui_mode'),'embedded_page');
 assert.equal(body.get('mode'),'payment');
 assert.deepEqual(body.getAll('allowed_payment_method_types[0]'),['card']);
 assert.deepEqual(body.getAll('allowed_payment_method_types[1]'),['pix']);
 assert.equal(body.has('payment_method_types[0]'),false);
 assert.equal(body.get('locale'),'pt-BR');
 assert.equal(body.get('client_reference_id'),request.id);
 assert.equal(body.get('metadata[package_id]'),'dias7');
 assert.equal(body.get('return_url').startsWith('https://prospector.consecom.com.br/'),true);
 assert.equal(init.headers['Idempotency-Key'],'prospector-embedded-'+request.id);
 return {ok:true,json:async()=>({id:'cs_live_unit',client_secret:'cs_live_unit_secret_test'})};
 };
 assert.equal(embeddedReady(),true);
 const result=await embeddedCheckoutForRequest(request);
 assert.equal(result.clientSecret,'cs_live_unit_secret_test');
 assert.equal(result.publishableKey,'pk_live_unit_test');
 assert.equal(called,1);
});
test('signed webhook confirms paid embedded session at most once and ignores unpaid',async t=>{
 t.after(restore);configure();delete process.env.STRIPE_SECRET_KEY;
 const key=process.env.STRIPE_PROSPECTOR_WEBHOOK_SECRET;
 let credits=0,paid=0;
 const ledger={confirmVerifiedPayment:input=>{credits++;assert.equal(input.requestId,request.id);assert.equal(input.packageId,'dias7');assert.equal(input.amountCents,5990);return {ok:true,duplicate:false};}};
 const sign=raw=>{const at=Math.floor(Date.now()/1000);return 't='+at+',v1='+crypto.createHmac('sha256',key).update(at+'.').update(raw).digest('hex');};
 const send=async status=>{
  const event={id:'evt_unit_'+status,type:'checkout.session.completed',data:{object:{object:'checkout.session',id:'cs_live_unit_'+status,livemode:true,payment_status:status,payment_link:null,client_reference_id:request.id,metadata:{app:'prospector',request_id:request.id,package_id:'dias7'},currency:'brl',amount_total:5990}}};
  const raw=Buffer.from(JSON.stringify(event));const req={method:'POST',headers:{'stripe-signature':sign(raw)},async *[Symbol.asyncIterator](){yield raw;}};
  let returned;await handleStripeWebhook(req,{}, {respond:(_res,code,data)=>returned={code,data},ledger});return returned;
 };
 const unpaid=await send('unpaid');assert.equal(unpaid.code,200);assert.equal(credits,0);
 const accepted=await send('paid');assert.equal(accepted.code,200);assert.equal(accepted.data.confirmed,true);assert.equal(credits,1);
 assert.equal(paid,0);
});
