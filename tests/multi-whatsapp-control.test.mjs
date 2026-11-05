import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/multi-control-');
process.env.WA_AKG_SESSION_ID='main-session';process.env.WA_AKG_API_KEY='mock';
process.env.WA_AKG_WEBHOOK_SECRET='x'.repeat(40);
const d=await import('../dashboard/db.mjs');
const registry=await import('../dashboard/waakg-session-registry.mjs');
const control=await import('../dashboard/waakg-control.mjs');
const original=globalThis.fetch,rows=new Map([['main-session',{sessionId:'main-session',status:'CONNECTED'}]]),calls=[];
globalThis.fetch=async(url,options={})=>{
 const path=new URL(url).pathname,method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
 calls.push({path,method,body});
 let data;
 if(path==='/api/sessions'&&method==='POST'){data={sessionId:body.sessionId,status:'STOPPED'};rows.set(data.sessionId,data);}
 else if(path==='/api/sessions')data=[...rows.values()];
 else if(path.startsWith('/api/webhooks/'))data=[];
 else{
  const parts=path.split('/'),sid=parts[3],row=rows.get(sid),action=parts[4];
  assert.ok(row,'only created sessions may be accessed');
  if(action==='bot-config'){data=body;assert.equal(body.botMode,'SPECIFIC');assert.deepEqual(body.botAllowedJids,[]);assert.equal(body.autoReplyMode,'SPECIFIC');assert.deepEqual(body.autoReplyAllowedJids,[]);}
  else if(action==='start'){assert.ok(calls.some(c=>c.path==='/api/sessions/'+sid+'/bot-config'));row.status='SCAN_QR';data=row;}
  else if(action==='logout'){row.status='LOGGED_OUT';data=row;}
  else if(action==='qr')return Response.json({status:true,base64:'data:image/png;base64,AAAA'});
  else data={...row,hasInstance:row.status==='CONNECTED',me:row.status==='CONNECTED'?{id:'5511900000001@s.whatsapp.net'}:null};
 }
 return Response.json({status:true,data});
};
test('additional accounts get independent sessions, webhook and QR with gateway autoresponder disabled',async()=>{
 const a=await control.waCreateSession('Comercial 2'),b=await control.waCreateSession('Comercial 3');
 assert.notEqual(a.sessionId,b.sessionId);
 assert.equal(registry.managedSessions().length,3);
 assert.equal(control.selectedWaSession(),'main-session');
 for(const item of [a,b]){
  assert.ok((await control.waGetQR(item.sessionId)).qr);
  assert.ok(calls.some(c=>c.path==='/api/webhooks/'+item.sessionId&&c.method==='POST'));
 }
 d.setSetting('paused',false);rows.get(b.sessionId).status='CONNECTED';
 const disconnected=await control.waDisconnect(a.sessionId);
 assert.equal(disconnected.verified,true);
 assert.equal(d.getSetting('paused'),false);
 assert.equal((await control.waControlStatus(b.sessionId)).connected,true);
 assert.equal((await control.waOperationalStatus()).connected,true);
});
test.after(()=>{globalThis.fetch=original;d.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
