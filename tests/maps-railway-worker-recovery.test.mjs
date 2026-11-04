import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'maps-railway-private-'));
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.PROSPECTOR_MAPS_KEY='synthetic-private-key';
process.env.PROSPECTOR_MAPS_BASE_URL='http://prospector-maps.railway.internal:10000';
process.env.PROSPECTOR_AUTO_MAPS_DISCOVERY_ENABLED='true';
const db=await import('../dashboard/db.mjs');
const maps=await import('../dashboard/gosom-maps.mjs');
const originalFetch=globalThis.fetch;
const oldJobId='11111111-1111-4111-8111-111111111111';
const newJobId='22222222-2222-4222-8222-222222222222';
let calls=0,imports=0;
globalThis.fetch=async(url,opts={})=>{
 const u=new URL(String(url));
 assert.equal(u.host,'prospector-maps.railway.internal:10000');
 assert.equal(opts.headers?.['X-Prospector-Maps-Key'],'synthetic-private-key');
 if(opts.method==='POST'&&u.pathname==='/api/v1/jobs'){
  calls++;return Response.json({id:newJobId});
 }
 if(u.pathname==='/api/v1/jobs/'+oldJobId)return new Response('not found',{status:404});
 // Gosom native API returns 'ok' for a completed scrape.
 if(u.pathname==='/api/v1/jobs/'+newJobId)return Response.json({status:'ok'});
 if(u.pathname==='/api/v1/jobs/'+newJobId+'/download'){
  imports++;return new Response('link,title,phone,city\nhttps://www.google.com/maps/place/Prospector-QA,Empresa QA,+55 15 99999-1111,Sorocaba');
 }
 throw Error('Unexpected '+u.pathname);
};
db.setSetting('discovery_auto_enabled',true);
db.setSetting('cities','Sorocaba');
db.setSetting('maps_auto_last_start_at','2026-11-04T11:45:00.000Z');
const old=db.id();
db.run("INSERT INTO maps_scraper_jobs(id,provider_id,niche,city,status,created_at,updated_at,auto_discovery) VALUES(?,?,?,?,?,?,?,?)",
 old,oldJobId,'oficinas mecânicas','Sorocaba','RUNNING','2026-11-04T11:45:00.000Z','2026-11-04T11:45:00.000Z',1);
const at=new Date('2026-11-04T12:05:00Z');
test('a job lost on previous provider is marked failed without importing stale data',async()=>{
 const result=await maps.automaticMapsDiscovery({at});
 assert.equal(result.status,'FAILED');
 assert.equal(db.one('SELECT status FROM maps_scraper_jobs WHERE id=?',old).status,'FAILED');
 assert.equal(calls,0);
});
test('Railway private worker starts a fresh job without waiting for cooldown after provider migration',async()=>{
 const result=await maps.automaticMapsDiscovery({at});
 assert.equal(result.status,'PENDING');
 assert.equal(result.created,true);
 assert.equal(calls,1);
 const next=await maps.automaticMapsDiscovery({at});
 assert.equal(next.status,'IMPORTED');
 assert.equal(next.added,1);
 assert.equal(imports,1);
 assert.equal(db.one("SELECT COUNT(*) n FROM leads WHERE phone IS NOT NULL").n,1);
 assert.equal(db.one("SELECT COUNT(*) n FROM initial_contacts").n,0);
 assert.equal(db.getSetting('paused',true),true);
});
test.after(()=>{globalThis.fetch=originalFetch;delete process.env.PROSPECTOR_MAPS_BASE_URL;db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
