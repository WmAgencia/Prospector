import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
const docker=readFileSync(new URL('../mysql-recovery/Dockerfile',import.meta.url),'utf8');
const entrypoint=fileURLToPath(new URL('../mysql-recovery/inspect-entrypoint.sh',import.meta.url));
const shell=readFileSync(entrypoint,'utf8');
test('recovery keeps the same MySQL 8 major image and official entrypoint, with binlogs off',()=>{
 assert.match(docker,/FROM mysql:8\.0/);
 assert.match(shell,/exec docker-entrypoint\.sh mysqld --skip-log-bin/);
 assert.doesNotMatch(shell,/\bDROP\s+TABLE\b|\bDELETE\s+FROM\b|\bTRUNCATE\s+TABLE\b|\brm\s+-rf\s+\/var\/lib\/mysql/i);
 assert.match(shell,/MYSQL_RECOVERY_ARCHIVE_OLD_BINLOGS/);
 assert.match(shell,/gzip -t/);
});
test('archiving old binlogs preserves exact content in validated gzip and retains newest binlog',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mysql-archive-test-'));
 try{
  const oldest=Buffer.alloc(150000,0x41),middle=Buffer.alloc(225000,0x42),latest=Buffer.from('latest binary log intact');
  writeFileSync(join(dir,'binlog.000001'),oldest);
  writeFileSync(join(dir,'binlog.000002'),middle);
  writeFileSync(join(dir,'binlog.000003'),latest);
  writeFileSync(join(dir,'binlog.index'),'./binlog.000001\n./binlog.000002\n./binlog.000003\n');
  const out=spawnSync('sh',[entrypoint],{env:{...process.env,MYSQL_RECOVERY_DATA_DIR:dir,MYSQL_RECOVERY_ARCHIVE_OLD_BINLOGS:'1',MYSQL_RECOVERY_TEST_ONLY:'1'},encoding:'utf8',timeout:10000});
  assert.equal(out.status,0,out.stderr+'\n'+out.stdout);
  assert.equal(existsSync(join(dir,'binlog.000001')),false);
  assert.equal(existsSync(join(dir,'binlog.000002')),false);
  assert.deepEqual(gunzipSync(readFileSync(join(dir,'binlog.000001.gz'))),oldest);
  assert.deepEqual(gunzipSync(readFileSync(join(dir,'binlog.000002.gz'))),middle);
  assert.deepEqual(readFileSync(join(dir,'binlog.000003')),latest);
  assert.equal(readFileSync(join(dir,'binlog.index'),'utf8'),'./binlog.000003\n');
  const again=spawnSync('sh',[entrypoint],{env:{...process.env,MYSQL_RECOVERY_DATA_DIR:dir,MYSQL_RECOVERY_ARCHIVE_OLD_BINLOGS:'1',MYSQL_RECOVERY_TEST_ONLY:'1'},encoding:'utf8',timeout:10000});
  assert.equal(again.status,0,again.stderr+'\n'+again.stdout);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('unexpected newer binlogs or index entries leave all recovery data intact',()=>{
 for(const newerIndexed of [false,true]){
  const dir=mkdtempSync(join(tmpdir(),'mysql-newer-log-test-'));
  try{
   for(let i=1;i<=4;i++)writeFileSync(join(dir,'binlog.00000'+i),Buffer.alloc(150000,i));
   const index='./binlog.000001\n./binlog.000002\n./binlog.000003\n'+(newerIndexed?'./binlog.000004\n':'');
   writeFileSync(join(dir,'binlog.index'),index);
   const out=spawnSync('sh',[entrypoint],{env:{...process.env,MYSQL_RECOVERY_DATA_DIR:dir,MYSQL_RECOVERY_ARCHIVE_OLD_BINLOGS:'1',MYSQL_RECOVERY_TEST_ONLY:'1'},encoding:'utf8',timeout:10000});
   assert.equal(out.status,0,out.error?.message||out.stderr+'\n'+out.stdout);
   for(let i=1;i<=4;i++)assert.deepEqual(readFileSync(join(dir,'binlog.00000'+i)),Buffer.alloc(150000,i));
   assert.equal(readFileSync(join(dir,'binlog.index'),'utf8'),index);
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
});
