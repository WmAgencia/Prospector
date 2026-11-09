import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {coldOutreachSwitchEnabled,autonomousOutreachOperationalEnabled,COLD_OUTREACH_DISABLED_REASON} from '../dashboard/cold-outreach-switch.mjs';

test('Railway false, missing or unknown stops Consecom cold outreach',()=>{
 for(const flag of ['false','FALSE','undefined','',null,'0']){
  assert.equal(coldOutreachSwitchEnabled({flag,tenantId:undefined,internal:undefined}),false);
 }
 assert.equal(COLD_OUTREACH_DISABLED_REASON,'COLD_FIRST_APPROACH_DISABLED');
});
test('Railway true enables only master switch, never deletes downstream checks',()=>{
 assert.equal(coldOutreachSwitchEnabled({flag:'true',tenantId:undefined,internal:undefined}),true);
 const src=fs.readFileSync(new URL('../dashboard/prospecting-queue.mjs',import.meta.url),'utf8');
 assert.match(src,/requiresDocumentedOptIn\(\)&&!documentedOptIn/);
 assert.match(src,/suppressions/);
 assert.match(src,/coldOutreachSwitchEnabled\(\)/);
 assert.match(src,/if\(!coldOutreachSwitchEnabled\(\)\)return false/);
});
test('customer tenants remain isolated from Consecom switch',()=>{
 assert.equal(coldOutreachSwitchEnabled({flag:'false',tenantId:'tenant-1',internal:undefined}),true);
 assert.equal(coldOutreachSwitchEnabled({flag:'false',tenantId:'tenant-1',internal:'true'}),false);
});
test('master false stops queued introductions, proposal parts, and exposes health status',()=>{
 const intro=fs.readFileSync(new URL('../dashboard/prospecting-introduction.mjs',import.meta.url),'utf8');
 const proposal=fs.readFileSync(new URL('../dashboard/consecom-proposal-sequence.mjs',import.meta.url),'utf8');
 const health=fs.readFileSync(new URL('../dashboard/queue-health.mjs',import.meta.url),'utf8');
 assert.match(intro,/if\(!coldOutreachSwitchEnabled\(\)\)/);
 assert.match(proposal,/halted=\(\)=>!coldOutreachSwitchEnabled\(\)/);
 assert.match(health,/reason=COLD_OUTREACH_DISABLED_REASON/);
});

test('Railway flag is the only normal master operator toggle, not a consent bypass',()=>{
 const before=process.env.PROSPECTOR_COLD_FIRST_APPROACH;
 const tenant=process.env.PROSPECTOR_TENANT_ID;
 const internal=process.env.PROSPECTOR_TENANT_INTERNAL;
 try {
  delete process.env.PROSPECTOR_TENANT_ID;
  delete process.env.PROSPECTOR_TENANT_INTERNAL;
  process.env.PROSPECTOR_COLD_FIRST_APPROACH='true';
  assert.equal(autonomousOutreachOperationalEnabled(false),true);
  process.env.PROSPECTOR_COLD_FIRST_APPROACH='false';
  assert.equal(autonomousOutreachOperationalEnabled(true),false);
  process.env.PROSPECTOR_TENANT_ID='tenant-1';
  assert.equal(autonomousOutreachOperationalEnabled(false),false);
  assert.equal(autonomousOutreachOperationalEnabled(true),true);
 } finally {
  if(before===undefined)delete process.env.PROSPECTOR_COLD_FIRST_APPROACH;else process.env.PROSPECTOR_COLD_FIRST_APPROACH=before;
  if(tenant===undefined)delete process.env.PROSPECTOR_TENANT_ID;else process.env.PROSPECTOR_TENANT_ID=tenant;
  if(internal===undefined)delete process.env.PROSPECTOR_TENANT_INTERNAL;else process.env.PROSPECTOR_TENANT_INTERNAL=internal;
 }
 const server=fs.readFileSync(new URL('../dashboard/server.mjs',import.meta.url),'utf8');
 assert.match(server,/\['paused','autonomous_outreach_enabled'\]\.includes\(k\)/);
 const queue=fs.readFileSync(new URL('../dashboard/prospecting-queue.mjs',import.meta.url),'utf8');
 assert.match(queue,/requiresDocumentedOptIn\(\)&&!documentedOptIn/);
});
