import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';

test('client portfolio upload, private media and overview contract',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-tenant-media-'));
 const socket=net.createServer();
 await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
 const port=socket.address().port;
 await new Promise(resolve=>socket.close(resolve));
 const env={...process.env,PORT:String(port),PROSPECTOR_DATA_DIR:dir,WHATSAPP_TRANSPORT:'waakg',
  NODE_ENV:'test',PROSPECTOR_TENANT_ID:'',WA_AKG_SESSION_ID:'',GROQ_API_KEY:'',
  WA_AKG_API_KEY:'',WA_AKG_ADMIN_EMAIL:'',WA_AKG_ADMIN_PASSWORD:'',
  ADMIN_SESSION_SECRET:'local-isolation-tests-not-production'};
 for(const key of Object.keys(env))if(key.startsWith('RUN_')||key.includes('DEMO')||key.includes('VERIFY'))delete env[key];
 const child=spawn(process.execPath,['dashboard/server.mjs'],{env,stdio:'ignore',windowsHide:true});
 t.after(async()=>{
  if(child.exitCode===null)child.kill('SIGTERM');
  await new Promise(resolve=>setTimeout(resolve,200));
  fs.rmSync(dir,{recursive:true,force:true,maxRetries:30,retryDelay:100});
 });
 const base='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<120;i++){
  try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.equal(ready,true,'isolated backend starts');
 const post=async(url,body,cookie)=>{
  const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  return {status:r.status,value:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
 };
 const customerA=(await post('/api/platform/clients',{name:'Oficina Teste A',email:'a@example.test'})).value;
 const customerB=(await post('/api/platform/clients',{name:'Clínica Teste B',email:'b@example.test'})).value;
 assert.ok(customerA.token&&customerB.token);
 const cookieA=(await post('/api/platform/login',{token:customerA.token})).cookie;
 const cookieB=(await post('/api/platform/login',{token:customerB.token})).cookie;
 assert.ok(cookieA&&cookieB);
 const call=async(url,{method='GET',cookie,body,mime}={})=>fetch(base+url,{method,headers:{
  ...(cookie?{Cookie:cookie}:{}),...(mime?{'Content-Type':mime}:{})},body});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/D9kAAAAASUVORK5CYII=','base64');
 const pdf=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');

 await t.test('company A can upload JPG/PNG and PDF, and retrieve only its own files',async()=>{
  const image=await call('/api/media?kind=image&name=Oficina',{method:'POST',cookie:cookieA,mime:'image/png',body:png});
  assert.equal(image.status,201,'PNG portfolio upload must be available to the client');
  const imageDoc=await image.json();assert.ok(imageDoc.id);
  const pdfUpload=await call('/api/media?kind=document&name=Apresentacao',{method:'POST',cookie:cookieA,mime:'application/pdf',body:pdf});
  assert.equal(pdfUpload.status,201,'PDF portfolio upload must be available to the client');
  const pdfDoc=await pdfUpload.json();assert.ok(pdfDoc.id);
  const ownImage=await call('/api/media/'+imageDoc.id,{cookie:cookieA});
  assert.equal(ownImage.status,200);assert.equal(ownImage.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await ownImage.arrayBuffer()),png);
  const ownPdf=await call('/api/media/'+pdfDoc.id,{cookie:cookieA});
  assert.equal(ownPdf.status,200);assert.equal(ownPdf.headers.get('content-type'),'application/pdf');
  assert.equal((await call('/api/media/'+imageDoc.id,{cookie:cookieB})).status,404,
    'company B cannot access files stored in company A');
  assert.equal((await call('/api/media/'+pdfDoc.id,{cookie:cookieB})).status,404,
    'company B cannot read another company PDF');
  assert.equal((await call('/api/media/'+imageDoc.id)).status,403,'no client cookie is not sufficient');
 });

 await t.test('read-only overview endpoints work for each client',async()=>{
  for(const cookie of [cookieA,cookieB]){
   const dimensions=await call('/api/overview/dimensions',{cookie});
   assert.equal(dimensions.status,200,'dimension metrics should not be 403');
   const history=await call('/api/overview/approaches?period=today',{cookie});
   assert.equal(history.status,200,'approach history should not be 403');
  }
  assert.equal((await call('/api/overview/dimensions',{cookie:cookieA,method:'POST',body:Buffer.from('{}'),mime:'application/json'})).status,403,
    'read-only metrics cannot be modified');
 });

 await t.test('unrelated privileged routes and unrelated media kinds remain unavailable',async()=>{
  assert.equal((await call('/api/media?kind=audio',{method:'POST',cookie:cookieA,mime:'audio/ogg',body:png})).status,403);
  assert.equal((await call('/api/media?kind=video',{method:'POST',cookie:cookieA,mime:'video/mp4',body:png})).status,403);
  assert.equal((await call('/api/media?kind=image',{cookie:cookieA})).status,403);
  assert.equal((await call('/api/agent-bridge/status',{cookie:cookieA})).status,403);
  assert.equal((await call('/api/platform/clients',{cookie:cookieB})).status,403);
 });
},{timeout:60000});
