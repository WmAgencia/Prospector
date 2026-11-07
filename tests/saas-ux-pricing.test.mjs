import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const read=p=>fs.readFileSync(fileURLToPath(new URL('../'+p,import.meta.url)),'utf8');
const landing=read('dashboard/public/landing.html');
const landingJs=read('dashboard/public/landing.js');
const app=read('dashboard/public/simple-app.js');
const css=read('dashboard/public/product-theme.css');
test('landing shows all credit packages and explicitly says no automatic charge',()=>{
 for(const name of ['dia1','dias3','dias7','dias14','dias30']){
  assert.ok(landing.includes('data-package="'+name+'"'));
  assert.ok(landingJs.includes(name+':'));
 }
 for(const p of ['9,90','25,90','59,90','109,90','219,90'])assert.ok(landing.includes(p));
 assert.match(landing,/não realiza cobrança automática/);
});
test('workspace exposes billing, logout, consent and Master UX elements',()=>{
 for(const t of ['data-action="logout-client"','function masterCreditRequests','credit-request-approve','master-directory-toolbar','client-status-filter','training-all-confirm','setup-progress','request-credit-package'])assert.ok(app.includes(t),t);
 assert.match(css,/prospector-dialog::backdrop/);
 assert.match(css,/credit-packages-grid/);
});
