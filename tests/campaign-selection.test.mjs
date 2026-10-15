import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'campaign-switch-test-'));
const {one,run,id,now,getSetting,setSetting}=await import('../dashboard/db.mjs');
const {activateCampaign,selectedCampaign,rejectActiveCampaignEdit,validateCampaignForActivation}=await import('../dashboard/campaign-selection.mjs');
const {buildConsecomSteps}=await import('../dashboard/consecom-flow.mjs');
const folder=path.join(process.env.PROSPECTOR_DATA_DIR,'media');fs.mkdirSync(folder,{recursive:true});
const aud=id(),vid=id();
fs.writeFileSync(path.join(folder,aud+'.ogg'),'test-private-ogg');
fs.writeFileSync(path.join(folder,vid+'.mp4'),'test-private-mp4');
for(const [identifier,kind,mime,ext] of [[aud,'audio','audio/ogg','.ogg'],[vid,'video','video/mp4','.mp4']]){
 run("INSERT INTO media(id,name,kind,mime,filename,bytes,created_at) VALUES(?,?,?,?,?,?,?)",identifier,kind,kind,mime,identifier+ext,16,now());
}
const steps=buildConsecomSteps({audioId:aud,videoId:vid});
function add(name,stepsValue=steps){
 const wf=id();
 run('INSERT INTO workflows(id,name,is_default,version,steps,created_at,updated_at,segments_json,enabled) VALUES(?,?,?,?,?,?,?,?,?)',wf,name,0,1,JSON.stringify(stepsValue),now(),now(),'[]',0);
 return wf;
}
test('operator chooses exactly one campaign, selection survives pause, and leaves others available',()=>{
 setSetting('paused',true);setSetting('auto_initial',false);
 const a=add('Oferta Consecom A'),b=add('Oferta Consecom B');
 const first=activateCampaign(a);
 assert.equal(first.paused,true);
 assert.equal(first.id,a);
 assert.equal(getSetting('auto_initial'),true);
 assert.equal(getSetting('paused'),true);
 assert.equal(selectedCampaign().id,a);
 assert.equal(one('SELECT is_default FROM workflows WHERE id=?',a).is_default,1);
 const second=activateCampaign(b);
 assert.equal(second.id,b);
 assert.equal(second.previousId,a);
 assert.equal(selectedCampaign().id,b);
 assert.equal(one('SELECT is_default FROM workflows WHERE id=?',a).is_default,0);
 assert.equal(one('SELECT is_default FROM workflows WHERE id=?',b).is_default,1);
 assert.equal(one('SELECT enabled FROM workflows WHERE id=?',a).enabled,1);
 assert.throws(()=>rejectActiveCampaignEdit({id:b}),/somente leitura/);
 assert.doesNotThrow(()=>rejectActiveCampaignEdit({id:a}));
});
test('campaign without real attached media stays a draft and cannot become active',()=>{
 const broken=add('Sem mídia',buildConsecomSteps());
 const activeBefore=selectedCampaign()?.id;
 assert.throws(()=>activateCampaign(broken),/mídia/);
 assert.equal(selectedCampaign().id,activeBefore);
 assert.equal(one('SELECT enabled FROM workflows WHERE id=?',broken).enabled,0);
});
test('an attached but deleted file blocks campaign selection',()=>{
 const broken=add('Arquivo faltando');
 fs.unlinkSync(path.join(folder,vid+'.mp4'));
 assert.throws(()=>activateCampaign(broken),/indisponível no servidor/);
 fs.writeFileSync(path.join(folder,vid+'.mp4'),'test-private-mp4');
});
test('selected campaign is not automatically running while paused or without WhatsApp',()=>{
 assert.equal(getSetting('paused'),true);
 assert.equal(selectedCampaign().enabled,true);
 assert.ok(validateCampaignForActivation(one('SELECT * FROM workflows WHERE id=?',selectedCampaign().id)));
});
