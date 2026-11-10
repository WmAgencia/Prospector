import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/prospector-metrics-');
const db=await import('../dashboard/db.mjs');
const {aggregateOutreachDimensions,outreachDimensionSnapshot}=await import('../dashboard/overview-dimensions.mjs');

test('aggregates unique approached companies and confirmed conversions by city and niche',()=>{
 const result=aggregateOutreachDimensions([
  {id:'a',city:'Sorocaba',segment:'Oficina mecânica',stage:'INTERESTED',sale_status:'INTERESTED',approached:1},
  {id:'b',city:'Sorocaba',segment:'Oficina mecânica',stage:'CLOSED_WON',sale_status:'CLOSED_WON',approached:1},
  {id:'c',city:'Jundiaí',segment:'Buffet',stage:'DISCOVERED',sale_status:null,approached:0},
  {id:'d',city:'Jundiaí',segment:'Buffet',stage:'NO_INTEREST',sale_status:'NO_INTEREST',approached:1}
 ]);
 assert.deepEqual(result.totals,{approached:3,interested:2,converted:1,conversionRate:33.3});
 assert.deepEqual(result.cities.map(x=>[x.label,x.approached,x.interested,x.converted,x.conversionRate]),[
  ['Sorocaba',2,2,1,50],['Jundiaí',1,0,0,0]
 ]);
 assert.equal(result.niches.find(x=>x.label==='Oficina mecânica').converted,1);
});
test('persisted metrics never count contacts without an actual sent message',()=>{
 const a=db.addLead({business:'Oficina Um',phone:'15933330111',city:'Sorocaba',segment:'oficina mecânica',source:'MANUAL'}).lead;
 const b=db.addLead({business:'Oficina Dois',phone:'15933330112',city:'Sorocaba',segment:'oficina mecânica',source:'MANUAL'}).lead;
 const initial=outreachDimensionSnapshot();
 assert.equal(initial.totals.approached,0);
 db.run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',a.id,a.phone,'SENT',db.id(),db.now());
 db.run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',b.id,b.phone,'UNKNOWN',db.id(),db.now());
 const result=outreachDimensionSnapshot();
 assert.equal(result.totals.approached,1);
 assert.equal(result.cities[0].label,'Sorocaba');
 assert.equal(result.cities[0].approached,1);
});
