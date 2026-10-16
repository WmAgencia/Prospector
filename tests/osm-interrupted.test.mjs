import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/osm-interrupted-');
const db=await import('../dashboard/db.mjs');
const {reconcileInterruptedSearches}=await import('../dashboard/osm-discovery.mjs');
const t=new Date();
const oldId=db.id(),recentId=db.id(),oldAt=new Date(t.getTime()-10*60000).toISOString();
for(const [id,at] of [[oldId,oldAt],[recentId,t.toISOString()]])
 db.run('INSERT INTO discoveries(id,query,found,at,status,details) VALUES(?,?,?,?,?,?)',id,'osm:sorocaba:healthcare:psychotherapist',0,at,'RUNNING','{"automatic":true}');
test('interrupted queries are finalized without deleting or repeating an attempt',()=>{
 const r=reconcileInterruptedSearches({at:t});
 assert.equal(r.recovered,1);
 assert.equal(db.one('SELECT status FROM discoveries WHERE id=?',oldId).status,'INTERRUPTED');
 assert.equal(db.one('SELECT status FROM discoveries WHERE id=?',recentId).status,'RUNNING');
 assert.equal(db.one("SELECT COUNT(*) AS n FROM discoveries WHERE query LIKE 'osm:%'").n,2);
 assert.equal(JSON.parse(db.one('SELECT details FROM discoveries WHERE id=?',oldId).details).interrupted,true);
 assert.equal(reconcileInterruptedSearches({at:t}).recovered,0);
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
