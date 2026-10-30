import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/prospector-list-complete-');
const d=await import('../dashboard/db.mjs');
const {listUnseenCompanies}=await import('../dashboard/prospecting-visibility.mjs');
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
test('viewing a public business does not remove it from the next search before contact',()=>{
 const l=d.addLead({business:'Empresa sem abordagem',phone:'5515991230001',city:'Sorocaba',segment:'Oficina'}).lead;
 assert.ok(listUnseenCompanies({session:a,city:'Sorocaba'}).results.some(x=>x.id===l.id));
 assert.ok(listUnseenCompanies({session:b,city:'Sorocaba'}).results.some(x=>x.id===l.id));
 assert.equal(d.one('SELECT contact_permission FROM leads WHERE id=?',l.id).contact_permission,0);
});
test('the displayed list supports more than 500 eligible results without hiding later selections',()=>{
 for(let i=0;i<750;i++)d.addLead({business:'Empresa '+i,phone:String(5515910000000+i),city:'Campinas',segment:'Oficina'});
 const list=listUnseenCompanies({session:a,city:'Campinas',limit:1000});
 assert.equal(list.returned,750);assert.equal(list.results.length,750);
});
test.after(()=>{d.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
