import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'consecom-private-restore-test-'));
const {parseTarArchive,restorePrivateCampaign}=await import('../dashboard/private-restore.mjs');
const {getSetting,setSetting}=await import('../dashboard/db.mjs');
function field(name,size){
 const h=Buffer.alloc(512);h.write(name,0,'utf8');
 h.write('0000644\0',100);
 h.write('0001750\0',108);
 h.write('0001750\0',116);
 h.write(size.toString(8).padStart(11,'0')+'\0',124);
 h[156]=48;
 h.write('ustar\0',257);
 return h;
}
function item(name,data){
 const b=Buffer.from(data);
 return Buffer.concat([field(name,b.length),b,Buffer.alloc((512-b.length%512)%512)]);
}
test('restores exact campaign payload from private plugin tar.gz structure',()=>{
 const zip=Buffer.alloc(1024);zip.writeUInt32LE(0x04034b50,0);
 const archive=gzipSync(Buffer.concat([item('plugin.json','{}'),item('assets/campaign.zip',zip),Buffer.alloc(1024)]));
 const retrieved=parseTarArchive(archive);
 assert.equal(retrieved.length,zip.length);
 assert.deepEqual(retrieved,zip);
});
test('a private plugin archive missing the specified asset cannot install a campaign',()=>{
 const archive=gzipSync(Buffer.concat([item('plugin.json','{}'),Buffer.alloc(1024)]));
 assert.throws(()=>parseTarArchive(archive),/assets\/campaign\.zip/);
});
test('media restore cannot run with operation active or without configured source',async()=>{
 const before=process.env.PROSPECTOR_MEDIA_RESTORE_URL;
 try{
  delete process.env.PROSPECTOR_MEDIA_RESTORE_URL;
  assert.equal((await restorePrivateCampaign()).state,'NOT_CONFIGURED');
  process.env.PROSPECTOR_MEDIA_RESTORE_URL='https://sdmntprwestus3.oaiusercontent.com/files/example/raw?sig=test';
  setSetting('paused',false);
  assert.equal((await restorePrivateCampaign()).state,'PAUSE_REQUIRED');
 }finally{
  if(before)process.env.PROSPECTOR_MEDIA_RESTORE_URL=before;
  else delete process.env.PROSPECTOR_MEDIA_RESTORE_URL;
  setSetting('paused',true);
 }
});
