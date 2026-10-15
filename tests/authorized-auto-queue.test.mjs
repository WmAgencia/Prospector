import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-authorized-outreach-'));
const db=await import('../dashboard/db.mjs');
const queue=await import('../dashboard/outreach-queue.mjs');
const {enableAuthorizedOutreach}=await import('../dashboard/authorized-outreach.mjs');
const {buildConsecomSteps}=await import('../dashboard/consecom-flow.mjs');
const {startWorkflow}=await import('../dashboard/runtime.mjs');
const dir=path.join(process.env.PROSPECTOR_DATA_DIR,'media');fs.mkdirSync(dir,{recursive:true});
const audio=db.id(),video=db.id();
for(const [id,kind,ext,mime] of [[audio,'audio','ogg','audio/ogg'],[video,'video','mp4','video/mp4']]){
 fs.writeFileSync(path.join(dir,id+'.'+ext),'test-file-content');
 db.run('INSERT INTO media(id,name,kind,mime,filename,bytes,created_at) VALUES(?,?,?,?,?,?,?)',id,kind+' test',kind,mime,id+'.'+ext,16,db.now());
}
const workflowId=db.id();
db.run('INSERT INTO workflows(id,name,is_default,version,steps,created_at,updated_at,segments_json,enabled) VALUES(?,?,?,?,?,?,?,?,?)',workflowId,'Teste de campanha 350',1,1,JSON.stringify(buildConsecomSteps({audioId:audio,videoId:video})),db.now(),db.now(),'[]',1);
db.setSetting('autonomous_campaign_id',workflowId);
function lead(business,phone,permission){
 const obj=db.addLead({business,phone,source:'osm',contact_permission:permission});
 return obj.lead;
}
const publicLead=lead('Prospecção pública','5515999100101',false);
const opted=lead('Contato que autorizou','5515999100102',true);
const inbound=lead('Conversa recebida, sem aceite de marketing','5515999100103',true);
const noPhone=db.addLead({business:'Sem telefone',phone:'',instagram:'negocio_semtelefone',source:'osm',contact_permission:false}).lead;
db.audit('CONSENT_UPDATED',opted.id,{permitted:true,evidence:'Formulário opt-in no site em 2026-10-15',method:'manual_registration'});
test('all discovered businesses enter queue, but consent is required for sending',()=>{
 const s=queue.outreachQueueSnapshot();
 assert.equal(s.total,4);
 assert.equal(s.ready,1);
 assert.equal(s.awaitingConsent,2);
 assert.equal(s.missingWhatsapp,1);
 assert.equal(db.one(queue.autoOutreachCandidateSql).id,opted.id);
 assert.equal(queue.documentedOptIn(publicLead.id),false);
 assert.equal(queue.documentedOptIn(inbound.id),false);
 assert.equal(queue.documentedOptIn(opted.id),true);
});
test('enables automatic scheduled outreach without requiring approval per lead',()=>{
 db.setSetting('paused',true);
 db.setSetting('auto_initial',false);
 db.setSetting('automation_enabled',false);
 const result=enableAuthorizedOutreach();
 assert.equal(result.status,'ENABLED');
 assert.equal(result.ready,1);
 assert.equal(db.getSetting('paused'),false);
 assert.equal(db.getSetting('auto_initial'),true);
 assert.equal(db.getSetting('automation_enabled'),true);
 assert.equal(db.getSetting('business_start'),8);
 assert.equal(db.getSetting('business_end'),18);
 assert.equal(db.getSetting('daily_limit'),150);
 assert.equal(db.getSetting('initial_interval_seconds'),240);
 const idempotent=enableAuthorizedOutreach();
 assert.equal(idempotent.status,'CONFIGURED');
});
test('initial workflows are blocked for scraped or unproven contacts',()=>{
 assert.throws(()=>startWorkflow(publicLead.id,workflowId),/autorização comercial comprovada/);
 assert.throws(()=>startWorkflow(inbound.id,workflowId),/autorização comercial comprovada/);
 const execId=startWorkflow(opted.id,workflowId);
 assert.ok(execId);
});
test('once opt-in is revoked, the lead drops out of the send queue',()=>{
 db.run('UPDATE leads SET contact_permission=0 WHERE id=?',opted.id);
 const s=queue.outreachQueueSnapshot();
 assert.equal(s.ready,0);
 assert.equal(s.awaitingConsent,2);
});
