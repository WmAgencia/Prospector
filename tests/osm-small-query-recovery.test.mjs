import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-osm-bbox-'));
process.env.PROSPECTOR_DATA_DIR=dir;
const {discoverLocal}=await import('../dashboard/osm-discovery.mjs');
const {prospectingList}=await import('../dashboard/prospecting-search.mjs');
const db=await import('../dashboard/db.mjs');
test('A public Overpass 504 falls back to one independent provider with small bbox and saves actionable contacts',async()=>{
 const original=globalThis.fetch;const requests=[];
 globalThis.fetch=async(url,options)=>{
  requests.push({url,query:new URLSearchParams(options.body).get('data')});
  if(requests.length===1)return new Response('server busy',{status:504});
  return Response.json({elements:[
   {type:'node',id:9010111,tags:{name:'Oficina com contato',shop:'car_repair','contact:mobile':'+55 (15) 98888-3322'}},
   {type:'way',id:9010112,tags:{name:'Oficina sem telefone',shop:'car_repair'}}
  ]});
 };
 try{
  db.setSetting('paused',true);db.setSetting('auto_initial',false);
  const result=await discoverLocal({city:'Sorocaba',segment:'oficina'},true);
  assert.equal(result.added,2);
  assert.equal(result.withPhone,1);
  assert.equal(requests.length,2);
  assert.notEqual(new URL(requests[0].url).host,new URL(requests[1].url).host);
  assert.match(requests[0].query,/\[timeout:14\]/);
  assert.match(requests[0].query,/nwr\["shop"="car_repair"\]\["name"\]\(-/);
  assert(!requests[0].query.includes('around:'));
  const ready=prospectingList({niche:'oficina mecânica',city:'Sorocaba'});
  assert.equal(ready.total,2);
  assert.equal(ready.actionable,1);
  assert.equal(ready.missingPhone,1);
  assert.equal(ready.results[0].business,'Oficina com contato');
  assert.equal(ready.results[0].selectable,true);
  assert.equal(ready.results[1].selectable,false);
  assert.equal(db.getSetting('paused'),true);
  assert.equal(db.one('SELECT COUNT(*) n FROM messages').n,0);
  assert.equal(db.one('SELECT COUNT(*) n FROM initial_contacts').n,0);
  assert.equal(db.one('SELECT COUNT(*) n FROM leads WHERE contact_permission=1').n,0);
 }finally{globalThis.fetch=original;}
});
test('Overpass 429 respects provider backoff; never bypasses limit by switching host',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('limit',{status:429});};
 try{
  await assert.rejects(discoverLocal({city:'Sorocaba',segment:'restaurante'},true),/HTTP 429/);
  assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
test.after(()=>{db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
