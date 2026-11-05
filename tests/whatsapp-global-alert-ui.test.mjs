import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../dashboard/public/simple-app.js',import.meta.url),'utf8');
const withoutStartup=src.slice(0,src.lastIndexOf('\nawait reload();'));
assert.notEqual(withoutStartup,src,'Expected startup block in UI');
const app={innerHTML:''},doc={querySelector:()=>app,addEventListener:()=>{},hidden:false};
const location={hash:'',pathname:'/'};
const ctx=vm.createContext({document:doc,location,window:{addEventListener:()=>{}},sessionStorage:{getItem:()=>null,setItem:()=>{}},
 crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},setInterval:()=>1,fetch:async()=>({ok:true,json:async()=>({})}),URL,URLSearchParams,
 console,confirm:()=>false});
vm.runInContext(withoutStartup,ctx,{timeout:3000});
test('disconnected WhatsApp has small header connect action without full-width QR banner',()=>{
 for(const page of ['overview','conversations','prospects','connections','settings']){
  vm.runInContext('view='+JSON.stringify(page)+';wa={ok:true,connected:false,status:"DISCONNECTED"};shell();',ctx);
  assert.match(app.innerHTML,/wa-inline-connect/,page);
  assert.match(app.innerHTML,/data-action="reconnect-qr"/,page);
  assert.doesNotMatch(app.innerHTML,/class="wa-global-alert"/,page);
 }
});
test('connected status does not show connect action',()=>{
 vm.runInContext('wa={ok:true,connected:true,status:"CONNECTED"};shell();',ctx);
 assert.match(app.innerHTML,/WhatsApp online/);
 assert.doesNotMatch(app.innerHTML,/class="wa-inline-connect"/);
});
test('pending QR is managed in connection dialog instead of permanent banner',()=>{
 vm.runInContext('wa={ok:true,connected:false,status:"SCAN_QR"};waModalOpen=true;waAccounts=[{session_id:"pool-test",label:"WhatsApp comercial",connected:false}];connectionSession="pool-test";view="connections";qrResult={qr:"data:image/png;base64,AAAA"};shell();',ctx);
 assert.doesNotMatch(app.innerHTML,/wa-global-alert/);
 assert.match(src,/wa-modal-backdrop/);
 assert.match(src,/waModalCloseTimer=setTimeout/);
});
test('status polling continues on all pages and pairing remains an explicit action',()=>{
 assert.match(src,/await refreshWa\(\);[\s\S]{0,320}if\(busy/);
 assert.match(src,/action==="reconnect-qr"\|\|action==="connect"/);
 assert.match(src,/await post\("\/api\/whatsapp\/connect"/);
 assert.match(src,/out\.verified!==true/);
});
