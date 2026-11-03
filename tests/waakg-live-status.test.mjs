import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'waakg-ui-status-'));
process.env.PROSPECTOR_DATA_DIR=tmp;
const {gatewayConnectionView,refreshGatewayConnection}=await import('../dashboard/waakg-live-status.mjs');
test('legacy Baileys state remains untouched when legacy transport selected',()=>{
 const legacy={status:'DISCONNECTED',user:null};
 assert.equal(gatewayConnectionView(legacy,{transport:'legacy'}),legacy);
});
test('dashboard reports actual connected WA-AKG state rather than disconnected legacy socket',async()=>{
 const legacy={status:'DISCONNECTED',qr:'legacy',user:null};
 await refreshGatewayConnection({read:async()=>({ok:true,connected:true,status:'CONNECTED'})});
 const current=gatewayConnectionView(legacy,{transport:'waakg'});
 assert.equal(current.status,'CONNECTED');
 assert.equal(current.connected,true);
 assert.equal(current.provider,'WA-AKG');
 assert.equal(current.qr,null);
 assert.equal(current.error,null);
});
test('provider check failures never claim connected; stale cache is not shown as online',async()=>{
 await refreshGatewayConnection({read:async()=>({ok:false,connected:false,status:'ERROR',message:'not responding'})});
 const current=gatewayConnectionView({status:'CONNECTED'},{transport:'waakg'});
 assert.equal(current.connected,false);
 assert.equal(current.status,'ERROR');
 assert.match(current.error,/not responding/);
 const stale=gatewayConnectionView({status:'DISCONNECTED'},{transport:'waakg',at:Date.now()+120000});
 assert.equal(stale.status,'VERIFYING');
 assert.equal(stale.connected,false);
});
test.after(async()=>{const {db}=await import('../dashboard/db.mjs');db.close();fs.rmSync(tmp,{recursive:true,force:true});});
