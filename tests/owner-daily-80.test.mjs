import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-daily-80-'));
delete process.env.PROSPECTOR_TENANT_ID;

const db=await import('../dashboard/db.mjs');
const {apply80DailyLimit,OWNER_DAILY_LIMIT}=await import('../dashboard/approval-ready-activation.mjs');
const {dailyApproachBudget,DAILY_APPROACH_LIMIT}=await import('../dashboard/daily-approach-limit.mjs');
const {MAX_APPROACHES,budgetConfig}=await import('../dashboard/radar.mjs');

test('owner cap is 80 across all WhatsApp numbers and preserves pause',()=>{
 db.setSetting('daily_limit',250);
 db.setSetting('paused',true);
 db.setSetting('autonomous_outreach_enabled',false);
 const status=apply80DailyLimit();
 assert.equal(status.status,'UPDATED');
 assert.equal(status.dailyLimit,80);
 assert.equal(db.getSetting('daily_limit'),80);
 assert.equal(OWNER_DAILY_LIMIT,80);
 assert.equal(DAILY_APPROACH_LIMIT,80);
 assert.equal(MAX_APPROACHES,80);
 assert.equal(budgetConfig().limit,80);
 const daily=dailyApproachBudget();
 assert.equal(daily.limit,80);
 assert.equal(daily.scope,'all_connected_numbers');
 assert.equal(db.getSetting('paused'),true);
 assert.equal(db.getSetting('autonomous_outreach_enabled'),false);
});
test('after one-time owner cap, lower manual setting persists on restart',()=>{
 db.setSetting('daily_limit',40);
 const status=apply80DailyLimit();
 assert.equal(status.status,'ALREADY_APPLIED');
 assert.equal(db.getSetting('daily_limit'),40);
 assert.equal(budgetConfig().limit,40);
 assert.equal(dailyApproachBudget().limit,80); // hard safety ceiling, even if the legacy budget is lower
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
