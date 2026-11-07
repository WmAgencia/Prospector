import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openPlatformStore} from '../dashboard/platform-store.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'master-recovery-'));
const store=openPlatformStore(dir);
const owner=store.configurePrimary({name:'Owner Example',email:'owner@example.test',phone:'11999990001',password:'original-demo-password'});
const customer=store.create({name:'Other Tenant',email:'customer@example.test'}).client;

test('recovery rejects a different email or weak password, without escalation',()=>{
 assert.throws(()=>store.recoverPrimaryCredentials({email:'other@example.test',password:'new-demo-password-12345'}),/não foi possível verificar/i);
 assert.throws(()=>store.recoverPrimaryCredentials({email:'owner@example.test',password:'short'}),/12 caracteres/);
 assert.equal(store.get(customer.id).is_internal,0);
 assert.equal(store.db.prepare('SELECT COUNT(*) n FROM clients WHERE is_internal=1').get().n,1);
 assert.equal(store.signin({email:'owner@example.test',password:'original-demo-password'}).id,owner.id);
});

test('a validated recovery rotates only the existing owner password and invalidates sessions',()=>{
 const previous=store.get(owner.id).token_hash;
 const result=store.recoverPrimaryCredentials({email:'OWNER@example.test',password:'new-demo-password-12345'});
 assert.equal(result.ok,true);
 assert.equal(store.signin({email:'owner@example.test',password:'original-demo-password'}),null);
 assert.equal(store.signin({email:'owner@example.test',password:'new-demo-password-12345'}).id,owner.id);
 assert.notEqual(store.get(owner.id).token_hash,previous);
 assert.equal(store.get(customer.id).is_internal,0);
 assert.equal(store.db.prepare('SELECT COUNT(*) n FROM clients WHERE is_internal=1').get().n,1);
});

test('owner login opens Master and only legacy admin can recover password',()=>{
 const platform=fs.readFileSync(new URL('../dashboard/platform.mjs',import.meta.url),'utf8');
 const app=fs.readFileSync(new URL('../dashboard/public/simple-app.js',import.meta.url),'utf8');
 assert.match(platform,/primaryModeCookie\(c,'master'\)/);
 assert.match(platform,/c\.is_internal===1\?'\/#\/dashboard':'\/#\/overview'/);
 assert.match(platform,/if\(p==='\/api\/platform\/master-recovery'/);
 assert.match(platform,/if\(!authorized\(req\)\).*403/);
 assert.match(app,/id="master-recovery"/);
 assert.match(app,/post\('\/api\/platform\/master-recovery'/);
 assert.doesNotMatch(platform,/PROSPECTOR_MASTER_DIAGNOSTIC_EMAIL_HASH/);
});

test.after(()=>{store.db.close();fs.rmSync(dir,{recursive:true,force:true});});
