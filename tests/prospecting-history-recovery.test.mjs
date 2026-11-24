import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-history-recovery-'));
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.WA_AKG_SESSION_ID='history-test-sender';
const db=await import('../dashboard/db.mjs');
await import('../dashboard/prospecting-queue.mjs');
await import('../dashboard/prospecting-introduction.mjs');
const {registerSession,bindLeadSession}=await import('../dashboard/waakg-session-registry.mjs');
const {reserveTextReceipt,unknownTextReceipt,reconcileTextReceipts,textReceipt}=await import('../dashboard/prospecting-text-receipts.mjs');
registerSession('history-test-sender','Test sender');
const jid=id=>'551599'+String(id).padStart(8,'0')+'@s.whatsapp.net';
function setup(kind,number){
 const id='lead-hist-'+number,phone=jid(number).split('@')[0],greeting='greeting-hist-'+number;
 const stamp=db.now();
 db.run('INSERT INTO leads(id,business,phone,stage,contact_permission,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?)',
  id,'Test '+number,phone,'DISCOVERED',1,stamp,stamp);
 bindLeadSession(id,'history-test-sender');
 db.audit('CONSENT_UPDATED',id,{permitted:true,evidence:'Test approval'});
 const thread=db.getThread(id,jid(number));
 db.run('INSERT INTO prospecting_batches(id,status,created_at,updated_at,origin) VALUES(?,?,?,?,?)',
  'batch-hist-'+number,'ACTIVE',stamp,stamp,'MANUAL');
 db.run('INSERT INTO prospecting_batch_items(id,batch_id,lead_id,phone,status,attempt_at,created_at) VALUES(?,?,?,?,?,?,?)',
  greeting,'batch-hist-'+number,id,phone,kind==='GREETING'?'SENDING':'SENT',stamp,stamp);
 db.run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',
  id,phone,kind==='GREETING'?'UNKNOWN':'SENT',greeting,stamp);
 if(kind==='INTRO')db.run('INSERT INTO prospecting_introductions(lead_id,phone,session_id,greeting_id,stage,reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
  id,phone,'history-test-sender',greeting,'SENDING',null,stamp,stamp);
 reserveTextReceipt({leadId:id,greetingId:greeting,kind,sessionId:'history-test-sender',jid:jid(number)});
 unknownTextReceipt({leadId:id,greetingId:greeting,kind,error:'Gateway timed out'});
 if(kind==='GREETING')db.run("UPDATE prospecting_batch_items SET status='UNKNOWN' WHERE id=?",greeting);
 else db.run("UPDATE prospecting_introductions SET stage='UNKNOWN',reason='Uncertain delivery; verify WhatsApp' WHERE lead_id=?",id);
 return {id,phone,greeting,stamp,thread,jid:jid(number)};
}
const a=setup('GREETING',99111);
const b=setup('GREETING',99222);
const c=setup('INTRO',99333);
const expected='Meu nome é Wesley, sou dono da agência Consecom. Eu tô entrando em contato porque queria fazer uma proposta pra vocês. Posso te mandar um áudio explicando a ideia?';
db.addMessage({threadId:a.thread.id,providerId:'prospect-queue:'+a.greeting,direction:'out',body:'Olá, empresa teste!',status:'sent'});
db.addMessage({threadId:b.thread.id,providerId:'prospect-queue:'+b.greeting,direction:'out',body:'Olá, empresa teste!',status:'sent'});
test('recover only the messages actually found in WhatsApp, without sending again',async()=>{
 let reads=0;
 const sent={fromMe:true,type:'TEXT',keyId:'CONFIRMED_RECEIPT_111',content:'Olá, empresa teste!',timestamp:a.stamp,status:'DELIVERED'};
 const replied={fromMe:true,type:'TEXT',keyId:'CONFIRMED_RECEIPT_333',content:expected,timestamp:c.stamp,status:'SENT'};
 const fetchChat=async url=>{
  reads++;
  return {status:true,data:url.includes(a.phone)?[sent]:url.includes(c.phone)?[replied]:[]};
 };
 const outcome=await reconcileTextReceipts({fetchChat,limit:8});
 assert.equal(outcome.checked,3);
 assert.equal(outcome.matched,2);
 assert.equal(reads,3);
 assert.equal(textReceipt(a.id,a.greeting,'GREETING').status,'DELIVERED');
 assert.equal(textReceipt(a.id,a.greeting,'GREETING').provider_id,'CONFIRMED_RECEIPT_111');
 assert.equal(db.one('SELECT status FROM prospecting_batch_items WHERE id=?',a.greeting).status,'SENT');
 assert.equal(db.one('SELECT status FROM initial_contacts WHERE job_id=?',a.greeting).status,'SENT');
 assert.equal(textReceipt(b.id,b.greeting,'GREETING').status,'UNKNOWN');
 assert.equal(db.one('SELECT status FROM prospecting_batch_items WHERE id=?',b.greeting).status,'UNKNOWN');
 assert.equal(db.one('SELECT stage FROM prospecting_introductions WHERE lead_id=?',c.id).stage,'SENT');
 assert.equal(textReceipt(c.id,c.greeting,'INTRO').provider_id,'CONFIRMED_RECEIPT_333');
 assert.equal(db.one('SELECT COUNT(*) AS n FROM messages WHERE provider_id=?','intro:'+c.greeting).n,1);
 assert.equal(db.one('SELECT COUNT(*) AS n FROM prospecting_batch_items').n,3);
});
test.after(()=>{db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
