import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/sales-owner-flow-');
process.env.WA_AKG_SESSION_ID='synthetic';
process.env.PROSPECTOR_OWNER_PHONE='5515981817336';
process.env.PROSPECTOR_PERSONAL_PHONE='5515981817336';
process.env.AI_CONVERSATION_AUTOSEND='false';
process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED='false';
const d=await import('../dashboard/db.mjs');
const q=await import('../dashboard/prospecting-queue.mjs');
const b=await import('../dashboard/waakg-bridge.mjs');
const a=await import('../dashboard/groq-sales-automation.mjs');
const p=await import('../dashboard/owner-price-approvals.mjs');
const intro=await import('../dashboard/prospecting-introduction.mjs');
let sequence=0,time=Date.now();const delivered=[];
const send=async(route,opts)=>{delivered.push({route,...opts.data});return {status:true};};
const status=async()=>({connected:true,sessionId:'synthetic'});
const deps={status,send,draft:async()=>({ok:true,draft:'Criamos um site para apresentar seus serviços. Qual é sua principal necessidade?'}),qualify:async()=>({confirmed:false})};
function incoming(lead,text){const providerId='synthetic:'+ ++sequence;b.recordInboundTranscript({sessionId:'synthetic',jid:lead.phone+'@s.whatsapp.net',unique:providerId,content:text});return providerId;}
test('multiple selected public businesses independently reply, approve a quote and hand off',async()=>{
 const leads=['Padaria Aurora','Oficina Horizonte','Clínica Campo'].map((business,i)=>d.addLead({business,phone:'55119990000'+String(i+10),source:'MANUAL',website:'https://example.org/'+i,instagram:'synthetic_business_'+i}).lead);
 assert.equal(q.enqueueApprovedApproaches({leadIds:leads.map(x=>x.id),approve:true,operatorApproved:true}).body.queued,3);
 for(let index=0;index<leads.length;index++){
  assert.equal((await q.tickApproachQueue({currentTime:()=>time,getWaStatus:status,getSession:()=> 'synthetic',send})).status,'SENT');time+=90000;
  const lead=leads.find(x=>decodeURIComponent(delivered.at(-1).route).includes(x.phone));
  assert.ok(lead);
  incoming(lead,'Oi, pode falar');
  const due=Date.parse(intro.introductionStatus(lead.id).due_at);
  assert.equal((await intro.tickIntroductions({currentTime:()=>due,session:()=> 'synthetic',status,send})).state,'SENT');
  const ordinary=incoming(lead,'Sim, pode explicar');
  assert.equal((await a.handleSalesTurn(ordinary,deps)).state,'SENT');
 }
 await q.tickApproachQueue({currentTime:()=>time});
 for(const [i,lead] of leads.entries()){
  const before=delivered.length,question=incoming(lead,'Quanto custa? Pode parcelar?');
  assert.equal((await a.handleSalesTurn(question,{...deps,qualify:async()=>{throw Error('No qualification on price');},draft:async()=>{throw Error('No draft on price');}})).state,'SENT');
  assert.equal(delivered.length,before+1);assert.doesNotMatch(delivered.at(-1).message.text,/R\$|350|550|1500/);
  const request=d.one('SELECT * FROM owner_price_approvals WHERE lead_id=?',lead.id);
  assert.ok(request);const price=[350,550,1500][i];
  const decision=await p.processPriceDecision({jid:'5515981817336@s.whatsapp.net',sessionId:'synthetic',providerId:'choice-'+i,text:'PRECO '+request.id+' '+price},{getStatus:status,transmit:send});
  assert.equal(decision.ok,true);assert.match(delivered.at(-1).message.text,new RegExp('R\\$ '+price));
  assert.ok(delivered.at(-1).route.includes(lead.phone));assert.equal(p.approvedPriceForLead(lead.id),price);
  const buy=incoming(lead,'Quero contratar esse projeto');
  assert.equal((await a.handleSalesTurn(buy,{...deps,qualify:async()=>({confirmed:true,evidence:'Quero contratar esse projeto',confidence:.99})})).state,'HOT');
  const notice=d.one("SELECT message FROM owner_notices WHERE kind='GROQ_HOT_LEAD' AND lead_id=?",lead.id).message;
  assert.ok(notice.includes(lead.business));assert.ok(notice.includes('https://wa.me/'+lead.phone));assert.ok(notice.includes(lead.website));assert.doesNotMatch(notice,/Referência de site/);
  assert.equal(d.one('SELECT manual_takeover FROM threads WHERE lead_id=?',lead.id).manual_takeover,1);
 }
 assert.equal(d.one('SELECT COUNT(*) n FROM leads WHERE contact_permission=1').n,0);
});
test('a price question in the first reply reaches owner approval without requiring a second question',async()=>{
 const lead=d.addLead({business:'Empresa que pergunta logo o preço',phone:'5511999888877'}).lead;
 assert.equal(q.enqueueApprovedApproaches({leadIds:[lead.id],approve:true,operatorApproved:true}).status,202);
 time+=90000;
 assert.equal((await q.tickApproachQueue({currentTime:()=>time,getWaStatus:status,getSession:()=> 'synthetic',send})).status,'SENT');
 const pid=incoming(lead,'Qual o valor para o site?');
 assert.ok(d.one('SELECT 1 FROM groq_auto_events WHERE provider_id=?',pid));
 assert.equal((await a.handleSalesTurn(pid,deps)).state,'SENT');
 assert.ok(d.one('SELECT id FROM owner_price_approvals WHERE lead_id=?',lead.id));
});
test.after(()=>{d.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
