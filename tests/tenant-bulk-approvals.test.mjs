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
const {armApprovedOutreach,apply250DailyLimit}=await import('./dashboard/approval-ready-activation.mjs');
const input=JSON.parse(process.argv[1]);
const data={};
try{
 if(input.action==='cap'){
  data.result=apply250DailyLimit();
  const {getSetting}=await import('./dashboard/db.mjs');
  data.persisted=getSetting('daily_limit');
  data.radar=(await import('./dashboard/radar.mjs')).budgetConfig().limit;
  data.budget=(await import('./dashboard/daily-approach-limit.mjs')).dailyApproachBudget().limit;
  data.auditEvents=all("SELECT action,detail FROM audit WHERE action='OWNER_DAILY_LIMIT_250'");
 }
 if(input.action==='arm'){
  data.result=armApprovedOutreach();
  data.controls=Object.fromEntries(['paused','autonomous_outreach_enabled','discovery_auto_enabled','cold_first_approach_enabled','auto_initial','automation_enabled'].map(k=>[k,(await import('./dashboard/db.mjs')).getSetting(k)]));
  data.activationAudits=all("SELECT action,detail FROM audit WHERE action='APPROVAL_READY_OUTREACH_ARMED'");
 }
 if(input.action==='setControl')(await import('./dashboard/db.mjs')).setSetting(input.key,input.value);
 if(input.action==='testAndLead'){
  const t=addLead({business:'Contato WhatsApp 7336',phone:'5515981817336',source:'WHATSAPP_INBOUND'}).lead;
  const real=addLead({business:'Empresa válida',phone:'5515991001100',source:'maps_extension'}).lead;
  data.testId=t.id;data.realId=real.id;
 }
 if(input.action==='windowDryRun'){
  const {insideApproachWindow}=await import('./dashboard/outreach-window.mjs');
  const {enrollAutonomousApproaches,tickApproachQueue}=await import('./dashboard/prospecting-queue.mjs');
  const before=new Date('2026-11-10T10:59:59.000Z'),at=new Date('2026-11-10T11:00:00.000Z');
  data.beforeWindow=insideApproachWindow(before);data.atWindow=insideApproachWindow(at);
  data.before=enrollAutonomousApproaches({at:before});
  data.at=enrollAutonomousApproaches({at});
  data.queued=all("SELECT lead_id,phone FROM prospecting_batch_items WHERE status='QUEUED'");
  if(input.simulateSend&&data.at.status==='QUEUED'){
   const sent=[];
   data.tick=await tickApproachQueue({
    currentTime:()=>Date.parse('2026-11-10T11:00:02.000Z'),
    getWaStatus:async()=>({connected:true,sessionId:'test-sender'}),
    getSession:()=> 'test-sender',
    send:async()=>{sent.push('FAKE_SEND');return {status:true};}
   });
   data.fakeSendCount=sent.length;
  }
 }
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
 if(input.action==='seedOldApproved'){
  const approved=addLead({business:'Contato autorizado antigo',phone:'5515980012345',source:'maps_extension'}).lead;
  run('UPDATE leads SET created_at=? WHERE id=?','2026-10-01T12:00:00.000Z',approved.id);
  for(let i=0;i<130;i++)addLead({business:'Contato sem autorização '+i,phone:'55159'+String(10000000+i),source:'maps_extension'});
  data.approvedId=approved.id;
 }
 if(input.action==='enroll'){
  const {enrollAutonomousApproaches}=await import('./dashboard/prospecting-queue.mjs');
  data.result=enrollAutonomousApproaches({at:new Date('2026-11-10T14:00:00.000Z'),maxBatch:80});
  data.queued=all("SELECT lead_id FROM prospecting_batch_items WHERE status='QUEUED'");
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
  env:{...process.env,PROSPECTOR_DATA_DIR:folder,PROSPECTOR_TENANT_ID:payload?.simulateSend?'':path.basename(folder),
   PROSPECTOR_TENANT_INTERNAL:payload?.primary?'true':'false',PROSPECTOR_FORCE_OUTREACH_PAUSE:'false',PROSPECTOR_AUTONOMOUS_OUTREACH_OPT_IN:'false',PROSPECTOR_COLD_FIRST_APPROACH:'false',PROSPECTOR_REQUIRE_DOCUMENTED_OPTIN:'true',PROSPECTOR_TEST_CONTACT_PHONE:'5515981817336',PROSPECTOR_APPROACH_START_DATE:'2026-11-10',WA_AKG_SESSION_ID:'test-sender'},
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
test('quick approval requires confirmation and skips blocked contacts without rejecting the others',()=>{
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
 assert.equal(blocked.result?.approved,1,JSON.stringify(blocked));
 assert.equal(blocked.result?.skipped,1);
 assert.equal(blocked.result?.skippedReasons?.CONTATO_BLOQUEADO,1);
 const state=run(dir,{action:'inspect'});
 assert.equal(state.list.totals.authorized,1);
 assert.equal(state.audits.filter(x=>x.action==='CONSENT_UPDATED').length,1);
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

test('one-time owner activation arms only consent-gated prospecting, keeps legacy sends off and is auditable',()=>{
 const dir=path.join(tmp,'ready-primary');
 const first=run(dir,{action:'arm',primary:true});
 assert.equal(first.result?.status,'READY_FOR_APPROVED_LEADS',JSON.stringify(first));
 assert.deepEqual(first.controls,{
  paused:false,
  autonomous_outreach_enabled:true,
  discovery_auto_enabled:true,
  cold_first_approach_enabled:false,
  auto_initial:false,
  automation_enabled:false
 });
 assert.equal(first.activationAudits.length,1);
 const entry=JSON.parse(first.activationAudits[0].detail);
 assert.equal(entry.requiresRecordedConsent,true);
 assert.equal(entry.unsolicitedColdApproach,false);
 run(dir,{action:'setControl',primary:true,key:'paused',value:true});
 const second=run(dir,{action:'arm',primary:true});
 assert.equal(second.result.status,'ALREADY_APPLIED');
 assert.equal(second.controls.paused,true,'manual pause must survive a restart');
 assert.equal(second.activationAudits.length,1);
 const isolated=run(path.join(tmp,'ready-other-tenant'),{action:'arm'});
 assert.equal(isolated.result.status,'OTHER_TENANT_UNCHANGED');
 assert.equal(isolated.controls.paused,true);
 assert.equal(isolated.activationAudits.length,0);
});
test('automatic queue reaches older approved contact behind 130 newer unapproved leads',()=>{
 const dir=path.join(tmp,'many-pending-before-approval');
 const oldest=run(dir,{action:'seedOldApproved'}).approvedId;
 const arm=run(dir,{action:'arm',primary:true});
 assert.equal(arm.result?.status,'READY_FOR_APPROVED_LEADS');
 const approved=run(dir,{action:'approve',payload:{quick:true,leadIds:[oldest],confirmedByOperator:true}});
 assert.equal(approved.result?.approved,1);
 const enrolled=run(dir,{action:'enroll'});
 assert.equal(enrolled.result?.status,'QUEUED',JSON.stringify(enrolled));
 assert.equal(enrolled.result?.queued,1);
 assert.deepEqual(enrolled.queued.map(x=>x.lead_id),[oldest]);
});
test('select all with more than 500 pending contacts works in one transaction',()=>{
 const dir=path.join(tmp,'large-total');
 run(dir,{action:'seedMany',count:513});
 const snapshot=run(dir,{action:'listing'}).list.snapshotAt;
 const result=run(dir,{action:'approve',payload:{quick:true,confirmedByOperator:true,
  allPending:true,selectionCutoff:snapshot,excludedLeadIds:[]}});
 assert.equal(result.result?.approved,513,JSON.stringify(result));
 assert.equal(result.result?.skipped,0);
 assert.equal(run(dir,{action:'inspect'}).list.totals.authorized,513);
});
test('daily 250 persists and is respected by both scheduler budget and dashboard',()=>{
 const dir=path.join(tmp,'daily250');
 const first=run(dir,{action:'cap',primary:true});
 assert.equal(first.result?.status,'UPDATED');
 assert.equal(first.persisted,250);
 assert.equal(first.radar,250);
 assert.equal(first.budget,250);
 assert.equal(first.auditEvents.length,1);
 const again=run(dir,{action:'cap',primary:true});
 assert.equal(again.result?.status,'ALREADY_APPLIED');
 assert.equal(again.auditEvents.length,1);
 const other=run(path.join(tmp,'daily250-other'),{action:'cap'});
 assert.equal(other.result?.status,'OTHER_TENANT_UNCHANGED');
});

test('exclude test contact 7336 from approvals and outbound without deleting historical lead',()=>{
 const dir=path.join(tmp,'exclude-7336');
 const ids=run(dir,{action:'testAndLead'});
 const list=run(dir,{action:'listing'}).list;
 assert.equal(list.totals.pending,1);
 assert.deepEqual(list.items.map(x=>x.id),[ids.realId]);
 const result=run(dir,{action:'approve',payload:{quick:true,allPending:true,selectionCutoff:list.snapshotAt,confirmedByOperator:true}});
 assert.equal(result.result?.approved,1,JSON.stringify(result));
 const view=run(dir,{action:'inspect'});
 assert.equal(view.list.totals.authorized,1);
 assert.equal(view.permissions.length,2);
 const reject=run(dir,{action:'approve',payload:{quick:true,leadIds:[ids.testId],confirmedByOperator:true}});
 assert.equal(reject.result?.approved,0);
 assert.equal(reject.result?.skippedReasons?.CONTATO_DE_TESTE,1);
});
test('08:00 on Nov 10 makes an eligible queue; fake sender proves dispatch path without real WhatsApp sends',()=>{
 const dir=path.join(tmp,'nextday-08');
 const ids=run(dir,{action:'testAndLead',simulateSend:true});
 run(dir,{action:'arm',primary:true,simulateSend:true});
 const approved=run(dir,{action:'approve',simulateSend:true,payload:{quick:true,confirmedByOperator:true,leadIds:[ids.realId]}});
 assert.equal(approved.result?.approved,1);
 const r=run(dir,{action:'windowDryRun',simulateSend:true});
 assert.equal(r.beforeWindow,false);
 assert.equal(r.atWindow,true);
 assert.equal(r.before?.status,'OUTSIDE_WINDOW',JSON.stringify(r));
 assert.equal(r.at?.status,'QUEUED',JSON.stringify(r));
 assert.equal(r.queued?.length,1);
 assert.equal(r.queued?.[0]?.phone,'5515991001100');
 assert.equal(r.tick?.status,'SENT',JSON.stringify(r));
 assert.equal(r.fakeSendCount,1);
});
test('approval action is in the top toolbar, not a second bottom panel',()=>{
 const page=fs.readFileSync(path.join(process.cwd(),'dashboard/public/simple-app.js'),'utf8');
 assert.match(page,/approval-toolbar-actions/);
 assert.match(page,/approveAction/);
 assert.doesNotMatch(page,/approval-submit-panel/);
});

test.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
