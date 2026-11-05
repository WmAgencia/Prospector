import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-stock-'));
process.env.PROSPECTOR_DATA_DIR=dir;
delete process.env.PROSPECTOR_TENANT_ID;
const db=await import('../dashboard/db.mjs');
const {discoveryStockSnapshot,replenishmentPlan,identityKey}=await import('../dashboard/discovery-stock.mjs');
const number=i=>'55'+String(11900000000+i);
const add=(i,props={})=>db.addLead({business:'Empresa '+i,city:'Sorocaba',phone:number(i),source:'MANUAL',...props}).lead;

test('250-contact pool replenishes 200 when 50 unapproached leads remain from yesterday',()=>{
 for(let i=0;i<50;i++){
  const lead=add(i);
  db.run('UPDATE leads SET created_at=? WHERE id=?',new Date(Date.now()-36*3600_000).toISOString(),lead.id);
 }
 const stock=discoveryStockSnapshot();
 assert.equal(stock.target,250);
 assert.equal(stock.ready,50);
 assert.equal(stock.missing,200);
 for(let i=50;i<250;i++)add(i);
 const full=discoveryStockSnapshot();
 assert.equal(full.ready,250);
 assert.equal(full.missing,0);
 assert.equal(full.full,true);
});

test('dedup and suppression avoid counting repeated companies or blocked contacts',()=>{
 add(251,{business:'Empresa 2',phone:number(251)});
 assert.equal(discoveryStockSnapshot().ready,250,'company duplicate in same city is not a new slot');
 db.run('INSERT INTO suppressions(phone,reason,created_at) VALUES(?,?,?)',number(0),'opt_out',new Date().toISOString());
 const pending=discoveryStockSnapshot();
 assert.equal(pending.ready,249);
 assert.equal(pending.missing,1);
 assert.equal(pending.permissionNotImplied,true);
});

test('funded pool respects purchased credits and keeps customer credit accounting separate',()=>{
 assert.deepEqual(replenishmentPlan({ready:50,target:250,credits:100}),{
  target:250,ready:50,credits:100,fundedTarget:100,missing:50,full:false
 });
 assert.equal(replenishmentPlan({ready:50,target:250,credits:0}).missing,0);
 assert.equal(replenishmentPlan({ready:50,target:250,credits:null}).missing,200);
 assert.equal(replenishmentPlan({ready:0,target:1000,credits:null}).missing,250);
 assert.equal(identityKey({business:'OFICINA São José',city:'Sorocaba'}),identityKey({business:'Oficina Sao Jose',city:'SOROCABA'}));
});

test.after(()=>{
 db.db.close();
 fs.rmSync(dir,{recursive:true,force:true});
});
