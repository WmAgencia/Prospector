import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-bulk-approvals-'));
const a=path.join(tmp,'tenant-a'),b=path.join(tmp,'tenant-b');
const operatorPhone='5515988887336';
const fixture=String.raw`
const {addLead,one,run,all,db}=await import('./dashboard/db.mjs');
const {approveLeadBatch,listLeadApprovals}=await import('./dashboard/lead-approvals.mjs');
const input=JSON.parse(process.argv[1]);
const data={};
try{
 if(input.action==='seed'){
  data.leads=[
   addLead({business:'Empresa A',phone:'5515999001234',source:'maps_extension'}).lead,
   addLead({business:'Empresa B',phone:'5515999005678',source:'maps_extension'}).lead
  ].map(x=>({id:x.id,phone:x.phone}));
 }
 if(input.action==='seedMany'){
  data.leads=Array.from({length:input.count},(_,i)=>addLead({
   business:'Empresa em lote '+(i+Number(input.start||0)),
   phone:'55159'+String(10000000+i+Number(input.start||0)),
   source:'maps_extension'
  }).lead).map(x=>({id:x.id,phone:x.phone}));
 }
 if(input.action==='listing')data.list=listLeadApprovals({status:'PENDING',limit:40,offset:0});
 if(input.action==='approve')data.result=approveLeadBatch(input.payload);
 if(input.action==='suppress')run('INSERT OR IGNORE INTO suppressions(phone,reason,created_at) VALUES(?,?,?)',input.phone,'Do not contact',new Date().toISOString());
 if(input.action==='inspect'){
  data.list=listLeadApprovals({status:'ALL',limit:50,offset:0});
  data.audits=all("SELECT action,lead_id,detail FROM audit WHERE action IN ('CONSENT_UPDATED','CONSENT_BATCH_APPROVED') ORDER BY at");
  data.permissions=all('SELECT id,phone,contact_permission FROM leads ORDER BY phone');
 }
}catch(error){data.error=error.message;}
console.log(JSON.stringify(data));
db.close();
`;
function run(folder,payload){
 const out=execFileSync(process.execPath,['--input-type=module','-e',fixture,JSON.stringify(payload)],{
  cwd:path.resolve('.'),
  env:{...process.env,PROSPECTOR_DATA_DIR:folder,PROSPECTOR_TENANT_ID:path.basename(folder),
   PROSPECTOR_TENANT_INTERNAL:'false',PROSPECTOR_AUTONOMOUS_OUTREACH_OPT_IN:'false'},
  encoding:'utf8',timeout:25000
 });
 return JSON.parse(out.trim().split('\n').at(-1));
}
const entry=(leadId,evidence='Sim, autorizo contato pelo WhatsApp.')=>({
 leadId,evidence,evidenceReference:'mensagem-id-'+leadId,channel:'PERSONAL_WHATSAPP',operatorPhone,
 consentAt:new Date().toISOString()
});
test('two-client isolation and each approved lead receives its own evidence',()=>{
 const left=run(a,{action:'seed'}).leads,right=run(b,{action:'seed'}).leads;
 assert.equal(left.length,2);assert.equal(right.length,2);
 const result=run(a,{action:'approve',payload:{confirmedByOperator:true,items:left.map(x=>entry(x.id))}});
 assert.equal(result.result?.approved,2,JSON.stringify(result));
 const first=run(a,{action:'inspect'}),second=run(b,{action:'inspect'});
 assert.equal(first.list.totals.authorized,2);
 assert.equal(first.list.totals.pending,0);
 assert.equal(second.list.totals.authorized,0);
 assert.equal(second.list.totals.pending,2);
 assert.equal(first.audits.filter(x=>x.action==='CONSENT_UPDATED').length,2);
 assert.equal(first.audits.filter(x=>x.action==='CONSENT_BATCH_APPROVED').length,1);
 assert.equal(first.permissions.filter(x=>x.contact_permission===1).length,2);
 for(const a of first.audits.filter(x=>x.action==='CONSENT_UPDATED')){
  const detail=JSON.parse(a.detail);
  assert.equal(detail.permitted,true);
  assert.ok(detail.evidence.length>=3);
  assert.equal(detail.method,'manual_batch_curation');
  assert.match(detail.evidenceReference,/^mensagem-id-/);
  assert.equal(detail.sourcePhone,operatorPhone);
  assert.equal(detail.workspace,'tenant-a');
  assert.ok(detail.batchId);
 }
});
test('invalid evidence and missing confirmation never grant permission',()=>{
 const dir=path.join(tmp,'validation');
 const ids=run(dir,{action:'seed'}).leads;
 const noConfirm=run(dir,{action:'approve',payload:{confirmedByOperator:false,items:[entry(ids[0].id)]}});
 assert.match(noConfirm.error,/Confirme/);
 const noProof=run(dir,{action:'approve',payload:{confirmedByOperator:true,items:[entry(ids[0].id),entry(ids[1].id,'')]}});
 assert.match(noProof.error,/evidência individual/);
 const state=run(dir,{action:'inspect'});
 assert.equal(state.permissions.filter(x=>x.contact_permission===1).length,0);
 assert.equal(state.audits.length,0);
});
test('suppressed lead aborts the entire batch atomically',()=>{
 const dir=path.join(tmp,'atomic');
 const ids=run(dir,{action:'seed'}).leads;
 run(dir,{action:'suppress',phone:ids[1].phone});
 const rejected=run(dir,{action:'approve',payload:{confirmedByOperator:true,items:ids.map(x=>entry(x.id))}});
 assert.match(rejected.error,/bloqueado/);
 const state=run(dir,{action:'inspect'});
 assert.equal(state.permissions.filter(x=>x.contact_permission===1).length,0);
 assert.equal(state.audits.length,0);
 assert.equal(state.list.totals.blocked,1);
});
test('dashboard, server and per-tenant proxy expose approval workflow',()=>{
 const server=fs.readFileSync('dashboard/server.mjs','utf8'),
  platform=fs.readFileSync('dashboard/platform.mjs','utf8'),
  page=fs.readFileSync('dashboard/public/simple-app.js','utf8');
 assert.match(server,/approveLeadBatch\(await json\(req\)\)/);
 assert.match(server,/listLeadApprovals\(/);
 assert.match(platform,/approvals/);
 assert.match(page,/function approvalsView\(/);
 assert.match(page,/data-approval-all/);
 assert.match(page,/approvalSelectAll/);
 assert.doesNotMatch(page,/data-approval-evidence/);
 assert.match(page,/approvalSelection/);
 assert.doesNotMatch(page,/id="approval-affirmation"/);
 assert.match(page,/Aprovar /);
});

test('quick selection approves more than 50 contacts without entering repetitive evidence fields',()=>{
 const dir=path.join(tmp,'quick-many');
 const ids=run(dir,{action:'seedMany',count:123}).leads;
 const result=run(dir,{action:'approve',payload:{
  quick:true,confirmedByOperator:true,allPending:false,leadIds:ids.map(x=>x.id)
 }});
 assert.equal(result.result?.approved,123,JSON.stringify(result));
 const state=run(dir,{action:'inspect'});
 assert.equal(state.list.totals.authorized,123);
 const approvals=state.audits.filter(x=>x.action==='CONSENT_UPDATED');
 assert.equal(approvals.length,123);
 const batches=state.audits.filter(x=>x.action==='CONSENT_BATCH_APPROVED');
 assert.equal(batches.length,1);
 for(const row of approvals){
  const detail=JSON.parse(row.detail);
  assert.equal(detail.evidenceType,'OPERATOR_ATTESTATION');
  assert.equal(detail.evidenceVerified,false);
  assert.equal(detail.method,'manual_quick_approval');
  assert.ok(detail.evidence.includes('Comprovante da conversa não anexado'));
  assert.equal(detail.batchId,JSON.parse(batches[0].detail).batchId);
 }
});
test('select all covers all pending pages, supports exclusions and does not include leads created after selection',()=>{
 const dir=path.join(tmp,'quick-all');
 run(dir,{action:'seedMany',count:97});
 const snapshot=run(dir,{action:'listing'}).list.snapshotAt;
 const pending=run(dir,{action:'inspect'}).permissions;
 assert.equal(pending.length,97);
 const excluded=pending[0].id;
 run(dir,{action:'seedMany',count:2,start:200});
 const result=run(dir,{action:'approve',payload:{
  quick:true,confirmedByOperator:true,allPending:true,selectionCutoff:snapshot,
  excludedLeadIds:[excluded]
 }});
 assert.equal(result.result?.approved,96,JSON.stringify(result));
 const state=run(dir,{action:'inspect'});
 assert.equal(state.list.totals.authorized,96);
 assert.equal(state.list.totals.pending,3);
 assert.equal(state.permissions.find(x=>x.id===excluded).contact_permission,0);
});
test('quick approval refuses missing operator confirmation and blocked contacts atomically',()=>{
 const dir=path.join(tmp,'quick-block');
 const ids=run(dir,{action:'seed'}).leads;
 const noConfirm=run(dir,{action:'approve',payload:{
  quick:true,confirmedByOperator:false,leadIds:ids.map(x=>x.id)
 }});
 assert.match(noConfirm.error,/Confirme/);
 run(dir,{action:'suppress',phone:ids[1].phone});
 const blocked=run(dir,{action:'approve',payload:{
  quick:true,confirmedByOperator:true,leadIds:ids.map(x=>x.id)
 }});
 assert.match(blocked.error,/bloqueado/);
 const state=run(dir,{action:'inspect'});
 assert.equal(state.list.totals.authorized,0);
 assert.equal(state.audits.length,0);
});
test('quick approvals remain isolated to the authenticated workspace database',()=>{
 const left=path.join(tmp,'quick-tenant-1'),right=path.join(tmp,'quick-tenant-2');
 run(left,{action:'seed'});run(right,{action:'seed'});
 const snapshot=run(left,{action:'listing'}).list.snapshotAt;
 const result=run(left,{action:'approve',payload:{
  quick:true,confirmedByOperator:true,allPending:true,selectionCutoff:snapshot
 }});
 assert.equal(result.result?.approved,2,JSON.stringify(result));
 assert.equal(run(left,{action:'inspect'}).list.totals.authorized,2);
 assert.equal(run(right,{action:'inspect'}).list.totals.authorized,0);
});

test.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
