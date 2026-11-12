import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-wa-tenant-boundary-'));
test.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
const uuidA=crypto.randomUUID(),uuidB=crypto.randomUUID();
const sessionA='prospector-'+crypto.randomUUID(),sessionB='prospector-'+crypto.randomUUID();
const script=`
 import assert from 'node:assert/strict';
 import {registerSession} from './dashboard/waakg-session-registry.mjs';
 import {waRequest,waControlStatus,waGetQR,waDisconnect,validNewTenantSessionId} from './dashboard/waakg-control.mjs';
 const owned=process.env.OWNED_SESSION,foreign=process.env.FOREIGN_SESSION;
 let calls=0;
 registerSession(owned,'WhatsApp piloto autorizado');
 globalThis.fetch=async (u,options={})=>{
  calls++;
  const pathname=new URL(u).pathname;
  if(pathname==='/api/sessions')return Response.json({status:true,data:[
   {sessionId:owned,status:'CONNECTED',name:'Titular'},
   {sessionId:foreign,status:'CONNECTED',name:'Outra Empresa'},
   {sessionId:'consecom-principal',status:'CONNECTED',name:'Consecom'}
  ]});
  if(pathname==='/api/sessions/'+owned+'/qr')return Response.json({status:true,base64:'data:image/png;base64,AAAA'});
  return Response.json({status:true,data:{sessionId:owned,status:'CONNECTED'}});
 };
 assert.equal(validNewTenantSessionId(owned),true);
 assert.equal(validNewTenantSessionId('prospector-do-outro-tenant'),false);
 assert.equal(validNewTenantSessionId('consecom-principal'),false);
 const listed=await waRequest('/api/sessions');
 assert.deepEqual(listed.data.map(x=>x.sessionId),[owned]);
 const prior=calls;
 const foreignPaths=[
  '/api/sessions/'+foreign,
  '/api/sessions/'+foreign+'/logout',
  '/api/webhooks/'+foreign,
  '/api/chat/'+foreign+'/5511999999999@s.whatsapp.net',
  '/api/messages/'+foreign+'/5511999999999@s.whatsapp.net/send',
  '/api/sessions/consecom-principal'
 ];
 for(const p of foreignPaths)await assert.rejects(waRequest(p,{method:p.includes('logout')||p.includes('/send')?'POST':'GET'}),/não pertence|não.*conta|Canal/i);
 assert.equal(calls,prior,'foreign session must never reach the shared gateway API');
 await assert.rejects(waRequest('/api/sessions',{method:'POST',data:{sessionId:'prospector-forged',name:'Ataque'}}),/Sessão inválida/);
 await assert.rejects(waRequest('/api/sessions',{method:'POST',data:{sessionId:'consecom-principal',name:'Ataque'}}),/Sessão inválida/);
 assert.equal(calls,prior,'invalid session creation must never touch the provider');
 const blocked=await waControlStatus(foreign);
 assert.equal(blocked.status,'UNAUTHORIZED_SESSION');
 const qr=await waGetQR(foreign);
 assert.equal(qr.qr,null);
 await assert.rejects(waDisconnect(foreign),/verificar o WhatsApp/i);
 assert.equal(calls,prior,'foreign QR and logout must not call provider');
 const ownedQR=await waGetQR(owned);
 assert.ok(String(ownedQR.qr||'').startsWith('data:image/png;base64,'));
 console.log('VERIFY='+JSON.stringify({owned,listed:listed.data.map(x=>x.sessionId),foreignBlocked:foreignPaths.length,
  invalidCreateBlocked:true,foreignGetRequests:0,ownedQrAllowed:true}));
`;
function run(name,owned,foreign){
 const env={...process.env,PROSPECTOR_TENANT_ID:crypto.randomUUID(),
  PROSPECTOR_DATA_DIR:path.join(root,name),PROSPECTOR_TENANT_INTERNAL:'false',
  WA_AKG_API_KEY:'mock-only-not-real',WA_AKG_SESSION_ID:'',WA_AKG_BASE_URL:'https://wa-akg-production-f9f0.up.railway.app',
  WA_AKG_ADMIN_EMAIL:'',WA_AKG_ADMIN_PASSWORD:'',OWNED_SESSION:owned,FOREIGN_SESSION:foreign,
  GROQ_API_KEY:'',RUN_MAPS_SMOKE:'false'};
 for(const k of Object.keys(env))if(k.startsWith('RUN_'))delete env[k];
 const output=execFileSync(process.execPath,['--input-type=module','-e',script],{
  cwd:process.cwd(),env,encoding:'utf8',timeout:20000
 });
 const data=output.split('\n').find(x=>x.startsWith('VERIFY='));
 assert.ok(data);return JSON.parse(data.slice(7));
}
test('client A can control its own WhatsApp but cannot see or operate client B or Consecom',()=>{
 const x=run('A',sessionA,sessionB);
 assert.deepEqual(x.listed,[sessionA]);assert.equal(x.foreignBlocked,6);
});
test('client B cannot see or operate client A or Consecom',()=>{
 const x=run('B',sessionB,sessionA);
 assert.deepEqual(x.listed,[sessionB]);assert.equal(x.foreignBlocked,6);
});
