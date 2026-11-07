import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-decisor-'));
process.env.PROSPECTOR_DATA_DIR=dataDir;
const {addLead,one}=await import('../dashboard/db.mjs');
const {recordOrigin}=await import('../dashboard/discovery.mjs');
const {validCnpj,enrichDecisorLead}=await import('../dashboard/decisor-enrichment.mjs');

test('CNPJ checksum rejects invalid or placeholder strings',()=>{
 assert.equal(validCnpj('00.000.000/0001-91'),true);
 assert.equal(validCnpj('00.000.000/0001-92'),false);
 assert.equal(validCnpj('11111111111111'),false);
 assert.equal(validCnpj(''),false);
});

test('verified QSA enriches person name without overwriting business WhatsApp',async()=>{
 const saved=addLead({business:'BANCO DO BRASIL SA',city:'Brasilia',phone:'61999999999',source:'cnpj',official_id:'cnpj:00000000000191',contact_permission:false});
 recordOrigin(saved.lead.id,'cnpj',{identity:'cnpj:00000000000191',reference:'00000000000191'});
 const originalPhone=one('SELECT phone FROM leads WHERE id=?',saved.lead.id).phone;
 let calls=0;
 const fetchImpl=async()=>{calls++;return {status:200,ok:true,json:async()=>({success:true,data:{
  cnpj:'00000000000191',razaoSocial:'BANCO DO BRASIL SA',municipio:'BRASILIA',telefone:'6134939002',
  socios:[{nomeSocio:'PESSOA DE TESTE',descricao:'Presidente'}]
 }})};};
 const outcome=await enrichDecisorLead(saved.lead.id,{fetchImpl});
 assert.equal(outcome.status,'ENRICHED');
 assert.equal(calls,1);
 const item=one('SELECT * FROM lead_decisor_enrichment WHERE lead_id=?',saved.lead.id);
 assert.equal(item.decision_maker,'PESSOA DE TESTE');
 assert.equal(item.provider,'opencnpj');
 assert.equal(one('SELECT phone FROM leads WHERE id=?',saved.lead.id).phone,originalPhone);
});

test('provider fallback uses Minha Receita and rejects a wrong-company identity',async()=>{
 const saved=addLead({business:'EMPRESA DE TESTE',city:'Sorocaba',source:'cnpj',official_id:'cnpj:00000000000191',contact_permission:false});
 recordOrigin(saved.lead.id,'cnpj',{identity:'cnpj:00000000000191',reference:'00000000000191'});
 let calls=0;
 const fetchImpl=async(url)=>{
  calls++;
  if(url.includes('kitana'))throw new Error('provider unavailable');
  return {status:200,ok:true,json:async()=>({cnpj:'00000000000191',razao_social:'EMPRESA DIFERENTE',municipio:'Sorocaba',qsa:[]})};
 };
 const outcome=await enrichDecisorLead(saved.lead.id,{fetchImpl});
 assert.equal(calls,2);
 assert.equal(outcome.status,'RETRY');
 assert.equal(one('SELECT decision_maker FROM lead_decisor_enrichment WHERE lead_id=?',saved.lead.id).decision_maker,null);
});

test.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
