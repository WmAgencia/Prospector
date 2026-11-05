import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openPlatformStore} from '../dashboard/platform-store.mjs';

test('changing email/password requires current password and revokes other login sessions',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-credentials-')),store=openPlatformStore(dir);
 try{
  const existing=store.signup({name:'Agência Amostra',email:'original@example.test',phone:'5515999991111',password:'senhaOriginal123',privacyAcknowledged:true});
  const oldToken=store.get(existing.id).token_hash;
  assert.throws(()=>store.changeCredentials(existing.id,{currentPassword:'errada',newEmail:'nova@example.test'}),/Senha atual incorreta/);
  assert.equal(store.get(existing.id).token_hash,oldToken);
  assert.throws(()=>store.changeCredentials(existing.id,{currentPassword:'senhaOriginal123',newPassword:'curta'}),/10 a 128/);
  const changed=store.changeCredentials(existing.id,{currentPassword:'senhaOriginal123',newEmail:'nova@example.test',newPassword:'senhaNova123'});
  assert.equal(changed.email,'nova@example.test');
  assert.notEqual(changed.token_hash,oldToken);
  assert.equal(store.signin({email:'original@example.test',password:'senhaOriginal123'}),null);
  assert.equal(store.signin({email:'nova@example.test',password:'senhaOriginal123'}),null);
  assert.equal(store.signin({email:'nova@example.test',password:'senhaNova123'}).id,existing.id);
 }finally{store.db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('email collisions cannot modify another tenant account',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-credentials-isolation-')),store=openPlatformStore(dir);
 try{
  const alpha=store.signup({name:'Agência A',email:'a@example.test',phone:'5515999991112',password:'senha12345678',privacyAcknowledged:true});
  const beta=store.signup({name:'Agência B',email:'b@example.test',phone:'5515999991113',password:'outra12345678',privacyAcknowledged:true});
  assert.throws(()=>store.changeCredentials(alpha.id,{currentPassword:'senha12345678',newEmail:'b@example.test'}),/E-mail já cadastrado/);
  assert.equal(store.get(alpha.id).email,'a@example.test');
  assert.equal(store.get(beta.id).email,'b@example.test');
 }finally{store.db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
