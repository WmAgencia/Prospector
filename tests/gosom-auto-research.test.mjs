import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const folder=fs.mkdtempSync(path.join(os.tmpdir(),'maps-auto-review-'));
process.env.PROSPECTOR_DATA_DIR=folder;
process.env.PROSPECTOR_MAPS_KEY='synthetic-server-key';
process.env.PROSPECTOR_AUTO_MAPS_DISCOVERY_ENABLED='true';
const db=await import('../dashboard/db.mjs');
const maps=await import('../dashboard/gosom-maps.mjs');
const originalFetch=globalThis.fetch;
const mockId='11111111-1111-4111-8111-111111111111';
const mockId2='22222222-2222-4222-8222-222222222222';
let creates=0,polls=0,downloads=0;
globalThis.fetch=async(url,opts={})=>{
 const u=new URL(String(url));
 assert.equal(u.host,'consecom-prospector-maps.onrender.com');
 assert.equal(opts.headers?.['X-Prospector-Maps-Key'],'synthetic-server-key');
 if(u.pathname==='/api/v1/jobs'&&opts.method==='POST'){
  creates++;return Response.json({id:creates===1?mockId:mockId2});
 }
 if(u.pathname==='/api/v1/jobs/'+mockId){
  polls++;return Response.json({status:'completed'});
 }
 if(u.pathname.endsWith('/download')){
  downloads++;return new Response('link,title,phone,city,address\nhttps://www.google.com/maps/place/Oficina-Sorocaba,Oficina de Teste,15999998888,Sorocaba,Rua QA');
 }
 throw Error('Unmocked '+u.pathname);
};
db.setSetting('discovery_auto_enabled',true);
db.setSetting('paused',true);
db.setSetting('auto_initial',false);
db.setSetting('cities','Sorocaba,Votorantim,Campinas');
const at=new Date('2026-11-04T14:00:00Z');
test('Opted-in research creates a Maps job, imports its OWN completed results and NEVER sends',async()=>{
 const a=await maps.automaticMapsDiscovery({at});
 assert.equal(a.status,'PENDING');assert.equal(a.created,true);
 assert.equal(a.city,'Sorocaba');assert.equal(creates,1);
 const pending=db.one('SELECT auto_discovery,status FROM maps_scraper_jobs ORDER BY created_at LIMIT 1');
 assert.equal(pending.auto_discovery,1);
 assert.equal(pending.status,'PENDING');
 const b=await maps.automaticMapsDiscovery({at});
 assert.equal(b.status,'IMPORTED');assert.equal(b.added,1);
 assert.equal(polls,1);assert.equal(downloads,1);
 const lead=db.one('SELECT business,phone,contact_permission FROM leads WHERE business=?','Oficina de Teste');
 assert.equal(lead.phone,'5515999998888');
 assert.equal(lead.contact_permission,0);
 assert.equal(db.one('SELECT COUNT(*) n FROM initial_contacts').n,0);
 assert.equal(db.one('SELECT COUNT(*) n FROM messages').n,0);
 assert.equal(db.getSetting('paused'),true);
 const noRepeat=await maps.automaticMapsDiscovery({at});
 assert.equal(noRepeat.status,'COOLDOWN');
 assert.equal(creates,1);
});
test('A manual Maps job cannot be auto-imported without its own operator action',async()=>{
 const created=await maps.startMapsScrape({city:'Sorocaba',niche:'cafeterias'});
 assert.equal(created.status,'PENDING');
 const auto=await maps.automaticMapsDiscovery({at:new Date(at.getTime()+2*3600_000)});
 assert.equal(auto.status,'MANUAL_JOB_RUNNING');
 assert.equal(db.one('SELECT auto_discovery FROM maps_scraper_jobs WHERE id=?',created.id).auto_discovery,0);
 assert.equal(downloads,1);
 assert.equal(db.one('SELECT COUNT(*) n FROM initial_contacts').n,0);
});
test.after(()=>{
 globalThis.fetch=originalFetch;
 delete process.env.PROSPECTOR_AUTO_MAPS_DISCOVERY_ENABLED;
 db.db.close();fs.rmSync(folder,{recursive:true,force:true});
});
