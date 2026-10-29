import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/prospector-owner-admin-');
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.PROSPECTOR_OWNER_PHONE='5515981817336';
process.env.PROSPECTOR_LIVE_TEST_ENABLED='false';
const db=await import('../dashboard/db.mjs');
const tools=await import('../dashboard/groq-owner-tools.mjs');
const queue=await import('../dashboard/prospecting-queue.mjs');
const OWNER={jid:'5515981817336@s.whatsapp.net',sessionId:'consecom-principal'};
const IMPOSTOR={jid:'5511981817336@s.whatsapp.net',sessionId:'consecom-principal'};

test('Admin tools require complete matching owner JID and selected WhatsApp session',async()=>{
 await assert.rejects(tools.runAgentTool('read_outreach_queue',{},IMPOSTOR),/proprietário/);
 await assert.rejects(tools.runAgentTool('read_outreach_queue',{},{...OWNER,sessionId:'other'}),/proprietário/);
 await assert.rejects(tools.runAgentTool('read_outreach_queue',{}),/proprietário/);
 const a=await tools.runAgentTool('read_outreach_queue',{},OWNER);
 assert.equal(a.queue.waiting,0);
});

test('Public discovery does not create marketing consent or outbound queue',async()=>{
 const lead=db.addLead({business:'Oficina pública',phone:'5515999990001',city:'Sorocaba',segment:'Oficina',source:'MANUAL'}).lead;
 const result=await tools.runAgentTool('request_start_outreach',{lead_ids:[lead.id]},OWNER);
 assert.equal(result.eligible,0);
 assert.equal(result.requiresConfirmation,false);
 assert.equal(queue.approachQueueStatus().waiting,0);
});

test('Documented consent requires owner confirmation and is not repeatable',async()=>{
 const lead=db.addLead({business:'Empresa autorizada',phone:'5515999990002',city:'Sorocaba',segment:'Oficina',source:'MANUAL'}).lead;
 db.run('UPDATE leads SET contact_permission=1 WHERE id=?',lead.id);
 db.audit('CONSENT_UPDATED',lead.id,{permitted:true,method:'signed_form',evidence:'Aceite comprovado no formulário'});
 const proposed=await tools.runAgentTool('request_start_outreach',{lead_ids:[lead.id]},OWNER);
 assert.equal(proposed.eligible,1);
 assert.match(proposed.code,/^\d{6}$/);
 assert.throws(()=>tools.executeConfirmedOperation(proposed.code,IMPOSTOR),/proprietário/);
 assert.equal(queue.approachQueueStatus().waiting,0);
 const executed=tools.executeConfirmedOperation(proposed.code,OWNER);
 assert.equal(executed.ok,true);
 assert.equal(queue.approachQueueStatus().waiting,1);
 assert.equal(tools.executeConfirmedOperation(proposed.code,OWNER),null);
});

test('Existing customer verification cancels pending marketing',async()=>{
 const lead=db.one("SELECT id FROM leads WHERE business='Empresa autorizada'");
 const p=await tools.runAgentTool('request_set_existing_client',{lead_id:lead.id,existing:true,evidence:'Contrato vigente confirmado'},OWNER);
 assert.equal(p.requiresConfirmation,true);
 const confirmed=tools.executeConfirmedOperation(p.code,OWNER);
 assert.equal(confirmed.ok,true);
 assert.equal(db.one('SELECT status FROM prospecting_batch_items WHERE lead_id=?',lead.id).status,'CANCELLED');
 const future=await tools.runAgentTool('request_start_outreach',{lead_ids:[lead.id]},OWNER);
 assert.equal(future.eligible,0);
});

test('Security limits reject secret keys and invalid intervals',async()=>{
 await assert.rejects(tools.runAgentTool('request_change_setting',{key:'initial_interval_seconds',value:0},OWNER),/limite/);
 await assert.rejects(tools.runAgentTool('request_change_setting',{key:'PROSPECTOR_OWNER_PHONE',value:1},OWNER),/autorizada/);
 const r=await tools.runAgentTool('read_owner_settings',{},OWNER);
 assert.equal(Object.hasOwn(r.settings,'PROSPECTOR_OWNER_PHONE'),false);
});
test('Unpausing an enabled outbound workflow needs owner WhatsApp confirmation',async()=>{
 db.setSetting('paused',true);db.setSetting('auto_initial',true);
 try{
  const r=await tools.runAgentTool('set_pause',{paused:false},OWNER);
  assert.equal(r.requiresConfirmation,true);
  assert.match(r.code,/^\d{6}$/);
  assert.equal(db.getSetting('paused'),true);
 }finally{db.setSetting('auto_initial',false);}
});
test.after(()=>{db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
