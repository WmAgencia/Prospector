import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/legacy-role-guard-');
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.PROSPECTOR_OWNER_PHONE='5515981817336';
const db=await import('../dashboard/db.mjs');
const role=await import('../dashboard/whatsapp-roles.mjs');
const outreach=await import('../dashboard/outreach-queue.mjs');
const cadence=await import('../dashboard/contact-cadence.mjs');
const now=()=>new Date().toISOString();
function lead(number){
 return db.addLead({business:'Empresa teste '+number.slice(-4),phone:number,source:'MANUAL'}).lead;
}
function consent(l){
 db.run('UPDATE leads SET contact_permission=1 WHERE id=?',l.id);
 db.audit('CONSENT_UPDATED',l.id,{permitted:true,evidence:'Aceite registrado no WhatsApp do operador'});
}
test('Documented opt-in does not override verified owner or existing-client exclusions',()=>{
 const owner=lead('5515981817336');consent(owner);
 const customer=lead('5515999000101');consent(customer);
 const prospect=lead('5515999000102');consent(prospect);
 assert.equal(outreach.documentedOptIn(prospect.id),true);
 assert.equal(outreach.documentedOptIn(owner.id),false);
 assert.equal(outreach.documentedOptIn(customer.id),true);
 role.setExistingClientRelationship({leadId:customer.id,existing:true,evidence:'Contrato vigente registrado'});
 assert.equal(outreach.documentedOptIn(customer.id),false);
 const active=outreach.outreachQueueSnapshot().recent.map(x=>x.id);
 assert.ok(!active.includes(owner.id));
 assert.ok(!active.includes(customer.id));
 assert.ok(active.includes(prospect.id));
 const sql=outreach.autoOutreachCandidateSql;
 const candidates=db.all(sql).map(x=>x.id);
 assert.ok(!candidates.includes(owner.id));
 assert.ok(!candidates.includes(customer.id));
 assert.ok(candidates.includes(prospect.id));
});
test('Operator-verification cancels unsent old invitation and recontact, but preserves a service job',()=>{
 const client=lead('5515999000103');consent(client);
 const earlier=now();
 const jobs=[
  {id:db.id(),key:'recontact:'+client.id+':testing',execution_id:null,step_index:null},
  {id:db.id(),key:'sales-invitation-1',execution_id:'old-execution-1',step_index:0},
  {id:db.id(),key:'support-service-1',execution_id:null,step_index:null}
 ];
 for(const j of jobs){
  db.run("INSERT INTO jobs(id,lead_id,execution_id,step_index,type,text,key,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
   j.id,client.id,j.execution_id,j.step_index,'message','Exemplo',j.key,'PENDING',earlier,earlier);
 }
 role.setExistingClientRelationship({leadId:client.id,existing:true,evidence:'Relação comercial confirmada'});
 assert.equal(db.one('SELECT status FROM jobs WHERE id=?',jobs[0].id).status,'CANCELLED');
 assert.equal(db.one('SELECT status FROM jobs WHERE id=?',jobs[1].id).status,'CANCELLED');
 assert.equal(db.one('SELECT status FROM jobs WHERE id=?',jobs[2].id).status,'PENDING');
});
test('Three-month recontact disallows verified existing client despite an old outreach',()=>{
 const customer=lead('5515999000104');consent(customer);
 db.run("INSERT INTO contact_cadence(phone,lead_id,first_contact_at,last_contact_at,next_contact_at,total_approaches) VALUES(?,?,?,?,?,1)",
  customer.phone,customer.id,'2025-01-01T00:00:00Z','2025-01-01T00:00:00Z','2025-04-01T00:00:00Z');
 const row={...db.one('SELECT * FROM leads WHERE id=?',customer.id),last_contact_at:'2025-01-01T00:00:00Z'};
 assert.equal(cadence.allowedToRecontact(row,Date.parse('2027-01-01T00:00:00Z')),true);
 role.setExistingClientRelationship({leadId:customer.id,existing:true,evidence:'Cliente atual confirmado'});
 assert.equal(cadence.allowedToRecontact(row,Date.parse('2027-01-01T00:00:00Z')),false);
 assert.ok(!cadence.eligibleRecontacts().some(x=>x.lead_id===customer.id));
 assert.throws(()=>cadence.scheduleApprovedRecontact(customer.id,'Olá, podemos conversar novamente?'),/não elegível/);
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
