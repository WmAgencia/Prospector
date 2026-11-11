import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-owner-call-'));
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.WA_AKG_SESSION_ID='owner_test_session';
process.env.PROSPECTOR_OWNER_PHONE='5515981817336';
process.env.PROSPECTOR_GROUP_IMPORT_JID='120363044445555666@g.us';
process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE='false';
const {addLead,id,now,getThread,one,run}=await import('../dashboard/db.mjs');
const {registerSession,bindLeadSession}=await import('../dashboard/waakg-session-registry.mjs');
const {routeOwnerCall,flushCallScheduling}=await import('../dashboard/call-scheduling.mjs');
registerSession('owner_test_session','Teste sem WhatsApp real');

test('Only the actual owner can decline a customer-proposed call time; no customer reply is sent',async(t)=>{
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const lead=addLead({business:'Empresa de teste',phone:'5515999412345',source:'maps_extension'}).lead;
 getThread(lead.id,lead.phone+'@s.whatsapp.net');
 bindLeadSession(lead.id,'owner_test_session');
 const flow=id(),requestAt=now();
 run("INSERT INTO call_scheduling(id,lead_id,session_id,phone,state,slots_json,proposed_at,notice_state,customer_send_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'PENDING','NONE',?,?)",
  flow,lead.id,'owner_test_session',lead.phone,'WAIT_OWNER_ALTERNATIVE','[]',
  new Date(Date.now()+60*60_000).toISOString(),requestAt,requestAt);
 const jid=process.env.PROSPECTOR_GROUP_IMPORT_JID;
 const other=routeOwnerCall({jid,sessionId:'owner_test_session',participant:'5515999999999@s.whatsapp.net',providerId:'event-unauthorized',text:'REUNIAO '+flow+' RECUSAR'});
 assert.equal(other.handled,true);
 assert.equal(other.ok,false);
 assert.equal(one('SELECT state FROM call_scheduling WHERE id=?',flow).state,'WAIT_OWNER_ALTERNATIVE');
 const owner=routeOwnerCall({jid,sessionId:'owner_test_session',participant:'5515981817336@s.whatsapp.net',providerId:'event-authorized',text:'REUNIAO '+flow+' RECUSAR'});
 assert.equal(owner.ok,true);
 assert.equal(one('SELECT state FROM call_scheduling WHERE id=?',flow).state,'HANDOFF');
 assert.equal(one('SELECT manual_takeover FROM threads WHERE lead_id=?',lead.id).manual_takeover,1);
 assert.equal(one('SELECT customer_send_state FROM call_scheduling WHERE id=?',flow).customer_send_state,'NONE');
 const delivered=[];
 const reply=await flushCallScheduling({
  status:async()=>({connected:true,sessionId:'owner_test_session'}),
  send:async(route,options)=>{
   if(route.startsWith('/api/sessions/'))return {status:true,data:{me:{jid:'5515988882994@s.whatsapp.net'}}};
   delivered.push({route,options});return {status:true};
  }
 });
 assert.equal(reply.sent,1);
 assert.equal(delivered.length,1);
 assert.ok(delivered[0].route.includes(encodeURIComponent(jid)));
 assert.match(delivered[0].options.data.message.text,/Assuma pelo link acima/);
 assert.match(delivered[0].options.data.message.text,/https:\/\/wa\.me\/5515999412345/);
 assert.equal(delivered.filter(x=>x.route.includes('5515999412345')).length,0);
 const replay=routeOwnerCall({jid,sessionId:'owner_test_session',participant:'5515981817336@s.whatsapp.net',providerId:'event-authorized',text:'REUNIAO '+flow+' RECUSAR'});
 assert.equal(replay.ok,false);
});
