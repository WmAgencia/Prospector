import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-intel-'));
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.WA_AKG_ANALYTICS_ALLOWED_SESSIONS='session_one';
const svc=await import('../dashboard/whatsapp-intelligence-jobs.mjs');
const {db,run}=await import('../dashboard/db.mjs');
db.exec("CREATE TABLE IF NOT EXISTS sales_outcomes(lead_id TEXT PRIMARY KEY,status TEXT NOT NULL)");
const reads=[];
const gateway=async uri=>{
 reads.push(uri);
 if(uri==='/api/sessions')return {data:[{sessionId:'session_one',name:'Autorizado',status:'CONNECTED'},{sessionId:'another_one',name:'Outro',status:'CONNECTED'}]};
 if(uri==='/api/chat/session_one')return {data:[
  {jid:'5515999999999@s.whatsapp.net'},{jid:'5515988888888@s.whatsapp.net'},
  {jid:'99111@g.us'}]};
 if(uri.includes('5515999999999'))return {data:[
  {id:'a',fromMe:true,content:'Olá! Posso te enviar uma proposta?'},
  {id:'b',fromMe:false,content:'Tenho interesse sim'}]};
 if(uri.includes('5515988888888'))return {data:[
  {id:'c',fromMe:true,content:'Bom dia! Posso te apresentar algo?'}]};
 throw Error('Unexpected read '+uri);
};
async function complete(){
 for(let i=0;i<300;i++){
  const current=svc.intelligenceStatus();
  if(current.job&&['REVIEW','PARTIAL','FAILED'].includes(current.job.state))return current.job;
  await new Promise(setImmediate);
 }
 throw Error('job did not finish');
}
test('default per-company session ACL excludes other WhatsApps',async()=>{
 assert.deepEqual(svc.authorizedSessionIds(),['session_one']);
 const sessions=await svc.intelligenceSessions(gateway);
 assert.deepEqual(sessions.sessions.map(s=>s.id),['session_one']);
});
test('read-only run collects, deduplicates and excludes group chats',async()=>{
 const collected=await svc.collectReadOnly({request:gateway,sessionIds:['session_one']});
 assert.equal(collected.total,2);
 assert.equal(collected.failed,0);
 assert.equal(collected.conversations[0].outcome,'unclassified');
 assert.equal(collected.conversations[1].outcome,'no_response');
 assert.ok(reads.every(v=>v.startsWith('/api/')));
 assert.ok(!reads.some(v=>v.includes('/send')));
});
test('approval is blocked without explicit authorization',async()=>{
 assert.equal((await svc.startIntelligence({sessionIds:['session_one'],request:gateway})).status,403);
 assert.equal((await svc.startIntelligence({sessionIds:['another_one'],acknowledged:true,request:gateway})).status,403);
});
test('full lifecycle has progress, report, human approval and revoke',async()=>{
 const begin=await svc.startIntelligence({sessionIds:['session_one'],acknowledged:true,request:gateway});
 assert.equal(begin.status,202);
 const job=await complete();
 assert.equal(job.state,'REVIEW');
 assert.equal(job.percent,100);
 assert.equal(job.processed,2);
 assert.equal(job.failed,0);
 const report=svc.intelligenceDocument(job.id,'report');
 assert.match(report,/Relatório de inteligência/);
 assert.ok(!report.includes('5515999999999'));
 assert.equal(svc.reviewIntelligence({jobId:job.id,approve:true}).status,400);
 const reviewed=svc.reviewIntelligence({jobId:job.id,approve:true,acknowledged:true});
 assert.equal(reviewed.status,200);
 assert.match(svc.approvedIntelligenceGuidance(),/PLAYBOOK/);
 const revoked=svc.reviewIntelligence({jobId:job.id,approve:false,acknowledged:true});
 assert.equal(revoked.status,200);
 assert.equal(svc.approvedIntelligenceGuidance(),'');
});
test('partial gateway failures prevent applying learning',async()=>{
 const broken=async uri=>uri.includes('5515988888888')?Promise.reject(Error('gateway unavailable')):gateway(uri);
 const begin=await svc.startIntelligence({sessionIds:['session_one'],acknowledged:true,request:broken});
 assert.equal(begin.status,202);
 const job=await complete();
 assert.equal(job.state,'PARTIAL');
 assert.equal(job.failed,1);
 assert.equal(svc.reviewIntelligence({jobId:job.id,approve:true,acknowledged:true}).status,409);
});
test('isolates group chats, invalid JIDs and malformed session IDs',()=>{
 const filtered=svc.filterRemoteChats([{jid:'1234567890@g.us'},{jid:'5515999999999@s.whatsapp.net'},{jid:'not@valid'}]);
 assert.equal(filtered.length,1);
 assert.deepEqual(svc.authorizedSessionIds({configured:'../../no,wrong space,session_1,session_1',defaultId:'safe_default'}),['session_1']);
});
