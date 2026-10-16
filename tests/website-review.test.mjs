import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const testDataDir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-isolated-'));
process.env.PROSPECTOR_DATA_DIR=testDataDir;

const {evidence}=await import('../dashboard/website-review.mjs');
const old={website_status:'UNCERTAIN',website:''};
test('no website is never assumed from absence of URL',()=>{
 assert.equal(evidence({},old),null);
 assert.throws(()=>evidence({website_status:'NO_WEBSITE'},old),/fontes consultadas/);
 assert.throws(()=>evidence({website_status:'NO_WEBSITE',site_reviewed:true,site_review_sources:'OPENSTREETMAP',site_review_note:'Nenhum domínio encontrado em fonte local.'},old),/fontes consultadas/);
 const x=evidence({website_status:'NO_WEBSITE',site_reviewed:true,site_review_sources:'OPENSTREETMAP,GOOGLE',site_review_note:'Não foi encontrado domínio vinculado ao negócio pesquisado.'},old);
 assert.deepEqual(x.sources,['OPENSTREETMAP','GOOGLE']);
 assert.equal(x.confidence,'MODERADA');
});
test('positive site confirmation requires URL and review',()=>{
 assert.throws(()=>evidence({website_status:'HAS_WEBSITE',site_reviewed:true,site_review_sources:'GOOGLE',site_review_note:'Empresa de teste cruzada por nome e cidade.'},old),/URL/);
 assert.equal(evidence({website_status:'HAS_WEBSITE',website:'https://empresa.com.br',site_reviewed:true,site_review_sources:'GOOGLE',site_review_note:'Nome e endereço coincidem com o domínio consultado.'},old).status,'HAS_WEBSITE');
});

test.after(async()=>{const {db}=await import('../dashboard/db.mjs');db.close();fs.rmSync(testDataDir,{recursive:true,force:true});});
