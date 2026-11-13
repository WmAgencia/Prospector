// Recovery primitives for offline audits and isolated restore drills.
// No startup hooks, no automatic copies of production PII, no in-place restores.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';

const goodName=name=>/^[a-zA-Z0-9_-]{1,90}\.sqlite$/.test(name);
export function checkSQLiteSnapshot(file){
 if(!fs.existsSync(file))throw Error('BACKUP_SOURCE_NOT_FOUND');
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  const integrity=db.prepare('PRAGMA quick_check(1)').get();
  const result=Object.values(integrity||{})[0];
  if(result!=='ok')throw Error('BACKUP_INTEGRITY_FAILED');
  return {integrity:'ok',bytes:fs.statSync(file).size};
 }finally{db.close()}
}
export async function snapshotSQLite(source,destination){
 const sourceAbs=path.resolve(source),targetAbs=path.resolve(destination);
 if(!goodName(path.basename(sourceAbs))||!goodName(path.basename(targetAbs))||sourceAbs===targetAbs)
  throw Error('INVALID_BACKUP_PATH');
 if(!fs.existsSync(sourceAbs))throw Error('BACKUP_SOURCE_NOT_FOUND');
 fs.mkdirSync(path.dirname(targetAbs),{recursive:true,mode:0o700});
 if(fs.existsSync(targetAbs))throw Error('BACKUP_ALREADY_EXISTS');
 const temp=targetAbs+'.partial';
 let sourceDb;
 try{
  sourceDb=new DatabaseSync(sourceAbs,{readOnly:true});
  await backup(sourceDb,temp);
  sourceDb.close();sourceDb=null;
  fs.chmodSync(temp,0o600);
  const checked=checkSQLiteSnapshot(temp);
  fs.renameSync(temp,targetAbs);
  return checked;
 }catch(err){try{fs.rmSync(temp,{force:true})}catch{};throw err}
 finally{try{sourceDb?.close()}catch{}}
}
export async function restoreSQLiteToSandbox(sourceSnapshot,stagingDir){
 const source=path.resolve(sourceSnapshot),targetDirectory=path.resolve(stagingDir);
 if(!goodName(path.basename(source))||!fs.existsSync(source))throw Error('INVALID_BACKUP_SOURCE');
 const dest=path.join(targetDirectory,path.basename(source));
 if(fs.existsSync(dest))throw Error('REFUSE_TO_OVERWRITE_RESTORE_TARGET');
 await snapshotSQLite(source,dest);
 return {path:dest,...checkSQLiteSnapshot(dest),mode:'STAGING_ONLY'};
}
