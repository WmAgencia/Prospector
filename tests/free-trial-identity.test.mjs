import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openPlatformStore} from '../dashboard/platform-store.mjs';
import {validCpf,trialCpfDigest,sealTrialCpf,unsealTrialCpf} from '../dashboard/trial-identity.mjs';

const SECRET='unit-test-secret-key-that-is-intentionally-nonproduction';
process.env.PROSPECTOR_CPF_HMAC_SECRET=SECRET;
const testName='Maria Oliveira';
const base={name:testName,cpf:'529.982.247-25',email:'maria1@example.test',phone:'11999990011',password:'valid-testing-password',privacyAcknowledged:true};
const make=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-free-50-'));return {dir,store:openPlatformStore(dir)}};
const close=({dir,store})=>{store.db.close();fs.rmSync(dir,{recursive:true,force:true})};

test('CPF check digits are not identity verification',()=>{
 assert.equal(validCpf(base.cpf),true);
 assert.equal(validCpf('52998224726'),false);
 assert.equal(validCpf('111.111.111-11'),false);
 assert.notEqual(trialCpfDigest(base.cpf,SECRET),base.cpf.replace(/\D/g,''));
 const ciphertext=sealTrialCpf(base.cpf,SECRET);
 assert.ok(!ciphertext.includes('52998224725'));
 assert.equal(unsealTrialCpf(ciphertext,SECRET),'52998224725');
 assert.throws(()=>unsealTrialCpf(ciphertext,'different-test-secret-with-more-than-24-chars'));
});

test('signup creates zero-charge, zero-credit pending grant and encrypted CPF',()=>{
 const ref=make();try{
  const account=ref.store.signup(base);
  assert.equal(ref.store.balance(account.id),0);
  const pub=ref.store.publicClient(account);
  assert.equal(pub.trial.status,'PENDING');
  assert.equal(pub.trial.credits,50);
  assert.equal(pub.trial.verified,false);
  assert.equal(pub.phone,'5511999990011');
  assert.match(pub.cpfMasked||'',/\*{2,}/);
  const raw=ref.store.db.prepare('SELECT * FROM free_trial_claims WHERE client_id=?').get(account.id);
  assert.equal(raw.status,'PENDING');
  assert.ok(raw.cpf_ciphertext);
  assert.ok(!raw.cpf_ciphertext.includes('52998224725'));
  assert.equal(ref.store.pendingTrialIdentity(account.id).cpf,'52998224725');
  assert.equal(ref.store.pendingTrialIdentity(account.id).name,testName);
 }finally{close(ref)}
});

test('CPF, phone, and email each independently block a second free trial',()=>{
 const ref=make();try{
  ref.store.signup(base);
  const assertDenied=payload=>assert.throws(()=>ref.store.signup({...base,...payload}),/outro teste|já possui cadastro/i);
  assertDenied({email:'unique2@example.test',phone:'11999990022'});
  assertDenied({cpf:'111.444.777-35',email:'unique3@example.test'}); // same phone
  assertDenied({cpf:'111.444.777-35',phone:'11999990033'}); // same email
  assert.equal(ref.store.list().length,1);
  assert.equal(ref.store.db.prepare('SELECT COUNT(*) n FROM free_trial_claims').get().n,1);
  assert.equal(ref.store.balance(ref.store.list()[0].id),0);
 }finally{close(ref)}
});

test('Master must attest trusted name-to-CPF match; exactly 50 credits issued once',()=>{
 const ref=make();try{
  const c=ref.store.signup(base);
  const method='OFFICIAL_REGISTRY_MANUAL',evidenceReference='Protocol-number-not-a-CPF';
  assert.throws(()=>ref.store.reviewFreeTrial(c.id,{approved:true,verificationMethod:method,evidenceReference}),/Confirme a comparação/);
  assert.equal(ref.store.balance(c.id),0);
  const approved=ref.store.reviewFreeTrial(c.id,{approved:true,verifiedNameAndCpf:true,verificationMethod:method,evidenceReference});
  assert.equal(approved.status,'APPROVED');
  assert.equal(ref.store.balance(c.id),50);
  assert.equal(ref.store.reviewFreeTrial(c.id,{approved:true,verifiedNameAndCpf:true,verificationMethod:method,evidenceReference}).alreadyReviewed,true);
  assert.equal(ref.store.balance(c.id),50);
  assert.equal(ref.store.db.prepare('SELECT cpf_ciphertext FROM free_trial_claims WHERE client_id=?').get(c.id).cpf_ciphertext,null);
  assert.throws(()=>ref.store.pendingTrialIdentity(c.id));
  assert.throws(()=>ref.store.signup({...base,email:'second@example.test',phone:'11999990044'}));
  ref.store.adjust(c.id,-1,'Abordagem confirmada','usage-01');
  assert.equal(ref.store.balance(c.id),49);
 }finally{close(ref)}
});

test('reject permanently blocks the claim and does not give credits',()=>{
 const ref=make();try{
  const c=ref.store.signup(base);
  const denial=ref.store.reviewFreeTrial(c.id,{approved:false,verificationMethod:'OFFICIAL_REGISTRY_MANUAL',evidenceReference:'Name does not match registered CPF'});
  assert.equal(denial.status,'REJECTED');
  assert.equal(ref.store.balance(c.id),0);
  assert.throws(()=>ref.store.signup({...base,email:'another@example.test',phone:'11999990055'}));
  assert.equal(ref.store.db.prepare('SELECT cpf_ciphertext FROM free_trial_claims WHERE client_id=?').get(c.id).cpf_ciphertext,null);
 }finally{close(ref)}
});

test.after(()=>{delete process.env.PROSPECTOR_CPF_HMAC_SECRET});
