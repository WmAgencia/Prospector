import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/approach-recontact-');
const d=await import('../dashboard/db.mjs');
const {prepareApproaches}=await import('../dashboard/prospecting-approach.mjs');
await import('../dashboard/prospecting-queue.mjs');
let serial=0;
function lead(consent=true){const l=d.addLead({business:'Recontact '+(++serial),phone:String(5515987000000+serial),contact_permission:consent}).lead;if(consent)d.audit('CONSENT_UPDATED',l.id,{permitted:true,evidence:'Local documented opt-in'});return l;}
function oldContact(l){d.run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',l.id,l.phone,'SENT','initial-'+serial,'2026-01-31T12:00:00.000Z');const t=d.getThread(l.id);d.addMessage({threadId:t.id,providerId:'history-'+serial,direction:'out',body:'Old greeting',status:'sent'});d.run('UPDATE messages SET at=? WHERE provider_id=?','2026-01-31T12:00:00.000Z','history-'+serial);d.run("UPDATE leads SET stage='NO_INTEREST' WHERE id=?",l.id);}
test('preview permits documented recontact at exact calendar deadline, never before',t=>{const l=lead();oldContact(l);t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-04-30T11:59:59.999Z')});assert.equal(prepareApproaches({leadIds:[l.id]}).items[0].status,'UNAVAILABLE');t.mock.timers.tick(1);const out=prepareApproaches({leadIds:[l.id]});assert.equal(out.items[0].status,'READY_FOR_APPROVAL');assert.equal(out.ready,1);assert.equal(out.requiresHumanApproval,true);assert.equal(out.autoSent,false);assert.equal(d.one('SELECT COUNT(*) n FROM messages').n,1);});
test('due recontact without documented permission remains manual only',()=>{const l=lead(false);oldContact(l);const out=prepareApproaches({leadIds:[l.id]});assert.equal(out.items[0].status,'NEEDS_PERMISSION');assert.equal(out.manualReady,1);assert.equal(out.ready,0);});
test('due recontact with unknown delivery remains blocked',()=>{const l=lead();oldContact(l);d.run('INSERT INTO prospecting_batches(id,status,created_at,updated_at) VALUES(?,?,?,?)','batch','ACTIVE',d.now(),d.now());d.run('INSERT INTO prospecting_batch_items(id,batch_id,lead_id,phone,status,attempt_at,created_at) VALUES(?,?,?,?,?,?,?)','unknown','batch',l.id,l.phone,'UNKNOWN','2026-01-31T12:00:00.000Z',d.now());assert.equal(prepareApproaches({leadIds:[l.id]}).items[0].status,'UNAVAILABLE');});
test('owner and verified client stay excluded from manual preview',()=>{const owner=lead(false),client=lead();process.env.PROSPECTOR_OWNER_PHONE=owner.phone;d.run("INSERT INTO contact_relationships(phone,kind,evidence,source,updated_at) VALUES(?,'EXISTING_CLIENT','Local verification','OPERATOR',?)",client.phone,d.now());for(const l of [owner,client])assert.equal(prepareApproaches({leadIds:[l.id]}).items[0].status,'UNAVAILABLE');delete process.env.PROSPECTOR_OWNER_PHONE;});
test.after(()=>{d.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
