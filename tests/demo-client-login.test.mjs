import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openPlatformStore} from '../dashboard/platform-store.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-demo-login-'));
const store=openPlatformStore(dir);
test('demo account can be provisioned once, receives 100 fictitious approaches, and never shares owner workspace',()=>{
 const a=store.ensureDemoClient();
 const b=store.ensureDemoClient();
 assert.equal(a.id,b.id);
 assert.equal(a.balance,100);
 assert.equal(a.demo,true);
 assert.equal(a.internal,false);
 assert.equal(a.unlimited,false);
 assert.equal(store.list().filter(x=>x.demo).length,1);
});
test('admin rotates demo login; ordinary signin succeeds and invalidates previous password',()=>{
 const first=store.resetDemoPassword();
 assert.ok(first.password.length>=18);
 assert.equal(first.email,'demo.prospector@exemplo.invalid');
 assert.equal(store.signin({identifier:first.email,password:first.password}).id,first.id);
 const second=store.resetDemoPassword();
 assert.equal(store.signin({identifier:first.email,password:first.password}),null);
 assert.equal(store.signin({identifier:second.email,password:second.password}).id,second.id);
 assert.equal(store.publicClient(store.get(second.id)).available,100);
});
test('demo can open payment preview but cannot create live checkout requests or charge money',()=>{
 const demo=store.ensureDemoClient();
 assert.throws(()=>store.requestCredits(demo.id,'dia1','demo-should-not-buy'),/demonstração/i);
 assert.equal(store.listCreditRequests(demo.id).length,0);
});
test('Master demo credentials API is separated from customer endpoints',()=>{
 const source=fs.readFileSync(new URL('../dashboard/platform.mjs',import.meta.url),'utf8');
 const ui=fs.readFileSync(new URL('../dashboard/public/simple-app.js',import.meta.url),'utf8');
 const admin=source.indexOf("if(p.startsWith('/api/platform/'))");
 const guarded=source.indexOf("if((client&&!ownerMaster)||(!ownerMaster&&!authorized(req)))",admin);
 const demo=source.indexOf("if(p==='/api/platform/demo-login'",admin);
 assert.ok(admin>=0&&guarded>admin&&demo>guarded);
 assert.match(ui,/data-action="client-demo-login"/);
 assert.match(ui,/data-action="copy-demo-login"/);
 assert.match(ui,/data-action="open-demo-login"/);
});
test.after(()=>{store.db.close();fs.rmSync(dir,{recursive:true,force:true});});
