import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const frontend=fs.readFileSync(new URL('../dashboard/public/simple-app.js',import.meta.url),'utf8');
const platform=fs.readFileSync(new URL('../dashboard/platform.mjs',import.meta.url),'utf8');
const begin=frontend.indexOf('function checkoutReturnBanner(){');
const end=frontend.indexOf('let preferredPackage=',begin);
assert.ok(begin>=0&&end>begin,'Billing return function should be present');
const code=frontend.slice(begin,end);
const run=({status,requestId='b4addaff-1c41-445c-aecd-59ecfaf2a09c',elapsed=9000}={})=>{
 const deleted=[];
 const sessionStorage={removeItem:key=>deleted.push(key)};
 const f=vm.runInNewContext(code+'checkoutReturnBanner',{
  billingCheckoutReturn:{requestId,startedAt:Date.now()-elapsed},
  creditState:{requests:status?[{id:requestId,status}]:[]},
  platformContext:{role:'client',demo:false},
  sessionStorage,Date,
 });
 return {html:f(),deleted};
};

test('a return from checkout never grants success merely because redirect URL was reached',()=>{
 const unknown=run();
 assert.match(unknown.html,/Conferindo seu pagamento/);
 assert.match(unknown.html,/Aguardando confirmação/);
 assert.doesNotMatch(unknown.html,/Pagamento confirmado — créditos liberados/);
 assert.equal(unknown.deleted.length,0);
});
test('a pending Stripe order displays neutral status, not claimed success',()=>{
 const pending=run({status:'PENDING'});
 assert.match(pending.html,/Conferindo seu pagamento/);
 assert.match(pending.html,/O retorno do checkout não confirma o pagamento/);
 assert.equal(pending.deleted.length,0);
});
test('only the server-approved matching order displays credit confirmation',()=>{
 const approved=run({status:'APPROVED'});
 assert.match(approved.html,/Pagamento confirmado — créditos liberados/);
 assert.match(approved.html,/Seu saldo foi atualizado/);
 assert.deepEqual(approved.deleted,['prospector-last-checkout-request']);
});
test('declined orders explicitly show nonpayment',()=>{
 const declined=run({status:'DECLINED'});
 assert.match(declined.html,/Pedido não aprovado/);
 assert.match(declined.html,/Nenhum crédito foi liberado/);
});
test('async payments keep waiting status and expose refresh action',()=>{
 const delayed=run({status:'PENDING',elapsed:240000});
 assert.match(delayed.html,/Pix ou outro método assíncrono/);
 assert.match(delayed.html,/data-action="refresh-credits"/);
});
test('billing endpoint never creates a credit order if checkout keys are not ready',()=>{
 assert.match(platform,/if\(!billingReady\(\)\)\{respond\(res,503,\{error:'Checkout temporariamente indisponível/);
 assert.match(frontend,/sessionStorage\.setItem\('prospector-last-checkout-request',order\.request\.id\)/);
 assert.match(frontend,/Date\.now\(\)-billingLastChecked>\(billingCheckoutReturn\?6000:30000\)/);
});
