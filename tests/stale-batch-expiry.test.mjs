import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/stale-batch-');
const db=await import('../dashboard/db.mjs');
db.setSetting('paused',false);
db.setSetting('autonomous_outreach_enabled',true);
const queue=await import('../dashboard/prospecting-queue.mjs');
const TODAY=Date.parse('2026-11-04T13:00:00Z');
test('a batch left active overnight expires so the next day can preload',()=>{
 const lead=db.addLead({business:'Lote antigo',phone:'11987770001',source:'MANUAL'}).lead;
 assert.equal(queue.enqueueApprovedApproaches({leadIds:[lead.id],approve:true,operatorApproved:true}).status,202);
 // O lote de ontem continua ACTIVE na manhã seguinte (created_at em dia anterior).
 db.run("UPDATE prospecting_batches SET created_at='2026-11-03T13:00:00.000Z'");
 const fresh=db.addLead({business:'Lote novo',phone:'11987770002',source:'MANUAL'}).lead;
 const preloaded=queue.preloadApproachQueue({at:new Date(TODAY)});
 assert.notEqual(preloaded.status,'ACTIVE');
 assert.equal(db.one("SELECT COUNT(*) n FROM prospecting_batches WHERE status='ACTIVE'").n,1);
 assert.equal(db.one("SELECT COUNT(*) n FROM prospecting_batch_items WHERE status='CANCELLED'").n,1);
 assert.ok(db.one("SELECT id FROM prospecting_batches WHERE status='EXPIRED'"));
 // The new batch still carries the fresh lead.
 assert.ok(db.one("SELECT id FROM prospecting_batch_items WHERE lead_id=? AND status='QUEUED'",fresh.id));
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
