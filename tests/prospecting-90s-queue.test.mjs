import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/prospector-90s-');
process.env.PROSPECTOR_DATA_DIR=dir;
const db=await import('../dashboard/db.mjs');
const queue=await import('../dashboard/prospecting-queue.mjs');

function lead(name,number,consent=true){
 const result=db.addLead({business:name,phone:number,city:'Sorocaba',segment:'oficina mecânica',source:'MANUAL',contact_permission:consent}).lead;
 if(consent)db.audit('CONSENT_UPDATED',result.id,{permitted:true,evidence:'consentimento verificado neste teste'});
 return result;
}
let nowMs=2_000_000_000_000;
const sent=[];
const deps={currentTime:()=>nowMs,getWaStatus:async()=>({connected:true,sessionId:'test-session'}),getSession:()=> 'test-session',send:async(url,options)=>{sent.push({url,body:options.data,time:nowMs});return {status:true};}};

test('Only documented opt-ins are queued; regular discovered leads are excluded',()=>{
 const a=lead('Mecânica A','15988887771'),b=lead('Mecânica B','15988887772'),unconsented=lead('Mecânica Pública','15988887773',false);
 const result=queue.enqueueApprovedApproaches({leadIds:[a.id,b.id,unconsented.id],approve:true});
 assert.equal(result.status,202);
 assert.equal(result.body.queued,2);
 assert.equal(result.body.excluded,1);
 assert.equal(queue.approachQueueStatus().waiting,2);
 assert.equal(queue.approachQueueStatus().intervalSeconds,90);
 assert.equal(sent.length,0);
 const duplicate=queue.enqueueApprovedApproaches({leadIds:[a.id],approve:true});
 assert.equal(duplicate.status,409);
});

test('Two initial greetings are never attempted less than 90 seconds apart',async()=>{
 const first=await queue.tickApproachQueue(deps);
 assert.equal(first.status,'SENT');
 assert.equal(sent.length,1);
 assert.match(sent[0].body.message.text,/Olá, (bom dia|boa tarde|boa noite), como vai\?/);
 nowMs+=89_999;
 const early=await queue.tickApproachQueue(deps);
 assert.equal(early.status,'WAITING');
 assert.equal(sent.length,1);
 nowMs+=1;
 const second=await queue.tickApproachQueue(deps);
 assert.equal(second.status,'SENT');
 assert.equal(sent.length,2);
 assert.equal(sent[1].time-sent[0].time,90_000);
 assert.equal(db.one("SELECT COUNT(*) n FROM initial_contacts WHERE status='SENT'").n,2);
 assert.equal(db.one("SELECT COUNT(*) n FROM messages WHERE direction='out'").n,2);
 assert.equal((await queue.tickApproachQueue(deps)).status,'COMPLETED');
});

test('Cancellation prevents queued contacts from being approached',async()=>{
 const a=lead('Mecânica C','15988887774'),b=lead('Mecânica D','15988887775');
 const batch=queue.enqueueApprovedApproaches({leadIds:[a.id,b.id],approve:true});
 assert.equal(batch.status,202);
 const stopped=queue.cancelApproachQueue();
 assert.equal(stopped.cancelled,2);
 nowMs+=90_000;
 assert.equal((await queue.tickApproachQueue(deps)).status,'IDLE');
 assert.equal(sent.length,2);
});

test('Timeout is UNKNOWN and never retried automatically',async()=>{
 const a=lead('Mecânica E','15988887776');
 const batch=queue.enqueueApprovedApproaches({leadIds:[a.id],approve:true});
 assert.equal(batch.status,202);
 let attempts=0;
 const unknown=await queue.tickApproachQueue({...deps,send:async()=>{attempts++;throw Error('timeout');}});
 assert.equal(unknown.status,'UNKNOWN');
 assert.equal(attempts,1);
 assert.equal(db.one('SELECT status FROM prospecting_batch_items WHERE lead_id=?',a.id).status,'UNKNOWN');
 nowMs+=90_000;
 assert.equal((await queue.tickApproachQueue({...deps,send:async()=>{attempts++;return {status:true};}})).status,'COMPLETED');
 assert.equal(attempts,1);
 assert.equal(queue.enqueueApprovedApproaches({leadIds:[a.id],approve:true}).status,403);
});

test('Missing approval and public-phone records do not send',()=>{
 const a=lead('Lead sem permissão','15988887777',false);
 assert.equal(queue.enqueueApprovedApproaches({leadIds:[a.id],approve:true}).status,403);
 assert.equal(queue.enqueueApprovedApproaches({leadIds:[a.id],approve:false}).status,400);
 assert.equal(queue.enqueueApprovedApproaches({leadIds:[],approve:true}).status,400);
 assert.equal(sent.length,2);
});

test.after(()=>{db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
