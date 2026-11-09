import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-tenant-controls-'));
const a=path.join(root,'company-a'),b=path.join(root,'company-b');
const script=`
const {prospectingControls,saveProspectingControl}=await import('./dashboard/tenant-prospecting-controls.mjs');
let command=JSON.parse(process.argv[1]);
let results=[];
for(const [k,v] of Object.entries(command)){
 if(k!=='read')results.push(saveProspectingControl(k,v));
}
const {db}=await import('./dashboard/db.mjs');
console.log(JSON.stringify({controls:prospectingControls(),readOnly:command.read===true}));
db.close();
`;
function run(folder,command){
 const stdout=execFileSync(process.execPath,['--input-type=module','-e',script,JSON.stringify(command)],{
  cwd:path.resolve('.'),
  env:{...process.env,PROSPECTOR_DATA_DIR:folder,PROSPECTOR_TENANT_ID:path.basename(folder),PROSPECTOR_TENANT_INTERNAL:'false',PROSPECTOR_COLD_FIRST_APPROACH:'true'},
  encoding:'utf8',timeout:20000
 });
 return JSON.parse(stdout).controls;
}
test('different tenants persist independently, even when Railway cold flag is globally true',()=>{
 const defaults={paused:true,autonomous_outreach_enabled:false,cold_first_approach_enabled:false};
 assert.deepEqual(run(a,{read:true}),defaults);
 assert.deepEqual(run(b,{read:true}),defaults);
 assert.deepEqual(run(a,{paused:false,autonomous_outreach_enabled:true,cold_first_approach_enabled:true}),{paused:false,autonomous_outreach_enabled:true,cold_first_approach_enabled:true});
 assert.deepEqual(run(b,{read:true}),defaults);
 assert.deepEqual(run(a,{read:true}),{paused:false,autonomous_outreach_enabled:true,cold_first_approach_enabled:true});
 assert.deepEqual(run(b,{paused:true,cold_first_approach_enabled:true}),{paused:true,autonomous_outreach_enabled:false,cold_first_approach_enabled:true});
 assert.equal(run(a,{read:true}).paused,false);
 assert.equal(run(a,{read:true}).cold_first_approach_enabled,true);
});
test('server and UI provide three authenticated, per-client settings switches',()=>{
 const source=fs.readFileSync('dashboard/server.mjs','utf8'),ui=fs.readFileSync('dashboard/public/simple-app.js','utf8'),queue=fs.readFileSync('dashboard/prospecting-queue.mjs','utf8'),platform=fs.readFileSync('dashboard/platform.mjs','utf8');
 for(const key of ['paused','autonomous_outreach_enabled','cold_first_approach_enabled'])assert.ok(source.includes(key),key);
 for(const id of ['s-paused','s-autonomous','s-cold-first'])assert.ok(ui.includes(id),id);
 assert.match(platform,/path\.join\(root,'clients',client\.id\)/);
 assert.match(source,/saveProspectingControl\(k,value\)/);
 assert.match(queue,/requiresDocumentedOptIn\(\)&&!documentedOptIn\(l\.id\)/);
 assert.match(ui,/post\("\/api\/settings"/);
});
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
