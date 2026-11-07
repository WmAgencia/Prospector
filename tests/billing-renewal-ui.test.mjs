import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../dashboard/public/simple-app.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../dashboard/public/dashboard-purple.css',import.meta.url),'utf8');
const start=src.indexOf('function billingNeedsRenewal(){'),end=src.indexOf('function shell(){',start);
assert.ok(start>0&&end>start);
const snippet=src.slice(start,end);
const packages=[{id:'dia1',name:'1 dia de capacidade',credits:250,priceCents:990},{id:'dias7',name:'7 dias de capacidade',credits:1750,priceCents:5990}];
const render=(data={})=>{
 const context={platformContext:{role:'client',demo:false,available:0,unlimited:false,id:'cust-test',...data.context},
 creditState:{available:0,trial:{status:'APPROVED'},automaticBilling:true,packages,...data.credits},
 billingReminderOpen:data.open??true,billingReminderDismissed:false,billingDemoExhausted:!!data.demoDone,billingDemoStep:data.step||0,billingDemoPackage:data.package||'dia1',
 esc:x=>String(x),moneyFromCents:x=>'R$ '+(x/100).toFixed(2).replace('.',','),sessionStorage:{getItem:()=>null},render:()=>{}};
 return vm.runInNewContext(snippet+'billingOfferDialog()',context);
};
test('actual client sees renewal popup after all 100 trial approaches are used',()=>{
 const html=render();
 assert.match(html,/Suas abordagens chegaram ao fim/);
 assert.match(html,/dia1/);
 assert.match(html,/data-action="request-credit-package"/);
 assert.match(html,/Sem renovação automática/);
 assert.match(css,/\.billing-renew-backdrop/);
});
test('active trial, unverified trial, or Master never receives forced checkout',()=>{
 assert.equal(render({credits:{available:1}}),'');
 assert.equal(render({credits:{trial:{status:'PENDING'}}}),'');
 assert.equal(render({context:{role:'master'}}),'');
});
test('isolated demo shows a realistic Stripe preview but cannot create checkout requests',()=>{
 const base={context:{demo:true,available:100},credits:{available:100},demoDone:true};
 const options=render(base);
 assert.match(options,/DEMONSTRAÇÃO/);
 assert.match(options,/data-action="billing-demo-select"/);
 assert.doesNotMatch(options,/data-action="request-credit-package"/);
 const form=render({...base,step:1});
 assert.match(form,/Prévia do checkout/);
 assert.match(form,/Cartão de crédito/);
 assert.match(form,/Pix, se habilitado/);
 assert.match(form,/Nenhum pagamento foi criado/);
 assert.doesNotMatch(form,/data-action="request-credit-package"/);
 assert.match(src,/data-action="billing-demo-toggle"/);
});
