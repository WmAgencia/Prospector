import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-reactivation-'));
process.env.PROSPECTOR_DATA_DIR=dir;
const db=await import('../dashboard/db.mjs');
const {activateRequestedProspecting}=await import('../dashboard/operator-prospecting-recovery.mjs');
const {budgetConfig}=await import('../dashboard/radar.mjs');
test('One-shot activation starts research and 90 second spacing but never picks arbitrary campaign or sends',()=>{
 db.setSetting('paused',true);db.setSetting('automation_enabled',false);
 db.setSetting('discovery_auto_enabled',false);
 db.setSetting('autonomous_campaign_id','');
 const before=db.one("SELECT COUNT(*) AS n FROM initial_contacts").n;
 const result=activateRequestedProspecting();
 assert.equal(result.status,'ACTIVATED_RESEARCH');
 assert.equal(result.outbound,'WAITING_OPERATOR_SELECTION');
 assert.equal(result.discoveryEnabled,true);
 assert.equal(db.getSetting('paused'),true);
 assert.equal(db.getSetting('auto_initial'),false);
 assert.equal(db.getSetting('automation_enabled'),true);
 assert.equal(db.getSetting('initial_interval_seconds'),90);
 assert.equal(budgetConfig(new Date('2026-11-03T14:00:00Z')).intervalSeconds,90);
 assert.equal(db.one("SELECT COUNT(*) AS n FROM initial_contacts").n,before);
 const count=db.one("SELECT COUNT(*) AS n FROM audit WHERE action='OPERATOR_REQUESTED_PROSPECTING_RECOVERY'").n;
 assert.equal(activateRequestedProspecting().status,'ALREADY_APPLIED');
 assert.equal(db.one("SELECT COUNT(*) AS n FROM audit WHERE action='OPERATOR_REQUESTED_PROSPECTING_RECOVERY'").n,count);
});
test('Only fully valid preselected campaign can be unpaused',()=>{
 db.setSetting('prospector_nov03_operator_activation_v1',false);
 db.setSetting('paused',true);
 const invalid=db.one('SELECT id FROM workflows LIMIT 1').id;
 db.setSetting('autonomous_campaign_id',invalid);
 const invalidResult=activateRequestedProspecting();
 assert.equal(invalidResult.paused,true);
 assert.equal(invalidResult.outbound,'WAITING_VALID_CAMPAIGN');
 // Create valid workflow and real media; proof is based on stored media and file presence.
 db.setSetting('prospector_nov03_operator_activation_v1',false);
 const mediaDir=path.join(dir,'media');fs.mkdirSync(mediaDir,{recursive:true});
 const a=db.id(),v=db.id();
 for(const [id,kind,ext] of [[a,'audio','ogg'],[v,'video','mp4']]){
  fs.writeFileSync(path.join(mediaDir,id+'.'+ext),'file');
  db.run('INSERT INTO media(id,name,kind,mime,filename,bytes,created_at) VALUES(?,?,?,?,?,?,?)',
  id,kind,kind==='audio'?'audio/ogg':'video/mp4',id+'.'+ext,4,db.now());
 }
 const {buildConsecomSteps}=await import('../dashboard/consecom-flow.mjs');
 const flow=db.id();db.run('INSERT INTO workflows(id,name,is_default,version,steps,created_at,updated_at,segments_json,enabled) VALUES(?,?,?,?,?,?,?,?,?)',
 flow,'Campanha revisada',0,1,JSON.stringify(buildConsecomSteps({audioId:a,videoId:v})),db.now(),db.now(),'[]',1);
 db.setSetting('autonomous_campaign_id',flow);
 const good=activateRequestedProspecting();
 assert.equal(good.outbound,'SELECTED_CAMPAIGN_VALID');
 assert.equal(good.paused,false);
 assert.equal(db.getSetting('initial_interval_seconds'),90);
});
test.after(()=>{db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
