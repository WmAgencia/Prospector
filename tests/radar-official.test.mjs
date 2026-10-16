import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const testDataDir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-isolated-'));
process.env.PROSPECTOR_DATA_DIR=testDataDir;

const {daySP,initialBudget,MAX_APPROACHES,TARGET_INTERVAL_SECONDS}=await import('../dashboard/radar.mjs');
const {parseCSV}=await import('../dashboard/official-import.mjs');
const {safePublicWebsite}=await import('../dashboard/site-audit.mjs');
test('pacing target 200 in six hours and quota exact',()=>{
 assert.equal(MAX_APPROACHES,150);assert.equal(TARGET_INTERVAL_SECONDS,240);
 assert.equal(150*TARGET_INTERVAL_SECONDS,10*3600);
 const events=[{updated_at:'2026-10-15T15:00:00.000Z',status:'SENT'},{updated_at:'2026-10-15T15:04:00.000Z',status:'UNKNOWN'}];
 const config={limit:150,start:8,end:18,intervalSeconds:240};
 const quota=initialBudget(new Date('2026-10-15T15:05:00.000Z'),events,config);
 assert.equal(quota.confirmed,1);assert.equal(quota.uncertain,1);assert.equal(quota.counted,2);assert.equal(quota.remaining,148);
 assert.equal(quota.nextAt,'2026-10-15T15:08:00.000Z');
 assert.equal(daySP(new Date('2026-10-16T01:00:00.000Z')),'2026-10-15');
});
test('CSV official import handles separators and quoted names',()=>{
 const r=parseCSV('cnpj;nome_fantasia;municipio\n12345678000199;"Clínica; Bem Viver";Sorocaba\n');
 assert.equal(r.length,1);assert.equal(r[0].nome_fantasia,'Clínica; Bem Viver');
 assert.throws(()=>parseCSV('cnpj,cnpj\n1,2\n'),/duplicado/);
});
test('site audit refuses private and file schemes',()=>{
 assert.equal(safePublicWebsite('https://example.com/'),'https://example.com/');
 assert.throws(()=>safePublicWebsite('http://localhost:8080/'),/público|privado/);
 assert.throws(()=>safePublicWebsite('file:///etc/passwd'),/público/);
});

test.after(async()=>{const {db}=await import('../dashboard/db.mjs');db.close();fs.rmSync(testDataDir,{recursive:true,force:true});});
