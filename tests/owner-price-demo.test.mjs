import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/price-demo-');process.env.PROSPECTOR_OWNER_PHONE='5515981817336';process.env.PROSPECTOR_PERSONAL_PHONE='5515981817336';process.env.WA_AKG_SESSION_ID='demo-session';
const d=await import('../dashboard/db.mjs');const p=await import('../dashboard/owner-price-approvals.mjs');
const id='11111111-1111-4111-8111-111111111111',unknown='22222222-2222-4222-8222-222222222222';
const deps={getStatus:async()=>({connected:true,sessionId:'demo-session'}),getSessionIdentity:async()=> '5515999999999@s.whatsapp.net'};
test('demo reaches only owner and its selection never sends a quote to a customer',async()=>{
 const calls=[];const transport={...deps,transmit:async(path,args)=>{calls.push({path,args});return {status:true};}};
 assert.equal((await p.sendOwnerPriceDemo(id,transport)).state,'SENT');assert.equal(calls.length,2);
 assert.ok(calls.every(x=>decodeURIComponent(x.path).includes('5515981817336@s.whatsapp.net')));
 assert.equal((await p.sendOwnerPriceDemo(id,transport)).state,'ALREADY_ATTEMPTED');
 const result=await p.processPriceDecision({text:'preco:'+id+':550',jid:'5515981817336@s.whatsapp.net',sessionId:'demo-session',providerId:'demo-choice'},transport);
 assert.equal(result.state,'DEMO_CONFIRMED');assert.match(result.message,/550/);assert.equal(calls.length,2);
 assert.equal((await p.processPriceDecision({text:'preco:'+id+':350',jid:'5515981817336@s.whatsapp.net',sessionId:'demo-session',providerId:'demo-choice-2'},transport)).ok,false);
});
test('ambiguous demo is never repeated and invalid IDs do not send',async()=>{
 let count=0;const bad={...deps,transmit:async()=>{count++;throw Error('timeout');}};
 assert.equal((await p.sendOwnerPriceDemo(unknown,bad)).state,'UNKNOWN');await p.sendOwnerPriceDemo(unknown,bad);assert.equal(count,1);
 assert.equal((await p.sendOwnerPriceDemo('bad',bad)).state,'INVALID_ID');assert.equal(count,1);
});
test.after(()=>{d.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
