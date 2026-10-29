import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';

const originalFetch=globalThis.fetch;
const originalKey=process.env.PROSPECTOR_MAPS_KEY;
const dir=fs.mkdtempSync(os.tmpdir()+'/prospector-gosom-');
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.PROSPECTOR_MAPS_KEY='test-server-only-secret';
const db=await import('../dashboard/db.mjs');
const maps=await import('../dashboard/gosom-maps.mjs');

test('Gosom job creation, background completion, confirmed import and deduplication',async()=>{
 const providerId='11111111-1111-4111-8111-111111111111';
 let status='running',creates=0,downloads=0,reads=0,timeoutNext=false;
 const csv=[
  'link,title,phone,website,address',
  '"https://www.google.com/maps/place/Empresa+QA","Empresa QA","+55 15 99999-1111","https://qa.example.org","Rua Um, 1"',
  '"https://www.google.com/maps/place/Empresa+QA","Empresa QA","+55 15 99999-1111","https://qa.example.org","Rua Um, 1"',
 ].join('\r\n');
 globalThis.fetch=async(url,opts={})=>{
  if(timeoutNext){timeoutNext=false;throw new DOMException('timeout','TimeoutError');}
  const u=new URL(String(url));
  assert.equal(u.host,'consecom-prospector-maps.onrender.com');
  assert.equal(opts.headers?.['X-Prospector-Maps-Key'],'test-server-only-secret');
  if(u.pathname==='/api/v1/jobs'&&opts.method==='POST'){
   creates++;return Response.json({id:providerId});
  }
  if(u.pathname.endsWith('/download')){
   downloads++;return new Response(csv,{status:200,headers:{'Content-Type':'text/csv'}});
  }
  if(u.pathname.endsWith(providerId)){
   reads++;return Response.json({status});
  }
  throw Error('Unexpected mock route '+u.pathname);
 };
 try{
  const created=await maps.startMapsScrape({niche:'oficinas mecânicas',city:'Sorocaba'});
  assert.equal(created.status,'PENDING');
  assert.equal(creates,1);
  const reused=await maps.startMapsScrape({niche:'oficinas mecânicas',city:'Sorocaba'});
  assert.equal(reused.reused,true);
  assert.equal(creates,1,'never create a duplicate queued provider job');
  let updated=await maps.refreshActiveMapsScrapes();
  assert.equal(updated[0].status,'RUNNING');
  assert.equal(updated[0].changed,true);
  assert.equal(downloads,0,'status polling must never import automatically');
  timeoutNext=true;
  const unavailable=await maps.refreshActiveMapsScrapes();
  assert.match(unavailable[0].error,/Gosom não respondeu/);
  assert.equal(db.one('SELECT status FROM maps_scraper_jobs WHERE id=?',created.id).status,'RUNNING','timeout is not a failed scrape');
  assert.match(db.one('SELECT error FROM maps_scraper_jobs WHERE id=?',created.id).error,/Gosom não respondeu/);
  status='completed';
  updated=await maps.refreshActiveMapsScrapes();
  assert.equal(updated[0].status,'COMPLETED');
  assert.equal(updated[0].changed,true);
  assert.equal(reads,2);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM leads').n,0);
  const imported=await maps.importMapsScrape(created.id);
  assert.equal(imported.ok,true);
  assert.equal(imported.added,1);
  assert.equal(downloads,1);
  const lead=db.one("SELECT business,contact_permission,phone,website FROM leads WHERE business='Empresa QA'");
  assert.equal(lead.business,'Empresa QA');
  assert.equal(lead.contact_permission,0,'Google Maps never grants outreach consent');
  assert.equal(lead.phone,'5515999991111');
  assert.equal(lead.website,'https://qa.example.org');
  assert.equal(db.one("SELECT COUNT(*) AS n FROM lead_origins WHERE source='maps_extension'").n,1);
  const second=await maps.importMapsScrape(created.id);
  assert.equal(second.alreadyImported,true);
  assert.equal(downloads,1,'import must be idempotent');
  assert.equal(db.getSetting('paused',true),true,'test must not activate WhatsApp sending');
 }finally{globalThis.fetch=originalFetch;}
});

test.after(()=>{
 globalThis.fetch=originalFetch;
 if(originalKey===undefined)delete process.env.PROSPECTOR_MAPS_KEY;
 else process.env.PROSPECTOR_MAPS_KEY=originalKey;
 db.db.close();
 fs.rmSync(dir,{recursive:true,force:true});
});
