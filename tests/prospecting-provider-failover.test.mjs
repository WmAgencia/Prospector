import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/prospector-overpass-');
process.env.PROSPECTOR_DATA_DIR=dir;
const db=await import('../dashboard/db.mjs');
const {remoteQuery}=await import('../dashboard/prospecting-search.mjs');
const original=globalThis.fetch;

test('OSM search falls back to an independent provider after timeout',async()=>{
 const targets=[];
 globalThis.fetch=async(url,options)=>{
  targets.push(url);
  assert.equal(options.method,'POST');
  if(targets.length===1)throw new DOMException('upstream timeout','TimeoutError');
  return Response.json({elements:[{type:'node',id:123,tags:{name:'Empresa Teste'}}]});
 };
 try{
  const result=await remoteQuery('[out:json];node(1);out;');
  assert.equal(result.elements[0].tags.name,'Empresa Teste');
  assert.deepEqual(targets,['https://overpass.private.coffee/api/interpreter','https://overpass-api.de/api/interpreter']);
 }finally{globalThis.fetch=original;}
});
test('Provider rate limit is respected without immediate retry elsewhere',async()=>{
 let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('rate limited',{status:429});};
 try{
  await assert.rejects(remoteQuery('[out:json];node(1);out;'),/HTTP 429/);
  assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
test.after(()=>{globalThis.fetch=original;db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
