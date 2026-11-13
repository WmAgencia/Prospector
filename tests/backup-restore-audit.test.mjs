import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {snapshotSQLite,restoreSQLiteToSandbox,checkSQLiteSnapshot} from '../dashboard/sqlite-backup-verify.mjs';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-safe-backup-test-'));
test.after(()=>fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
function fixture(name){
 const dest=path.join(temp,'working',name+'.sqlite');
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 const db=new DatabaseSync(dest);
 db.exec('PRAGMA journal_mode=WAL; CREATE TABLE simulated_clients(id INTEGER PRIMARY KEY,label TEXT);');
 for(let i=1;i<=30;i++)db.prepare('INSERT INTO simulated_clients VALUES(?,?)').run(i,'company-'+i);
 db.close();return dest;
}
test('online SQLite backup includes WAL transactions, integrity checks, and restores to sandbox',async()=>{
 const source=fixture('platform');
 const snap=path.join(temp,'snapshots','platform.sqlite');
 const outcome=await snapshotSQLite(source,snap);
 assert.equal(outcome.integrity,'ok');
 assert.equal(checkSQLiteSnapshot(snap).integrity,'ok');
 let db=new DatabaseSync(source);
 db.prepare('INSERT INTO simulated_clients VALUES(?,?)').run(31,'created-after-backup');
 db.close();
 const restored=await restoreSQLiteToSandbox(snap,path.join(temp,'restored'));
 assert.equal(restored.mode,'STAGING_ONLY');
 db=new DatabaseSync(restored.path,{readOnly:true});
 assert.equal(db.prepare('SELECT COUNT(*) n FROM simulated_clients').get().n,30,
  'restore must represent the snapshot before later mutations');
 assert.equal(db.prepare('PRAGMA quick_check(1)').get().quick_check,'ok');
 db.close();
 const production=new DatabaseSync(source,{readOnly:true});
 assert.equal(production.prepare('SELECT COUNT(*) n FROM simulated_clients').get().n,31,
  'drill must never overwrite production/source database');
 production.close();
});
test('two company databases are backed up and restored separately',async()=>{
 for(const name of ['external-client-a','external-client-b']){
  const original=fixture(name);
  const snapshot=path.join(temp,'snapshots',name+'.sqlite');
  await snapshotSQLite(original,snapshot);
  const restored=await restoreSQLiteToSandbox(snapshot,path.join(temp,'restored'));
  assert.equal(restored.integrity,'ok');
 }
 assert.equal(fs.readdirSync(path.join(temp,'restored')).filter(name=>name.endsWith('.sqlite')).length,3);
});
test('refuse overwrites, missing paths and corrupted SQLite snapshots',async()=>{
 const source=fixture('refuse');
 await assert.rejects(snapshotSQLite(source,source),/INVALID_BACKUP_PATH/);
 await assert.rejects(snapshotSQLite(source,path.join(temp,'snapshots','platform.sqlite')),/BACKUP_ALREADY_EXISTS/);
 await assert.rejects(snapshotSQLite(path.join(temp,'working','nonexistent.sqlite'),
  path.join(temp,'snapshots','nothing.sqlite')),/BACKUP_SOURCE_NOT_FOUND/);
 const corrupt=path.join(temp,'snapshots','corrupt.sqlite');
 fs.writeFileSync(corrupt,Buffer.alloc(100,255));
 assert.throws(()=>checkSQLiteSnapshot(corrupt));
});
