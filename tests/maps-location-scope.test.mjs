import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/maps-city-scope-');process.env.PROSPECTOR_MAPS_KEY='synthetic';
const d=await import('../dashboard/db.mjs');const maps=await import('../dashboard/gosom-maps.mjs');
test('structured city outside requested city is not relabeled as a local prospect',async()=>{
 const job=d.id(),at=d.now();d.run('INSERT INTO maps_scraper_jobs(id,provider_id,niche,city,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',job,d.id(),'dentista','Sorocaba','COMPLETED',at,at);
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('link,title,phone,city,address\nhttps://www.google.com/maps/place/A,Empresa A,15999990001,Sorocaba,Rua A\nhttps://www.google.com/maps/place/B,Empresa B,19999990002,Campinas,Rua B');
 try{const out=await maps.importMapsScrape(job);assert.equal(out.added,1);assert.equal(out.skipped,1);assert.equal(d.one('SELECT COUNT(*) n FROM leads').n,1);assert.match(d.one('SELECT notes FROM leads').notes,/google\.com\/maps\/place\/A/);}finally{globalThis.fetch=original;}
});
test.after(()=>{d.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
