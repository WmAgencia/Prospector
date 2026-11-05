import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/session-budget-');
const d=await import('../dashboard/db.mjs');
const budget=await import('../dashboard/session-outreach-budget.mjs');
test('20 unique confirmations impose exactly 900 seconds per session and survive restart',()=>{
 const at=Date.parse('2026-11-05T13:00:00Z');
 for(let i=1;i<=19;i++){assert.equal(budget.recordApproachConfirmation('chip-a','a-'+i,at),true);assert.equal(budget.sessionCanApproach('chip-a',at),true);}
 assert.equal(budget.recordApproachConfirmation('chip-a','a-19',at),false);
 assert.equal(budget.sessionOutreachBudget('chip-a',at).approachesInCycle,19);
 budget.recordApproachConfirmation('chip-a','a-20',at);
 assert.equal(budget.sessionCanApproach('chip-a',at+899999),false);
 assert.equal(budget.sessionCanApproach('chip-a',at+900000),true);
 assert.equal(budget.sessionCanApproach('chip-b',at),true);
 const source=new URL('../dashboard/session-outreach-budget.mjs',import.meta.url).href;
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {sessionOutreachBudget} from '${source}';console.log(JSON.stringify(sessionOutreachBudget('chip-a',${at+1000})));`],{env:process.env,encoding:'utf8',timeout:20000});
 assert.equal(child.status,0,child.stderr);
 assert.equal(JSON.parse(child.stdout).cooling,true);
 assert.equal(JSON.parse(child.stdout).cooldownUntil,new Date(at+900000).toISOString());
 budget.recordApproachConfirmation('chip-a','a-21',at+900000);
 assert.equal(budget.sessionOutreachBudget('chip-a',at+900000).approachesInCycle,1);
});
test.after(()=>{d.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
