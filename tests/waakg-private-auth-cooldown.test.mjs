import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'gateway-reauth-'));
process.env.WA_AKG_BASE_URL='http://wa-akg.railway.internal:3000';
process.env.WA_AKG_ADMIN_EMAIL='test@example.com';
process.env.WA_AKG_ADMIN_PASSWORD='test-password-123';
delete process.env.WA_AKG_API_KEY;
const {getGatewayApiKey}=await import('../dashboard/waakg-control.mjs');
test('429 auth failures enter cooldown instead of hammering WA gateway',async()=>{
 let calls=0;
 const prior=globalThis.fetch;
 globalThis.fetch=async input=>{
  calls++;
  assert.match(String(input),/^http:\/\/wa-akg\.railway\.internal:3000\/api\/auth\/csrf$/);
  return {ok:false,status:429};
 };
 try{
  await assert.rejects(getGatewayApiKey(),/HTTP 429/);
  for(let i=0;i<4;i++)await assert.rejects(getGatewayApiKey(),/autenticação em recuperação/);
  assert.equal(calls,1,'only one CSRF attempt is made during cooldown');
 }finally{globalThis.fetch=prior;}
});
test.after(()=>{fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
