import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-autonomous-gate-'));
process.env.PROSPECTOR_DATA_DIR=dir;
const priorCold=process.env.PROSPECTOR_COLD_FIRST_APPROACH;
const priorEnv=process.env.RAILWAY_ENVIRONMENT;
process.env.RAILWAY_ENVIRONMENT='production';
process.env.PROSPECTOR_COLD_FIRST_APPROACH='false';
const db=await import('../dashboard/db.mjs');
const {queueHealth}=await import('../dashboard/queue-health.mjs');
const {enrollAutonomousApproaches,approachQueueStatus,cancelApproachQueue}=await import('../dashboard/prospecting-queue.mjs');
const at=new Date('2026-11-24T14:00:00Z'); // Tuesday, 11:00 São Paulo.
const lead=db.addLead({business:'Comércio sem consentimento documentado',phone:'5515987112255',city:'Sorocaba',source:'TEST'}).lead;
db.setSetting('paused',false);
db.setSetting('autonomous_outreach_enabled',true);
db.setSetting('auto_initial',false);

test('production must NOT claim READY if real autonomous sender cannot select a lead',()=>{
 const health=queueHealth({at,waStatus:'CONNECTED'});
 assert.equal(health.autonomousMode,true);
 assert.equal(health.reason,'AWAITING_CONSENT');
 assert.equal(health.queue.ready,0);
 assert.equal(health.allowedNow,false);
 assert.equal(approachQueueStatus().requiresDocumentedOptIn,true);
 const batch=enrollAutonomousApproaches({at});
 assert.equal(batch.status,'NO_ELIGIBLE_LEADS');
 assert.equal(db.one('SELECT COUNT(*) n FROM prospecting_batches').n,0);
 assert.equal(db.one('SELECT COUNT(*) n FROM initial_contacts').n,0);
});

test('when explicit owner-authorized first-approach mode is enabled, the queue resumes without duplicate attempts',()=>{
 process.env.PROSPECTOR_COLD_FIRST_APPROACH='true';
 const health=queueHealth({at,waStatus:'CONNECTED'});
 assert.equal(health.reason,'READY');
 assert.ok(health.queue.ready>0);
 assert.equal(health.queue.awaitingConsent,0);
 assert.equal(approachQueueStatus().requiresDocumentedOptIn,false);
 const batch=enrollAutonomousApproaches({at});
 assert.equal(batch.status,'QUEUED');
 assert.equal(batch.queued,1);
 assert.equal(enrollAutonomousApproaches({at}).status,'ACTIVE');
 assert.equal(approachQueueStatus().waiting,1);
 // Scheduling is not a send; no external WhatsApp requests in this test.
 assert.equal(db.one('SELECT COUNT(*) n FROM initial_contacts').n,0);
 assert.equal(db.one("SELECT COUNT(*) n FROM prospecting_batch_items WHERE status='SENT'").n,0);
 cancelApproachQueue();
});

test.after(()=>{
 if(priorCold===undefined)delete process.env.PROSPECTOR_COLD_FIRST_APPROACH;
 else process.env.PROSPECTOR_COLD_FIRST_APPROACH=priorCold;
 if(priorEnv===undefined)delete process.env.RAILWAY_ENVIRONMENT;
 else process.env.RAILWAY_ENVIRONMENT=priorEnv;
 db.db.close();
 fs.rmSync(dir,{recursive:true,force:true});
});
