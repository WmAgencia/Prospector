import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-francisca-actions-'));
process.env.PROSPECTOR_DATA_DIR=temp;
const {interpretFranciscaAction,applyFranciscaAction,processProspectingSchedule,currentProspectingSchedule}=await import('../dashboard/francisca-panel-actions.mjs');
const {getSetting,db}=await import('../dashboard/db.mjs');
const {daySP}=await import('../dashboard/radar.mjs');

test('voice command schedules dentist research in Sorocaba on the next São Paulo day',()=>{
 const action=interpretFranciscaAction('Francisca, ativa prospecção para amanhã começar a prospectar dentistas em Sorocaba.');
 assert.equal(action.kind,'schedule_discovery');
 assert.equal(action.niche,'dentista');
 assert.equal(action.city,'Sorocaba');
 assert.equal(action.mode,'niche-city');
 assert.ok(/^20\d\d-\d\d-\d\d$/.test(action.startDay));
 const result=applyFranciscaAction(action);
 assert.equal(result.ok,true);
 assert.equal(currentProspectingSchedule().status,'SCHEDULED');
 assert.equal(getSetting('discovery_auto_enabled',false),false,'schedule cannot activate research today');
 const processed=processProspectingSchedule(new Date(Date.now()+24*3600_000));
 assert.equal(processed.applied,true);
 assert.equal(getSetting('discovery_auto_enabled',false),true);
 assert.equal(getSetting('prospecting_scope_preference',null).niche,'dentista');
 assert.equal(getSetting('prospecting_scope_preference',null).city,'Sorocaba');
 assert.equal(processProspectingSchedule(new Date(Date.now()+24*3600_000)).applied,false);
});
test('vague or unsupported commands cannot mutate a client workspace',()=>{
 assert.equal(interpretFranciscaAction('Quantos clientes temos?'),null);
 assert.equal(interpretFranciscaAction('Ative prospecção de cirurgiões na Lua amanhã'),null);
 assert.equal(interpretFranciscaAction('Envie WhatsApps para todos os dentistas de Sorocaba amanhã'),null);
});
test.after(()=>{db.close();fs.rmSync(temp,{recursive:true,force:true});});
