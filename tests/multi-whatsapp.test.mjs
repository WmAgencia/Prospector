import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/multi-whatsapp-');
process.env.WA_AKG_SESSION_ID='pool-one';process.env.WA_AKG_API_KEY='test-only';
process.env.PROSPECTOR_COLD_FIRST_APPROACH='true';process.env.PROSPECTOR_REPLY_PACING_ENABLED='false';
process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED='true';process.env.PROSPECTOR_OWNER_PHONE='5511900009999';
const d=await import('../dashboard/db.mjs');
const registry=await import('../dashboard/waakg-session-registry.mjs');
const control=await import('../dashboard/waakg-control.mjs');
const q=await import('../dashboard/prospecting-queue.mjs');
const bridge=await import('../dashboard/waakg-bridge.mjs');
const intro=await import('../dashboard/prospecting-introduction.mjs');
const ai=await import('../dashboard/groq-sales-automation.mjs');
const roles=await import('../dashboard/whatsapp-roles.mjs');
registry.registerSession('pool-two','Comercial 2');registry.registerSession('pool-three','Comercial 3');
const originalFetch=globalThis.fetch,online=new Set(['pool-one','pool-two','pool-three']);
globalThis.fetch=async(url)=>{
 const path=new URL(url).pathname;
 if(path==='/api/sessions')return Response.json({status:true,data:registry.managedSessions().map(x=>({sessionId:x.session_id,status:online.has(x.session_id)?'CONNECTED':'DISCONNECTED'}))});
 const sid=decodeURIComponent(path.split('/').at(-1));
 return Response.json({status:true,data:{sessionId:sid,status:online.has(sid)?'CONNECTED':'DISCONNECTED',hasInstance:online.has(sid),me:online.has(sid)?{id:'5511900000001@s.whatsapp.net'}:null}});
};
let time=Date.parse('2026-11-05T13:00:00Z');
const sent=[];
const send=async(path,options)=>{sent.push({path,options,time});return {status:true};};
const leads=Array.from({length:7},(_,i)=>d.addLead({business:'Empresa fictícia '+i,city:'Sorocaba',phone:'55119000100'+String(i).padStart(2,'0'),source:'MANUAL'}).lead);
d.setSetting('paused',false);d.setSetting('autonomous_outreach_enabled',true);
test('round robin uses 1,2,3,1 under the same persisted global random clock',async()=>{
 assert.equal(q.enqueueApprovedApproaches({leadIds:leads.map(x=>x.id),approve:true,operatorApproved:true}).status,202);
 for(const expected of ['pool-one','pool-two','pool-three','pool-one']){
  const before=sent.length;
  assert.equal((await q.tickApproachQueue({currentTime:()=>time,send})).status,'SENT');
  assert.equal(sent.length,before+1);
  assert.ok(sent.at(-1).path.startsWith('/api/messages/'+expected+'/'));
  const interval=q.approachQueueStatus().intervalSeconds*1000;
  assert.ok(interval>=90000&&interval<=180000);
  time+=interval-1;
  assert.equal((await q.tickApproachQueue({currentTime:()=>time,send})).status,'WAITING');
  assert.equal(sent.length,before+1);time++;
 }
});
test('offline accounts are skipped and a full outage does not advance clock or cursor',async()=>{
 online.delete('pool-two');
 assert.equal((await q.tickApproachQueue({currentTime:()=>time,send})).status,'SENT');
 assert.ok(sent.at(-1).path.startsWith('/api/messages/pool-three/'));
 time+=180000;
 const before={...d.one('SELECT * FROM prospecting_send_clock WHERE id=1')},cursor=registry.rotationCursor();
 online.clear();
 assert.equal((await q.tickApproachQueue({currentTime:()=>time,send})).status,'OFFLINE');
 assert.deepEqual({...d.one('SELECT * FROM prospecting_send_clock WHERE id=1')},before);
 assert.equal(registry.rotationCursor(),cursor);
 const source=new URL('../dashboard/waakg-session-registry.mjs',import.meta.url).href;
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {rotationCursor} from '${source}';console.log(rotationCursor());`],{env:process.env,encoding:'utf8',timeout:20000});
 assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),cursor);
 online.add('pool-one');online.add('pool-two');online.add('pool-three');
});
test('introduction and AI replies stay on the originating number; another session cannot inject a reply',async()=>{
 const lead=d.one("SELECT l.* FROM leads l JOIN lead_whatsapp_routes r ON r.lead_id=l.id WHERE r.session_id='pool-two' LIMIT 1");
 assert.ok(lead);
 const before=d.one('SELECT COUNT(*) n FROM messages').n;
 const wrong=bridge.recordInboundTranscript({sessionId:'pool-three',jid:lead.phone+'@s.whatsapp.net',unique:'pool-three:WRONG1',content:'Pode mandar a proposta'});
 assert.equal(wrong.body.ignored,true);assert.equal(d.one('SELECT COUNT(*) n FROM messages').n,before);
 bridge.recordInboundTranscript({sessionId:'pool-two',jid:lead.phone+'@s.whatsapp.net',unique:'pool-two:REPLY1',content:'Pode explicar'});
 const due=Date.parse(intro.introductionStatus(lead.id).due_at);
 assert.equal((await intro.tickIntroductions({currentTime:()=>due,status:async id=>({connected:true,sessionId:id}),send})).state,'SENT');
 assert.ok(sent.at(-1).path.startsWith('/api/messages/pool-two/'));
 bridge.recordInboundTranscript({sessionId:'pool-two',jid:lead.phone+'@s.whatsapp.net',unique:'pool-two:REPLY2',content:'Como funciona a proposta?'});
 assert.equal((await ai.handleSalesTurn('pool-two:REPLY2',{status:async id=>({connected:true,sessionId:id}),qualify:async()=>({confirmed:false}),draft:async()=>({ok:true,draft:'A equipe vai conferir esse ponto.'}),send})).state,'SENT');
 assert.ok(sent.at(-1).path.startsWith('/api/messages/pool-two/'));
});
test('unregistered sessions are rejected and secondary numbers do not grant owner tools',async()=>{
 assert.equal((await control.waControlStatus('not-managed')).status,'UNAUTHORIZED_SESSION');
 assert.equal(roles.classifyContact({jid:'5511900009999@s.whatsapp.net',sessionId:'pool-two'}).ownerTools,false);
 assert.equal(roles.classifyContact({jid:'5511900009999@s.whatsapp.net',sessionId:'pool-one'}).ownerTools,true);
});
test('historical rest deadlines no longer remove connected accounts from rotation',async()=>{
 d.run('INSERT INTO session_outreach_budget(session_id,confirmed,cooldown_until) VALUES(?,?,?)','pool-one',20,time+900000);
 assert.equal((await control.selectApproachSender()).sessionId,'pool-one');
 assert.equal((await q.tickApproachQueue({currentTime:()=>time,send})).status,'SENT');
 assert.ok(sent.at(-1).path.startsWith('/api/messages/pool-one/'));
});

test.after(()=>{globalThis.fetch=originalFetch;d.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
