import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/prospector-groq-handoff-');
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.AI_CONVERSATION_AUTOSEND='true';
process.env.PROSPECTOR_HOT_LEAD_PHONE='15981817336';
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.GROQ_API_KEY='test-only';
const db=await import('../dashboard/db.mjs');
db.db.exec("CREATE TABLE waakg_inbox(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,jid TEXT NOT NULL,provider_id TEXT NOT NULL UNIQUE,lead_id TEXT,body TEXT NOT NULL,state TEXT NOT NULL,received_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
const classifier=await import('../dashboard/groq-interest-check.mjs');
const agent=await import('../dashboard/groq-sales-automation.mjs');
const sends=[];
const fake={status:async()=>({connected:true,sessionId:'consecom-principal'}),
 send:async(route,params)=>{sends.push({route,payload:params.data});return {status:true};},
 draft:async()=>({ok:true,draft:'Claro! Posso explicar rapidinho como funcionaria?',model:'mock'})};
function input({number,body,state='REVIEW'}){
 const lead=db.addLead({business:'Empresa QA '+number.slice(-4),phone:number,source:'MANUAL'}).lead;
 const jid=lead.phone+'@s.whatsapp.net',thread=db.getThread(lead.id,jid);
 const providerId='qa:'+db.id();
 db.addMessage({threadId:thread.id,providerId:providerId+':incoming',direction:'in',body});
 db.run('INSERT INTO waakg_inbox(id,session_id,jid,provider_id,lead_id,body,state,received_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',db.id(),'consecom-principal',jid,providerId,lead.id,body,state,db.now(),db.now());
 assert.equal(agent.queueInboundTurn({providerId,jid}),true);
 return {providerId,lead,jid};
}
test('Only concrete commitment is eligible for AI verification',async()=>{
 assert.equal(classifier.explicitInterest('Quanto custa um site?'),false);
 assert.equal(classifier.explicitInterest('Gostei, vou pensar'),false);
 assert.equal(classifier.explicitInterest('Vamos fechar esse projeto'),true);
 assert.equal(classifier.explicitInterest('Não quero, vamos fechar não'),false);
 const confirmed=await classifier.qualifyWithGroq({text:'Vamos fechar o projeto',fetchFn:async()=>Response.json({choices:[{message:{content:JSON.stringify({interested:true,confidence:0.97,evidence:'Vamos fechar'})}}]})});
 assert.equal(confirmed.confirmed,true);
 const falseEvidence=await classifier.qualifyWithGroq({text:'Vamos fechar o projeto',fetchFn:async()=>Response.json({choices:[{message:{content:JSON.stringify({interested:true,confidence:0.99,evidence:'Vou pagar amanhã'})}}]})});
 assert.equal(falseEvidence.confirmed,false);
});
test('Normal inbound question gets a single Groq response',async()=>{
 const msg=input({number:'15987771112',body:'Como funciona o site?'});
 const before=sends.length;
 const result=await agent.tickSalesAgent({...fake,qualify:async()=>({confirmed:false,reason:'NOT_CONCRETE'})});
 assert.equal(result.states[0],'SENT');
 assert.equal(sends.length,before+1);
 assert.equal(sends.at(-1).payload.message.text,'Claro! Posso explicar rapidinho como funcionaria?');
 assert.equal(db.one('SELECT COUNT(*) n FROM messages WHERE provider_id=?','groq:'+msg.providerId).n,1);
 assert.equal(agent.queueInboundTurn({providerId:msg.providerId,jid:msg.jid}),false);
});
test('Confirmed buyer causes silent handoff and a unique owner-only WhatsApp notice',async()=>{
 const msg=input({number:'15987771113',body:'Vamos fechar o projeto!'});
 const before=sends.length;
 const result=await agent.tickSalesAgent({...fake,qualify:async()=>({confirmed:true,confidence:0.99,evidence:'Vamos fechar'})});
 assert.equal(result.states[0],'HOT');
 assert.equal(sends.length,before,'No new customer-facing message after interest');
 assert.equal(db.one('SELECT stage FROM leads WHERE id=?',msg.lead.id).stage,'INTERESTED');
 assert.equal(db.one('SELECT manual_takeover FROM threads WHERE lead_id=?',msg.lead.id).manual_takeover,1);
 assert.equal(db.one("SELECT COUNT(*) n FROM owner_notices WHERE kind='GROQ_HOT_LEAD' AND lead_id=?",msg.lead.id).n,1);
 await agent.flushInterestAlerts(fake);
 assert.equal(sends.length,before+1);
 assert.ok(sends.at(-1).route.includes('5515981817336%40s.whatsapp.net'));
 assert.equal(db.one("SELECT status FROM owner_notices WHERE kind='GROQ_HOT_LEAD' AND lead_id=?",msg.lead.id).status,'SENT');
 await agent.flushInterestAlerts(fake);
 assert.equal(sends.length,before+1,'Owner alert must not repeat');
});
test('Unverified apparent interest does not send or notify owner',async()=>{
 input({number:'15987771114',body:'Quero contratar, mas preciso entender as condições'});
 const before=sends.length;
 const res=await agent.tickSalesAgent({...fake,qualify:async()=>({confirmed:false,reason:'AI_UNAVAILABLE'})});
 assert.equal(res.states[0],'REVIEW');
 assert.equal(sends.length,before);
});
test('Interest-only mode silently alerts owner but never auto-responds to customers',async()=>{
 const oldAuto=process.env.AI_CONVERSATION_AUTOSEND,oldAlerts=process.env.PROSPECTOR_INTEREST_ALERTS_ENABLED;
 process.env.AI_CONVERSATION_AUTOSEND='false';process.env.PROSPECTOR_INTEREST_ALERTS_ENABLED='true';
 try{
  const question=input({number:'15987771115',body:'Quanto custa um site?'});
  const before=sends.length;
  const general=await agent.tickSalesAgent({...fake,qualify:async()=>({confirmed:false,reason:'NOT_CONCRETE'})});
  assert.equal(general.states[0],'REVIEW');
  assert.equal(sends.length,before,'an ordinary question must remain for human review');
  const buyer=input({number:'15987771116',body:'Quero contratar esse projeto, podemos começar?'});
  const result=await agent.tickSalesAgent({...fake,qualify:async()=>({confirmed:true,confidence:0.98,evidence:'Quero contratar'})});
  assert.equal(result.states[0],'HOT');
  assert.equal(sends.length,before,'no message should be sent to lead at handoff');
  assert.equal(db.one('SELECT stage FROM leads WHERE id=?',buyer.lead.id).stage,'INTERESTED');
  assert.equal(db.one("SELECT COUNT(*) n FROM owner_notices WHERE lead_id=? AND kind='GROQ_HOT_LEAD'",buyer.lead.id).n,1);
  const sent=await agent.flushInterestAlerts(fake);
  assert.equal(sent,1);
  assert.ok(sends.at(-1).route.includes('5515981817336%40s.whatsapp.net'));
  assert.equal((await agent.flushInterestAlerts(fake)),0);
 }finally{
  process.env.AI_CONVERSATION_AUTOSEND=oldAuto;
  if(oldAlerts===undefined)delete process.env.PROSPECTOR_INTEREST_ALERTS_ENABLED;else process.env.PROSPECTOR_INTEREST_ALERTS_ENABLED=oldAlerts;
 }
});
test.after(()=>{db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
