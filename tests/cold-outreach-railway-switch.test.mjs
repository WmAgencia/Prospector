import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {coldOutreachSwitchEnabled,COLD_OUTREACH_DISABLED_REASON} from '../dashboard/cold-outreach-switch.mjs';

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
