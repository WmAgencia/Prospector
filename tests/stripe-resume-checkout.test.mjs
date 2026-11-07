import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {CREDIT_PACKAGES} from '../dashboard/credit-packages.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-stripe-resume-'));
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.ADMIN_SESSION_SECRET='isolated-resume-checkout-test-secret-long-enough';
process.env.STRIPE_PROSPECTOR_WEBHOOK_SECRET='whsec_'+crypto.randomBytes(22).toString('hex');
process.env.STRIPE_PROSPECTOR_PAYMENT_LINKS=JSON.stringify(Object.fromEntries(CREDIT_PACKAGES.map((p,i)=>[p.id,{id:'plink_TestResume'+i,url:'https://buy.stripe.com/fake-resume-'+i}])));
const {openPlatformStore}=await import('../dashboard/platform-store.mjs');
const {handlePlatform,clientCookie}=await import('../dashboard/platform.mjs');
const store=openPlatformStore(path.join(dir,'platform'));
const owner=store.create({name:'Client A',email:'a@example.test'}).client;
const other=store.create({name:'Client B',email:'b@example.test'}).client;
const requestKey=crypto.randomUUID(),order=store.requestCredits(owner.id,'dias3',requestKey);
const cookie=c=>clientCookie(store.get(c.id));

async function api(route,client,method='POST',input={}){
 let status,body;
 const req={method,headers:{cookie:client?cookie(client):''}};
 const res={setHeader(){},writeHead(){},end(){}};
 const handled=await handlePlatform(req,res,new URL('https://example.test'+route),{
  authorized:()=>false,json:async()=>input,respond:(_res,s,b)=>{status=s;body=b;}
 });
 assert.equal(handled,true);
 return {status,body};
}

test('pending checkout resumes with its ORIGINAL request ID, without creating another order',async()=>{
 const url='/api/platform/credit-requests/'+order.id+'/checkout';
 const a=await api(url,owner);
 assert.equal(a.status,200);
 assert.equal(a.body.request.id,order.id);
 assert.equal(new URL(a.body.checkoutUrl).searchParams.get('client_reference_id'),order.id);
 const second=await api(url,owner);
 assert.equal(second.body.checkoutUrl,a.body.checkoutUrl);
 assert.equal(store.listCreditRequests(owner.id).length,1);
 assert.equal(store.balance(owner.id),0);
});
test('other clients, anonymous requests and demo accounts cannot resume a paid order',async()=>{
 const url='/api/platform/credit-requests/'+order.id+'/checkout';
 assert.equal((await api(url,other)).status,404);
 assert.equal((await api(url,null)).status,403);
 const demo=store.ensureDemoClient();
 assert.equal((await api(url,demo)).status,403);
});
test('approved or declined requests cannot be reopened with a payment link',async()=>{
 const url='/api/platform/credit-requests/'+order.id+'/checkout';
 store.settleCreditRequest(order.id,{approved:false});
 assert.equal((await api(url,owner)).status,409);
 assert.equal(store.balance(owner.id),0);
});
test('missing Stripe configuration does not create phantom pending orders',async()=>{
 const prev=process.env.STRIPE_PROSPECTOR_PAYMENT_LINKS;
 process.env.STRIPE_PROSPECTOR_PAYMENT_LINKS='{}';
 try{
  const before=store.listCreditRequests(owner.id).length;
  const result=await api('/api/platform/credit-requests',owner,'POST',{packageId:'dia1',requestKey:crypto.randomUUID()});
  assert.equal(result.status,503);
  assert.equal(store.listCreditRequests(owner.id).length,before);
 }finally{process.env.STRIPE_PROSPECTOR_PAYMENT_LINKS=prev;}
});
test('customer UI has an authenticated resume button on pending orders',()=>{
 const source=fs.readFileSync(new URL('../dashboard/public/simple-app.js',import.meta.url),'utf8');
 assert.match(source,/data-action="request-credit-resume"/);
 assert.match(source,/sessionStorage\.setItem\('prospector-last-checkout-request',id\)/);
});
test.after(()=>{store.db.close();fs.rmSync(dir,{recursive:true,force:true});});
