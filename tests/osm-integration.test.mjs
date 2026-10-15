import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-osm-test-'));
process.env.PROSPECTOR_DATA_DIR=temp;
const {discoverLocal}=await import('../dashboard/osm-discovery.mjs');
const {one}=await import('../dashboard/db.mjs');
test('descoberta sem API paga salva e deduplica negócios reais do provedor mockado',async()=>{
 const original=globalThis.fetch;
 const mock={elements:[{type:'node',id:779966221,tags:{name:'Empresa Exemplo de Teste',shop:'beauty',phone:'+55 15 99888-7766'}}]};
 globalThis.fetch=async()=>new Response(JSON.stringify(mock),{status:200,headers:{'content-type':'application/json'}});
 try{
  const r=await discoverLocal({city:'Sorocaba',segment:'estetica'});
  assert.equal(r.added,1);assert.equal(r.examined,1);
  const lead=one('SELECT * FROM leads WHERE business=?','Empresa Exemplo de Teste');
  assert.ok(lead);
  assert.equal(lead.contact_permission,0);
  assert.equal(lead.website_status,'UNCERTAIN');
  assert.equal(lead.phone,'5515998887766');
  const cached=await discoverLocal({city:'Sorocaba',segment:'estetica'});
  assert.equal(cached.cached,true);assert.equal(cached.examined,1);
  assert.equal(one("SELECT COUNT(*) as c FROM leads")?.c,1);
 }finally{globalThis.fetch=original;}
});
