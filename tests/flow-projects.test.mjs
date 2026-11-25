import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-flow-library-'));
process.env.PROSPECTOR_DATA_DIR=dir;
delete process.env.PROSPECTOR_TENANT_ID;
const d=await import('../dashboard/db.mjs');
const {listFlowProjects,mutateFlowProject,validateFlow}=await import('../dashboard/flow-projects.mjs');
const {WESLEY_INTRO}=await import('../dashboard/prospecting-introduction.mjs');
d.setSetting('daily_limit',90);
test('owner reference is generated from existing constants and cannot be changed or duplicated',()=>{
 const reference=listFlowProjects().items.find(p=>p.protected);
 assert.equal(reference.settings.dailyLimit,90);
 assert.equal(reference.definition.steps.find(s=>s.id==='intro').variants[0].text,WESLEY_INTRO);
 for(const action of ['save','duplicate','version'])assert.throws(()=>mutateFlowProject(action,{id:reference.id,revision:0}),/protegido/);
 assert.equal(listFlowProjects().executionEnabled,false);
});
test('independent niche projects persist variants and versions without mutating operational state',()=>{
 const before=d.all('SELECT * FROM settings');
 const project=mutateFlowProject('create',{name:'Eventos',niche:'Espaços de eventos'});
 project.definition.steps[0].variants=[{id:'a',text:'Mensagem A',weight:1},{id:'b',text:'Mensagem B',weight:1}];
 project.definition.steps.push({id:'reply',kind:'reply',name:'Aguardar',variants:[]});
 const saved=mutateFlowProject('save',project);
 assert.equal(saved.revision,2);
 assert.throws(()=>mutateFlowProject('save',project),/outra aba/);
 const published=mutateFlowProject('version',{id:saved.id,revision:saved.revision});
 assert.equal(published.publishedVersion,1);
 const duplicate=mutateFlowProject('duplicate',{id:published.id,name:'Clínicas',niche:'Saúde'});
 assert.notEqual(duplicate.id,published.id);
 assert.equal(duplicate.niche,'Saúde');
 assert.deepEqual(duplicate.definition,published.definition);
 assert.equal(duplicate.publishedVersion,null);
 assert.deepEqual(d.all('SELECT * FROM settings'),before);
 assert.equal(d.one('SELECT COUNT(*) n FROM jobs').n,0);
});
test('invalid and incomplete flows cannot be versioned',()=>{
 assert.throws(()=>validateFlow({steps:[{id:'a',kind:'text',variants:[{id:'x',text:'',weight:1}]}]},{publish:true}),/Preencha/);
 assert.throws(()=>validateFlow({steps:[{id:'a',kind:'text',variants:[{id:'x',text:'Oi',weight:0}]}]}),/Peso/);
 assert.throws(()=>validateFlow({steps:[{id:'a',kind:'reply'},{id:'a',kind:'reply'}]}),/repetida/);
});
test('external tenant cannot see or change owner reference',()=>{
 process.env.PROSPECTOR_TENANT_ID='synthetic-tenant';process.env.PROSPECTOR_TENANT_INTERNAL='false';
 try{assert.equal(listFlowProjects().items.some(p=>p.id==='consecom-current'),false);assert.throws(()=>mutateFlowProject('duplicate',{id:'consecom-current'}),/protegido/);}
 finally{delete process.env.PROSPECTOR_TENANT_ID;delete process.env.PROSPECTOR_TENANT_INTERNAL;}
});
test('browser modules compile as ESM',()=>{
 for(const file of ['simple-app.js','flow-editor.js']){
  const source=fs.readFileSync(new URL('../dashboard/public/'+file,import.meta.url),'utf8');
  const check=spawnSync(process.execPath,['--input-type=module','--check'],{input:source,encoding:'utf8'});
  assert.equal(check.status,0,check.stderr);
 }
});
test.after(()=>{d.db.close();fs.rmSync(dir,{recursive:true,force:true});});
