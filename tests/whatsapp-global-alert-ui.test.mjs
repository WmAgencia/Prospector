import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../dashboard/public/simple-app.js',import.meta.url),'utf8');
const withoutStartup=src.slice(0,src.lastIndexOf('\nawait reload();'));
assert.notEqual(withoutStartup,src,'Expected startup block in UI');
const app={innerHTML:''};
const doc={querySelector:()=>app,addEventListener:()=>{},hidden:false};
const location={hash:'',pathname:'/'};
const ctx=vm.createContext({document:doc,location,window:{addEventListener:()=>{}},sessionStorage:{getItem:()=>null,setItem:()=>{}},
 crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},setInterval:()=>1,fetch:async()=>({ok:true,json:async()=>({})}),URL,URLSearchParams,
 console,confirm:()=>false});
vm.runInContext(withoutStartup,ctx,{timeout:3000});
test('offline WhatsApp notice is visible on every one of the five screens',()=>{
 for(const page of ['overview','conversations','prospects','connections','settings']){
  vm.runInContext('view='+JSON.stringify(page)+';wa={ok:true,connected:false,status:"DISCONNECTED"};shell();',ctx);
  assert.match(app.innerHTML,/wa-global-alert/,page);
  assert.match(app.innerHTML,/WhatsApp desconectado/,page);
  assert.match(app.innerHTML,/data-action="reconnect-qr"/,page);
 }
});
test('connecting uses a QR-specific notice and connected state hides the warning',()=>{
 vm.runInContext('wa={ok:true,connected:false,status:"SCAN_QR"};shell();',ctx);
 assert.match(app.innerHTML,/aguardando leitura do QR Code/);
 vm.runInContext('wa={ok:true,connected:true,status:"CONNECTED"};shell();',ctx);
 assert.doesNotMatch(app.innerHTML,/wa-global-alert/);
});
test('gateway uncertainty is not falsely reported as connected',()=>{
 vm.runInContext('wa={ok:false,connected:false,status:"ERROR"};shell();',ctx);
 assert.match(app.innerHTML,/Não foi possível verificar o WhatsApp/);
});
test('UI polls the gateway on any page and QR button invokes real connect flow',()=>{
 assert.match(src,/await refreshWa\(\);[\s\S]{0,320}if\(busy/);
 assert.match(src,/action==="reconnect-qr"\|\|action==="connect"/);
 assert.match(src,/await post\("\/api\/whatsapp\/connect"/);
 assert.match(src,/out\.verified!==true/);
});
