import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/price-approval-');
process.env.PROSPECTOR_OWNER_PHONE='5515981817336';
process.env.PROSPECTOR_PERSONAL_PHONE='5515981817336';
process.env.WA_AKG_SESSION_ID='price-session';
const d=await import('../dashboard/db.mjs');
const p=await import('../dashboard/owner-price-approvals.mjs');
let seq=0;
function fixture(){
 const lead=d.addLead({business:'Empresa '+(++seq),phone:'551599990'+String(seq).padStart(4,'0'),contact_permission:true}).lead;
 d.audit('CONSENT_UPDATED',lead.id,{permitted:true,evidence:'test authorization'});
 d.getThread(lead.id,lead.phone+'@s.whatsapp.net');
 return lead;
}
const event=(request,text='350')=>({jid:'5515981817336@s.whatsapp.net',sessionId:'price-session',providerId:'decision-'+request.id,text:'PRECO '+request.id+' '+text});
const deps=(send=async()=>({status:true}))=>({getStatus:async()=>({connected:true,sessionId:'price-session'}),transmit:send,getSessionIdentity:async()=> '5515999999999@s.whatsapp.net'});
test('request idempotency, owner buttons and confirmation links carry request only',async()=>{
 const lead=fixture(),input={leadId:lead.id,providerId:'q1',question:'Quanto custa?',sessionId:'price-session'};
 const a=p.requestPriceApproval(input),b=p.requestPriceApproval(input);
 assert.equal(a.request.id,b.request.id);
 const calls=[];await p.flushPriceApprovals(deps(async(path,args)=>{calls.push({path,...args});return {status:true};}));
 assert.equal(calls.length,2);assert.match(calls[0].path,/send$/);assert.match(calls[1].path,/interactive$/);
 assert.deepEqual(calls[1].data.buttons.map(b=>b.displayText),['R$ 350','R$ 550','R$ 1500']);
 assert.match(calls[0].data.message.text,/wa.me\/5515999999999\?text=/);
 assert.match(calls[0].data.message.text,/Quanto custa/);
});
test('only full owner in selected session can consume; quote exact and once',async()=>{
 const lead=fixture(),{request}=p.requestPriceApproval({leadId:lead.id,providerId:'q2',question:'Valor?'});
 let calls=0;const transport=deps(async(path,args)=>{calls++;assert.match(args.data.message.text,/R\$ 550/);assert.match(args.data.message.text,/R\$ 275/);assert.match(args.data.message.text,/mínimo.*4 dias/);return {status:true};});
 assert.equal((await p.processPriceDecision({...event(request),jid:'5515999997336@s.whatsapp.net'},transport)).ok,false);
 assert.equal((await p.processPriceDecision({...event(request),sessionId:'other'},transport)).ok,false);
 assert.equal((await p.processPriceDecision(event(request,'550'),transport)).ok,true);
 await p.processPriceDecision(event(request,'1500'),transport);assert.equal(calls,1);
 assert.equal(p.approvedPriceForLead(lead.id),550);
});
test('suppression, takeover, expiry and UNKNOWN prevent customer quote',async()=>{
 for(const mode of ['suppression','takeover','expiry','unknown']){
  const lead=fixture(),{request}=p.requestPriceApproval({leadId:lead.id,providerId:'q-'+mode,question:'Valor?'});
  if(mode==='suppression')d.run('INSERT INTO suppressions(phone,reason,created_at) VALUES(?,?,?)',lead.phone,'no',d.now());
  if(mode==='takeover')d.run('UPDATE threads SET manual_takeover=1 WHERE lead_id=?',lead.id);
  if(mode==='expiry')d.run("UPDATE owner_price_approvals SET expires_at='2000-01-01T00:00:00Z' WHERE id=?",request.id);
  if(mode==='unknown')d.run("UPDATE owner_price_approvals SET state='UNKNOWN' WHERE id=?",request.id);
  let count=0;await p.processPriceDecision(event(request),deps(async()=>{count++;return {status:true};}));assert.equal(count,0);
 }
});
test('uncertain notification and quote never retry',async()=>{
 const lead=fixture(),{request}=p.requestPriceApproval({leadId:lead.id,providerId:'timeout',question:'Valor?'});
 let count=0;const bad=deps(async()=>{count++;throw Error('timeout');});
 await p.flushPriceApprovals(bad);await p.flushPriceApprovals(bad);assert.equal(count,1);
 await p.processPriceDecision(event(request),bad);await p.processPriceDecision(event(request),bad);assert.equal(count,2);
 assert.equal(p.approvedPriceForLead(lead.id),null);
});
test('native choice is bound to one lead, concurrent clicks reserve once',async()=>{
 const a=fixture(),b=fixture();
 const ra=p.requestPriceApproval({leadId:a.id,providerId:'parallel-a',question:'Preço?'}).request;
 const rb=p.requestPriceApproval({leadId:b.id,providerId:'parallel-b',question:'Preço?'}).request;
 const calls=[];const transport=deps(async(path,args)=>{calls.push({path,args});await new Promise(resolve=>setImmediate(resolve));return {status:true};});
 await Promise.all([p.processPriceDecision({...event(ra),text:'preco:'+ra.id+':1500'},transport),p.processPriceDecision({...event(ra),providerId:'other-click'},transport)]);
 assert.equal(calls.length,1);assert.ok(calls[0].path.includes(encodeURIComponent(a.phone+'@s.whatsapp.net')));
 assert.match(calls[0].args.data.message.text,/R\$ 750/);assert.equal(p.approvedPriceForLead(b.id),null);
 assert.equal(d.one('SELECT state FROM owner_price_approvals WHERE id=?',rb.id).state,'PENDING');
});
test('sandbox owner, changed session and existing client cannot authorize',async()=>{
 const lead=fixture(),{request}=p.requestPriceApproval({leadId:lead.id,providerId:'sandbox',question:'Valor?'});
 process.env.PROSPECTOR_LIVE_TEST_ENABLED='true';process.env.PROSPECTOR_LIVE_TEST_PHONE='5515981817336';
 let calls=0;const transport=deps(async()=>{calls++;return {status:true};});
 assert.equal((await p.processPriceDecision(event(request),transport)).ok,false);
 process.env.PROSPECTOR_LIVE_TEST_ENABLED='false';
 d.run("INSERT INTO contact_relationships(phone,kind,evidence,source,updated_at) VALUES(?,'EXISTING_CLIENT','known','test',?)",lead.phone,d.now());
 assert.equal((await p.processPriceDecision(event(request),transport)).ok,false);assert.equal(calls,0);
});
test('reject and handoff consume approvals without sending quote',async()=>{
 for(const choice of ['RECUSAR','ASSUMIR']){
  const lead=fixture(),{request}=p.requestPriceApproval({leadId:lead.id,providerId:'choice-'+choice,question:'Preço?'});
  const result=await p.processPriceDecision(event(request,choice),deps(async()=>{throw Error('Must not send');}));
  assert.equal(result.ok,true);assert.equal(result.state,choice==='RECUSAR'?'REJECTED':'HANDOFF');
  assert.equal(p.approvedPriceForLead(lead.id),null);
  if(choice==='ASSUMIR')assert.equal(d.one('SELECT manual_takeover FROM threads WHERE lead_id=?',lead.id).manual_takeover,1);
 }
});
test('a newer customer message invalidates an old approval and a new question creates a fresh request',async()=>{
 const lead=fixture(),thread=d.getThread(lead.id);
 d.addMessage({threadId:thread.id,providerId:'scoped-first',direction:'in',body:'Quanto custa o site simples?'});
 const first=p.requestPriceApproval({leadId:lead.id,providerId:'scoped-first',question:'Quanto custa o site simples?'}).request;
 d.addMessage({threadId:thread.id,providerId:'scoped-new',direction:'in',body:'Agora quero uma loja com pagamento. Qual valor?'});
 let sent=0;
 assert.equal((await p.processPriceDecision(event(first),deps(async()=>{sent++;return {status:true};}))).ok,false);
 const fresh=p.requestPriceApproval({leadId:lead.id,providerId:'scoped-new',question:'Agora quero uma loja com pagamento. Qual valor?'}).request;
 assert.notEqual(fresh.id,first.id);assert.equal(sent,0);
});
