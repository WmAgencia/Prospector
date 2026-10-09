import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const dbUrl=pathToFileURL(path.resolve('dashboard/db.mjs')).href;
const runtimeUrl=pathToFileURL(path.resolve('dashboard/runtime.mjs')).href;
test('SQLite, deduplicação e cancelamento seguro do workflow',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-check-'));
 try{
  const script=[
   "import assert from 'node:assert/strict';",
   "import {addLead,one,all,stopLead,getSetting} from "+JSON.stringify(dbUrl)+";",
   "import {startWorkflow,drive} from "+JSON.stringify(runtimeUrl)+";",
   "const a=addLead({business:'Clínica Exemplo',instagram:'clinica.exemplo',phone:'15999998888',contact_permission:true});",
   "assert.equal(a.created,true);",
   "assert.equal(addLead({business:'Outra',instagram:'clinica.exemplo'}).created,false);",
   "assert.equal(getSetting('paused'),true);",
   "const workflow=startWorkflow(a.lead.id);drive(workflow);",
   "assert.equal(one('SELECT status FROM initial_contacts WHERE lead_id=?',a.lead.id).status,'RESERVED');",
   "assert.equal(one('SELECT status FROM jobs WHERE lead_id=?',a.lead.id).status,'PENDING');",
   "assert.throws(()=>startWorkflow(a.lead.id));",
   "stopLead(a.lead.id,'NOT_INTERESTED');",
   "assert.equal(one('SELECT status FROM jobs WHERE lead_id=?',a.lead.id).status,'CANCELLED');",
   "assert.equal(one('SELECT stage FROM leads WHERE id=?',a.lead.id).stage,'NO_INTEREST');"
  ].join('\n');
  const p=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:dir,encoding:'utf8',timeout:20000});
  assert.equal(p.status,0,(p.stderr||'')+(p.stdout||''));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
