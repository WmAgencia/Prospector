import test from 'node:test';
import assert from 'node:assert/strict';
import {outreachConsentControl,requestOutreachConsentControl} from '../dashboard/outreach-consent-control.mjs';

test('Meta policy remains enforced and switch is unavailable until an official future release',()=>{
 const state=outreachConsentControl();
 assert.equal(state.enforced,true);
 assert.equal(state.canDisable,false);
 assert.equal(state.policyStatus,'OPT_IN_REQUIRED');
 assert.match(state.policyUrl,/^https:\/\/whatsappbusiness\.com\/policy\//);
 assert.equal(state.policyVersion,'2026-09-23');
});

test('a click cannot disable recipient consent by owner approval alone',()=>{
 for(const input of [{enforced:false},{enforced:false,ownerApproved:true},{enforced:false,policyStatus:'META_APPROVED'},{enforced:false,acceptRisk:true}]){
  const change=requestOutreachConsentControl(input);
  assert.equal(change.status,409);
  assert.equal(change.body.enforced,true);
  assert.equal(change.body.canDisable,false);
  assert.match(change.body.error,/não pode ser desativada/i);
 }
 assert.equal(outreachConsentControl().enforced,true);
});

test('confirmation of enabled safety succeeds; invalid requests fail closed',()=>{
 const on=requestOutreachConsentControl({enforced:true});
 assert.equal(on.status,200);
 assert.equal(on.body.ok,true);
 assert.equal(on.body.enforced,true);
 for(const invalid of [null,{}, {enforced:'false'}, {enforced:0}]){
  const result=requestOutreachConsentControl(invalid);
  assert.equal(result.status,400);
  assert.equal(result.body.enforced,true);
 }
});
