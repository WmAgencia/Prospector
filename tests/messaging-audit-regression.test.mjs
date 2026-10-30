import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/messaging-audit-');
process.env.WA_AKG_SESSION_ID='configured-missing';process.env.WA_AKG_API_KEY='mock';
process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED='true';
process.env.AUDIO_RESPONSE_ENABLED='true';process.env.FRANCISCA_TTS_ENABLED='true';
const d=await import('../dashboard/db.mjs');
const intro=await import('../dashboard/prospecting-introduction.mjs');
const sales=await import('../dashboard/groq-sales-automation.mjs');
const control=await import('../dashboard/waakg-control.mjs');
const bridge=await import('../dashboard/waakg-bridge.mjs');
let n=0;
function lead(){const l=d.addLead({business:'Regression '+(++n),phone:String(5515988000000+n),contact_permission:true}).lead;d.audit('CONSENT_UPDATED',l.id,{permitted:true,evidence:'Documented local test consent'});return l;}
function incoming(l,text='Pode explicar seu serviço?'){const pid='configured-missing:audit-'+n;bridge.recordInboundTranscript({sessionId:'configured-missing',jid:l.phone+'@s.whatsapp.net',unique:pid,content:text});return pid;}
test('explicit absent session never falls back to another identity',async()=>{const original=global.fetch;global.fetch=async()=>({ok:true,status:200,json:async()=>({data:[{sessionId:'consecom-principal',status:'CONNECTED'}]})});try{const s=await control.waControlStatus();assert.equal(s.connected,false);assert.equal(s.sessionId,'configured-missing');}finally{global.fetch=original;}});
test('new greeting resets safe old cycle but preserves same and uncertain greetings',()=>{const l=lead();assert.equal(intro.registerGreeting({leadId:l.id,greetingId:'old',sessionId:'configured-missing'}),true);d.run("UPDATE prospecting_introductions SET stage='CANCELLED',created_at='2020-01-01T00:00:00Z' WHERE lead_id=?",l.id);assert.equal(intro.registerGreeting({leadId:l.id,greetingId:'new',sessionId:'configured-missing'}),true);assert.equal(intro.registerGreeting({leadId:l.id,greetingId:'new',sessionId:'configured-missing'}),false);d.run("UPDATE prospecting_introductions SET stage='UNKNOWN' WHERE lead_id=?",l.id);assert.equal(intro.registerGreeting({leadId:l.id,greetingId:'third',sessionId:'configured-missing'}),false);});
test('month-end recontact opens on clamped April 30 and preserves exact cooldown time',t=>{
 const l=lead();intro.registerGreeting({leadId:l.id,greetingId:'january-cycle',sessionId:'configured-missing'});
 d.run("UPDATE prospecting_introductions SET stage='CANCELLED',created_at='2026-01-31T12:00:00.000Z' WHERE lead_id=?",l.id);
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-04-30T11:59:59.999Z')});
 assert.equal(intro.registerGreeting({leadId:l.id,greetingId:'april-cycle',sessionId:'configured-missing'}),false);
 t.mock.timers.tick(1);
 assert.equal(intro.registerGreeting({leadId:l.id,greetingId:'april-cycle',sessionId:'configured-missing'}),true);
 t.mock.timers.reset();
});
test('qualification must not overwrite newer refusal',async()=>{const l=lead(),pid=incoming(l);const out=await sales.handleSalesTurn(pid,{qualify:async()=>{d.run("UPDATE leads SET stage='NO_INTEREST' WHERE id=?",l.id);return {confirmed:true};}});assert.notEqual(out.state,'HOT');assert.equal(d.one('SELECT stage FROM leads WHERE id=?',l.id).stage,'NO_INTEREST');});
test('accepted text remains in history when voice fails',async()=>{const l=lead(),pid=incoming(l,'Quero áudio e texto juntos');const out=await sales.handleSalesTurn(pid,{qualify:async()=>({confirmed:false}),status:async()=>({connected:true,sessionId:'configured-missing'}),draft:async()=>({ok:true,draft:'Posso explicar os serviços da agência.'}),voice:async()=>({bytes:Buffer.alloc(300)}),send:async()=>({status:true}),sendVoice:async()=>{throw Error('simulated');}});assert.equal(out.state,'PARTIAL');assert.match(d.one('SELECT body FROM messages WHERE provider_id=?','groq:'+pid)?.body||'',/Posso explicar/);});

for(const mutation of ['takeover','suppression','newer','relationship'])test('qualification revalidates '+mutation,async()=>{
 const l=lead(),pid=incoming(l);
 const out=await sales.handleSalesTurn(pid,{qualify:async()=>{
  if(mutation==='takeover')d.run('UPDATE threads SET manual_takeover=1 WHERE lead_id=?',l.id);
  if(mutation==='suppression')d.run('INSERT INTO suppressions(phone,reason,created_at) VALUES(?,?,?)',l.phone,'test opt out',d.now());
  if(mutation==='newer')bridge.recordInboundTranscript({sessionId:'configured-missing',jid:l.phone+'@s.whatsapp.net',unique:pid+':newer',content:'Preciso pensar'});
  if(mutation==='relationship')d.run("INSERT INTO contact_relationships(phone,kind,evidence,source,updated_at) VALUES(?,'EXISTING_CLIENT','verified test','OPERATOR',?)",l.phone,d.now());
  return {confirmed:true};
 }});
 assert.notEqual(out.state,'HOT');assert.equal(d.one('SELECT COUNT(*) n FROM sales_outcomes WHERE lead_id=?',l.id).n,0);
});
test('new introduction ignores historical outbound and old initial contact timestamp',async()=>{
 const l=lead(),thread=d.getThread(l.id);
 d.run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',l.id,l.phone,'SENT','old-contact','2020-01-01T00:00:00Z');
 d.addMessage({threadId:thread.id,providerId:'old-history',direction:'out',body:'Old cycle',status:'sent'});
 d.run("UPDATE messages SET at='2020-01-01T00:00:00Z' WHERE provider_id='old-history'");
 d.addMessage({threadId:thread.id,providerId:'prospect-queue:new-cycle',direction:'out',body:'Olá',status:'sent'});
 intro.registerGreeting({leadId:l.id,greetingId:'new-cycle',sessionId:'configured-missing'});
 intro.routeIntroductionReply({leadId:l.id,providerId:'reply',receivedAt:new Date(Date.now()-60000)});
 let sends=0;
 const result=await intro.tickIntroductions({status:async()=>({connected:true}),send:async()=>{sends++;return {status:true};}});
 assert.equal(result.state,'SENT');assert.equal(sends,1);
});
test('introduction rechecks takeover after awaiting status',async()=>{
 const l=lead();d.run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',l.id,l.phone,'SENT','contact-'+n,d.now());d.getThread(l.id);
 intro.registerGreeting({leadId:l.id,greetingId:'race-'+n,sessionId:'configured-missing'});
 intro.routeIntroductionReply({leadId:l.id,providerId:'reply',receivedAt:new Date(Date.now()-60000)});
 let sends=0;
 const result=await intro.tickIntroductions({status:async()=>{d.run('UPDATE threads SET manual_takeover=1 WHERE lead_id=?',l.id);return {connected:true};},send:async()=>{sends++;return {status:true};}});
 assert.equal(result.state,'CANCELLED');assert.equal(sends,0);
});
test.after(()=>{d.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
