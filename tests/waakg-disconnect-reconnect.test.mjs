import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-wa-logout-'));
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.WA_AKG_API_KEY='test-local-only-not-a-real-key';
process.env.WA_AKG_SESSION_ID='consecom-principal';
delete process.env.WA_AKG_WEBHOOK_SECRET;
const db=await import('../dashboard/db.mjs');
const {waControlStatus,waDisconnect,waConnect,waGetQR}=await import('../dashboard/waakg-control.mjs');
const oldFetch=globalThis.fetch;
let status='CONNECTED',hasInstance=true,me={id:'5515999999999:0@s.whatsapp.net'},calls=[];
function reply(data,http=200){return new Response(JSON.stringify(data),{status:http,headers:{'Content-Type':'application/json'}});}
globalThis.fetch=async (url,opts={})=>{
 const u=new URL(url);const method=opts.method||'GET';
 calls.push(method+' '+u.pathname);
 if(u.pathname==='/api/sessions'&&method==='GET')return reply({status:true,data:[{sessionId:'consecom-principal',status}]});
 if(u.pathname==='/api/sessions/consecom-principal'&&method==='GET')return reply({status:true,data:{sessionId:'consecom-principal',status,hasInstance,me}});
 if(u.pathname==='/api/sessions/consecom-principal/logout'&&method==='POST'){
  status='LOGGED_OUT';hasInstance=false;me=null;
  return reply({status:true});
 }
 if(u.pathname==='/api/sessions/consecom-principal/start'&&method==='POST'){
  status='SCAN_QR';hasInstance=true;me=null;return reply({status:true});
 }
 if(u.pathname==='/api/sessions/consecom-principal/restart'&&method==='POST'){
  status='SCAN_QR';hasInstance=true;me=null;return reply({status:true});
 }
 if(u.pathname==='/api/sessions/consecom-principal/qr'&&method==='GET')return reply({success:true,base64:'data:image/png;base64,aGVsbG8='});
 throw Error('Unexpected fake gateway endpoint '+method+' '+u.pathname);
};
test('Connected session is recognized only with a live instance and authenticated user',async()=>{
 const st=await waControlStatus();
 assert.equal(st.connected,true);
 assert.equal(st.status,'CONNECTED');
 hasInstance=false;me=null;
 const stale=await waControlStatus();
 assert.equal(stale.connected,false);
 assert.equal(stale.transportStale,true);
 assert.equal(stale.status,'DISCONNECTED');
 const out=await waConnect();
 assert.equal(out.ok,true);
 assert.ok(calls.includes('POST /api/sessions/consecom-principal/restart'));
 assert.equal((await waControlStatus()).status,'SCAN_QR');
});
test('Disconnect performs true logout, confirms read-back and pauses outbound sending',async()=>{
 status='CONNECTED';hasInstance=true;me={id:'5515999999999:0@s.whatsapp.net'};
 db.setSetting('paused',false);
 const out=await waDisconnect();
 assert.equal(out.verified,true);
 assert.equal(out.connected,false);
 assert.equal(out.reconnectRequiresQr,true);
 assert.equal((await waControlStatus()).status,'LOGGED_OUT');
 assert.equal(db.getSetting('paused'),true);
 assert.ok(calls.includes('POST /api/sessions/consecom-principal/logout'));
 assert.ok(!calls.includes('POST /api/sessions/consecom-principal/stop'));
});
test('Reconnect starts new session and returns the actual gateway QR',async()=>{
 const out=await waConnect();
 assert.equal(out.ok,true);
 assert.ok(calls.includes('POST /api/sessions/consecom-principal/start'));
 const qr=await waGetQR();
 assert.equal(qr.connected,false);
 assert.equal(qr.qr,'data:image/png;base64,aGVsbG8=');
});
test.after(()=>{globalThis.fetch=oldFetch;db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
