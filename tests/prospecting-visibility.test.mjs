import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/prospector-view-once-');
process.env.PROSPECTOR_DATA_DIR=dir;
const db=await import('../dashboard/db.mjs');
const {listUnseenCompanies}=await import('../dashboard/prospecting-visibility.mjs');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
function add(name,number){return db.addLead({business:name,phone:number,city:'Sorocaba',segment:'oficina mecânica',source:'MANUAL'}).lead;}
test('A company displayed once is hidden in every new search session, even when never contacted',()=>{
 add('Oficina Exemplo Alpha','15977771111');
 const first=listUnseenCompanies({session:A,niche:'oficina mecânica',city:'Sorocaba'});
 assert.equal(first.results.length,1);
 assert.equal(first.results[0].business,'Oficina Exemplo Alpha');
 assert.equal(first.results[0].contacted,false);
 assert.equal(listUnseenCompanies({session:A,niche:'oficina mecânica',city:'Sorocaba'}).results.length,1,'reload in same session keeps list visible');
 assert.equal(listUnseenCompanies({session:B,niche:'oficina mecânica',city:'Sorocaba'}).results.length,0,'subsequent query never repeats company');
 assert.ok(db.one('SELECT COUNT(*) n FROM prospecting_viewed_keys').n>=2);
});
test('New duplicate record with same company and city is suppressed despite different telephone',()=>{
 add('OFICINA EXEMPLO ÁLPHA','15977772222');
 assert.equal(listUnseenCompanies({session:B,niche:'oficina mecânica',city:'Sorocaba'}).results.length,0);
});
test('New businesses appear once; duplicates in the same search are not repeated',()=>{
 add('Beta Auto Centro','15977773333');
 add('Beta Auto Centro','15977774444');
 const out=listUnseenCompanies({session:B,niche:'',city:'Sorocaba'});
 assert.equal(out.results.length,1);
 assert.equal(out.results[0].business,'Beta Auto Centro');
 assert.equal(listUnseenCompanies({session:A,niche:'',city:'Sorocaba'}).results.length,0);
});
test.after(()=>{db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
