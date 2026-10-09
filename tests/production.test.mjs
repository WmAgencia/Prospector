import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const db=pathToFileURL(path.resolve('dashboard/db.mjs')).href;
const prod=pathToFileURL(path.resolve('dashboard/production.mjs')).href;
const notices=pathToFileURL(path.resolve('dashboard/notifications.mjs')).href;
test('solicitação, publicação, aprovação e entrega sem duplicar',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-prod-'));
 try{
  const lines=[
   "import assert from 'node:assert/strict';",
   "import {addLead,one,all,getThread,addMessage,setSetting} from "+JSON.stringify(db)+";",
   "import {onReply,move,approveAndQueue,onSent,interpretOfferReply,explicitSampleRequest,brief,closeDeal} from "+JSON.stringify(prod)+";",
   "import {targetNumber,scheduleReport} from "+JSON.stringify(notices)+";",
   "assert.equal(interpretOfferReply('pode sim'),'ACCEPTED');",
   "assert.equal(interpretOfferReply('não quero'),'DECLINED');",
   "assert.equal(interpretOfferReply('talvez depois'),'UNCERTAIN');",
   "assert.equal(explicitSampleRequest('me manda um exemplo do site'),true);",
   "assert.equal(explicitSampleRequest('oi tudo bem'),false);",
   "const l=addLead({business:'Empresa de teste',phone:'15999991111',instagram:'exemplo_teste',contact_permission:true}).lead;",
   "const t=getThread(l.id);addMessage({threadId:t.id,direction:'in',body:'me manda um exemplo do site'});",
   "assert.equal(onReply(l.id,'me manda um exemplo do site',true),'ACCEPTED');",
   "assert.equal(one('SELECT status FROM production_requests WHERE lead_id=?',l.id).status,'REQUESTED');",
   "assert.equal(one('SELECT manual_takeover FROM threads WHERE id=?',t.id).manual_takeover,1);",
   "assert.equal(all('SELECT * FROM owner_notices').length,1);",
   "assert.equal(onReply(l.id,'sim',true),null);",
   "move(l.id,'IN_PROGRESS');",
   "const ready=move(l.id,'READY','https://prospector-ui-production.up.railway.app/studio/sites/empresa.html');",
   "assert.equal(ready.status,'READY');assert.equal(all('SELECT * FROM owner_notices').length,2);",
   "assert.ok(brief(l.id).job_reference);",
   "assert.throws(()=>move(l.id,'READY','https://evil.example/'));",
   "const job=approveAndQueue(l.id);assert.equal(job.status,'SEND_QUEUED');",
   "assert.throws(()=>approveAndQueue(l.id));",
   "assert.equal(one('SELECT COUNT(*) AS n FROM jobs').n,1);",
   "onSent(job.delivery_job_id);",
   "assert.equal(one('SELECT status FROM production_requests WHERE lead_id=?',l.id).status,'DELIVERED');",
   "closeDeal(l.id);assert.equal(one('SELECT stage FROM leads WHERE id=?',l.id).stage,'CLOSED_WON');",
   "setSetting('owner_phone_a','5515999991111');setSetting('owner_phone_b','5515999992222');",
   "assert.equal(targetNumber('5515999991111:1@s.whatsapp.net'),'5515999992222');",
   "assert.equal(targetNumber('5515999992222:1@s.whatsapp.net'),'5515999991111');",
   "assert.equal(targetNumber('5515999993333:1@s.whatsapp.net'),null);",
   "setSetting('owner_notifications_enabled',true);",
   "assert.equal(scheduleReport(new Date('2026-10-09T23:30:00Z')),true);",
   "assert.equal(scheduleReport(new Date('2026-10-09T23:35:00Z')),false);"
  ];
  const script=path.join(dir,'test.mjs');fs.writeFileSync(script,lines.join('\n'));
  const p=spawnSync(process.execPath,[script],{cwd:dir,encoding:'utf8',timeout:20000});
  assert.equal(p.status,0,p.stdout+'\n'+p.stderr);
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
