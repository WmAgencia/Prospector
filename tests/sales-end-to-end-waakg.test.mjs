import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/prospector-full-sales-');
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.GROQ_API_KEY='test-only-never-call-network';
process.env.AI_CONVERSATION_AUTOSEND='false';
process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED='false';
process.env.PROSPECTOR_INTEREST_ALERTS_ENABLED='false';
const db=await import('../dashboard/db.mjs');
const {enqueueApprovedApproaches,tickApproachQueue,approachQueueStatus}=await import('../dashboard/prospecting-queue.mjs');
const {recordInboundTranscript}=await import('../dashboard/waakg-bridge.mjs');
const {tickIntroductions,introductionStatus,WESLEY_INTRO,asksAboutProposal}=await import('../dashboard/prospecting-introduction.mjs');
const {handleSalesTurn}=await import('../dashboard/groq-sales-automation.mjs');
const {salesOutcomes}=await import('../dashboard/sales-outcomes.mjs');
const {agentStatus}=await import('../dashboard/groq-sales-automation.mjs');
const {reviewGroqReply}=await import('../dashboard/groq-live-test-guard.mjs');
const {salesEnding,isExplicitOptOut,SITE_AVERAGE_PRICE_BRL,approvedAveragePriceDraft}=await import('../dashboard/sales-policy.mjs');
const {dailyReport}=await import('../dashboard/notifications.mjs');
const now=new Date('2026-10-29T18:00:00Z').getTime();
let time=now;
const sent=[];
const sendDeps={currentTime:()=>time,getWaStatus:async()=>({connected:true,sessionId:'consecom-principal'}),
 getSession:()=> 'consecom-principal',send:async(route,options)=>{sent.push({route,text:options.data.message.text});return {status:true};}};
const nextPhone=(()=>{let i=0;return ()=>String(5515999660010+i++);})();
function eligible(name){
 const l=db.addLead({business:name,phone:nextPhone(),city:'Sorocaba',segment:'oficina mecânica',source:'osm',contact_permission:true}).lead;
 db.audit('CONSENT_UPDATED',l.id,{permitted:true,evidence:'opt-in verificado no cenário de teste local'});
 return l;
}
test('Prospector queues only documented opt-in and enables scoped follow-up',()=>{
 const lead=eligible('Auto Center Integração');
 const publicLead=db.addLead({business:'Oficina Pública',phone:nextPhone(),source:'osm',contact_permission:false}).lead;
 const result=enqueueApprovedApproaches({leadIds:[lead.id,publicLead.id],approve:true});
 assert.equal(result.status,202);
 assert.equal(result.body.queued,1);
 assert.equal(result.body.excluded,1);
 assert.equal(agentStatus().approvedProspectFollowup,true);
 assert.equal(agentStatus().enabled,false);
});
test('Approved button queue sends once, reply enters Groq and responds naturally',async()=>{
 const send=await tickApproachQueue(sendDeps);
 assert.equal(send.status,'SENT');
 assert.equal(sent.length,1);
 const lead=db.one("SELECT id,phone FROM leads WHERE business='Auto Center Integração'");
 db.run("UPDATE prospecting_introductions SET stage='CONVERSING' WHERE lead_id=?",lead.id); // Prior introduction already finished in this legacy sales regression scenario.
 const inbound='Quanto custa o site? Vocês fazem agendamento?';
 const reply=recordInboundTranscript({sessionId:'consecom-principal',jid:lead.phone+'@s.whatsapp.net',
 unique:'consecom-principal:fullsales-1',content:inbound});
 assert.equal(reply.status,200);
 assert.equal(db.one('SELECT stage FROM leads WHERE id=?',lead.id).stage,'CONVERSING');
 assert.equal(db.one("SELECT state FROM groq_auto_events WHERE provider_id='consecom-principal:fullsales-1'").state,'PENDING');
 let draftContext='',sentText='';
 const a=await handleSalesTurn('consecom-principal:fullsales-1',{
  qualify:async()=>({confirmed:false,reason:'NO_COMMITMENT'}),
  status:async()=>({connected:true,sessionId:'consecom-principal'}),
  draft:async(x)=>{draftContext=x.context;return {ok:true,draft:'O preço médio de referência do site é R$ 550, dependendo do escopo. Agendamento pode ser avaliado com a equipe.'};},
  send:async(_route,{data})=>{sentText=data.message.text;return {status:true};}
 });
 assert.equal(a.state,'SENT');
 assert.match(draftContext,/R\$ 550/);
 assert.match(sentText,/R\$ 550/);
 assert.equal(db.one('SELECT COUNT(*) n FROM sales_outcomes').n,0);
 assert.equal((await tickApproachQueue(sendDeps)).status,'COMPLETED');
});
test('A hard refusal is terminal, not queued for more AI replies',async()=>{
 const lead=eligible('Estética que recusou');
 assert.equal(enqueueApprovedApproaches({leadIds:[lead.id],approve:true}).status,202);
 time+=90_000;assert.equal((await tickApproachQueue(sendDeps)).status,'SENT');
 const out=recordInboundTranscript({sessionId:'consecom-principal',jid:lead.phone+'@s.whatsapp.net',
 unique:'consecom-principal:fullsales-2',content:'Sem interesse, obrigada.'});
 assert.equal(out.status,200);
 assert.equal(db.one('SELECT stage FROM leads WHERE id=?',lead.id).stage,'NO_INTEREST');
 assert.equal(introductionStatus(lead.id).stage,'CANCELLED');
 assert.equal(db.one('SELECT status FROM sales_outcomes WHERE lead_id=?',lead.id).status,'NO_INTEREST');
 assert.equal(db.one("SELECT COUNT(*) n FROM groq_auto_events WHERE provider_id='consecom-principal:fullsales-2'").n,0);
 assert.equal(db.one("SELECT COUNT(*) n FROM owner_notices WHERE lead_id=? AND kind='SALES_OUTCOME'",lead.id).n,1);
 assert.equal((await tickApproachQueue(sendDeps)).status,'COMPLETED');
});
test('Explicit interest transfers to human and records the result once',async()=>{
 const lead=eligible('Padaria interessada');
 assert.equal(enqueueApprovedApproaches({leadIds:[lead.id],approve:true}).status,202);
 time+=90_000;assert.equal((await tickApproachQueue(sendDeps)).status,'SENT');
 db.run("UPDATE prospecting_introductions SET stage='CONVERSING' WHERE lead_id=?",lead.id); // Mature conversation from prior introduction.
 const incoming='Quero fechar um site, podemos começar?';
 recordInboundTranscript({sessionId:'consecom-principal',jid:lead.phone+'@s.whatsapp.net',
  unique:'consecom-principal:fullsales-3',content:incoming});
 const answer=await handleSalesTurn('consecom-principal:fullsales-3',{
  qualify:async()=>({confirmed:true,confidence:0.96,evidence:'Quero fechar um site'})
 });
 assert.equal(answer.state,'HOT');
 assert.equal(db.one('SELECT stage FROM leads WHERE id=?',lead.id).stage,'INTERESTED');
 assert.equal(db.one('SELECT manual_takeover FROM threads WHERE lead_id=?',lead.id).manual_takeover,1);
 assert.equal(db.one('SELECT status FROM sales_outcomes WHERE lead_id=?',lead.id).status,'INTERESTED');
 assert.equal(db.one("SELECT COUNT(*) n FROM owner_notices WHERE lead_id=? AND kind='GROQ_HOT_LEAD'",lead.id).n,1);
 assert.equal((await handleSalesTurn('consecom-principal:fullsales-3',{})).state,'SKIP');
 assert.equal((await tickApproachQueue(sendDeps)).status,'COMPLETED');
});
test('Preferring text to audio does not create an opt-out or stop the sale',()=>{
 assert.equal(salesEnding('Não quero áudio, prefiro mensagem por escrito'),null);
 assert.equal(isExplicitOptOut('Não quero áudio, prefiro texto'),false);
 assert.equal(isExplicitOptOut('Não quero receber mensagens'),true);
 assert.equal(salesEnding('Não quero um site'), 'NO_INTEREST');
 const l=eligible('Cliente com preferência de texto');
 const stamp=db.now();
 db.run("INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)",
  l.id,l.phone,'SENT',db.id(),stamp);
 const got=recordInboundTranscript({sessionId:'consecom-principal',jid:l.phone+'@s.whatsapp.net',
  unique:'consecom-principal:fullsales-4',content:'Não quero áudio, só texto por favor.'});
 assert.equal(got.status,200);
 assert.equal(db.one('SELECT stage FROM leads WHERE id=?',l.id).stage,'CONVERSING');
 assert.equal(db.one('SELECT COUNT(*) n FROM suppressions WHERE phone=?',l.phone).n,0);
 assert.equal(db.one("SELECT state FROM groq_auto_events WHERE provider_id='consecom-principal:fullsales-4'").state,'PENDING');
});
test('Results can be read by UI; daily report counts the new WA-AKG queue',()=>{
 const statuses=salesOutcomes();
 assert.equal(statuses.priceReferenceBrl,550);
 assert.equal(statuses.counts.NO_INTEREST,1);
 assert.equal(statuses.counts.INTERESTED,1);
 const campaign=dailyReport('2026-10-29');
 assert.equal(campaign.approached,3);
 const actualDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const results=dailyReport(actualDay);
 assert.equal(results.interested,1);
 assert.equal(results.notInterested,1);
});
test('Only explicitly qualified R$550 is safe: old campaign price and guarantees stay blocked',()=>{
 assert.equal(SITE_AVERAGE_PRICE_BRL,550);
 assert.equal(salesEnding('Não quero receber mensagens'),'OPT_OUT');
 assert.equal(salesEnding('Quanto custa?'),null);
 const good='O valor médio de referência é R$ 550, dependendo do escopo.';
 assert(approvedAveragePriceDraft('Qual é o preço?',good));
 assert.equal(reviewGroqReply({inbound:'Quanto custa?',draft:good,allowAveragePrice:true}).ok,true);
 assert.equal(reviewGroqReply({inbound:'Quanto custa?',draft:good,allowAveragePrice:false}).ok,false);
 assert.equal(reviewGroqReply({inbound:'Quanto custa?',draft:'Só R$ 350, desconto de 80%',allowAveragePrice:true}).ok,false);
});
test('Named greeting waits for reply, sends Wesley exactly after 30s and transfers proposal to Francisca',async()=>{
 const lead=eligible('Mecânica Silva');
 assert.equal(enqueueApprovedApproaches({leadIds:[lead.id],approve:true}).status,202);
 time+=90_000;
 assert.equal((await tickApproachQueue(sendDeps)).status,'SENT');
 assert.equal(sent.at(-1).text,'Olá, Mecânica Silva, tudo bem?');
 assert.equal(introductionStatus(lead.id).stage,'GREETING_SENT');
 const incoming=recordInboundTranscript({sessionId:'consecom-principal',jid:lead.phone+'@s.whatsapp.net',
  unique:'consecom-principal:proposed-greeting-1',content:'Oi, tudo bem!'});
 assert.equal(incoming.status,200);
 const intro=introductionStatus(lead.id);
 assert.equal(intro.stage,'WAITING');
 assert.equal(Date.parse(intro.due_at)-Date.parse(intro.first_reply_at),30000);
 assert.equal(db.one("SELECT COUNT(*) n FROM groq_auto_events WHERE provider_id='consecom-principal:proposed-greeting-1'").n,0);
 const due=Date.parse(intro.due_at),delivered=[];
 const dependencies={session:()=> 'consecom-principal',status:async()=>({connected:true}),
  send:async(url,opts)=>{delivered.push(opts.data.message.text);return {status:true};}};
 assert.equal((await tickIntroductions({...dependencies,currentTime:()=>due-1})).state,'IDLE');
 assert.equal(delivered.length,0);
 assert.equal((await tickIntroductions({...dependencies,currentTime:()=>due})).state,'SENT');
 assert.deepEqual(delivered,[WESLEY_INTRO]);
 assert.equal(WESLEY_INTRO,"Meu nome é Wesley, sou dono da agência Consecom. Eu tô entrando em contato porque queria fazer uma proposta pra vocês.");
 assert.equal((await tickIntroductions({...dependencies,currentTime:()=>due+30000})).state,'IDLE');
 assert.equal(delivered.length,1);
 assert.equal(asksAboutProposal('Ah, sobre o que se trata a proposta?'),true);
 recordInboundTranscript({sessionId:'consecom-principal',jid:lead.phone+'@s.whatsapp.net',
  unique:'consecom-principal:proposed-greeting-2',content:'Ah, sobre o que se trata a proposta?'});
 assert.equal(introductionStatus(lead.id).stage,'CONVERSING');
 assert.equal(db.one("SELECT state FROM groq_auto_events WHERE provider_id='consecom-principal:proposed-greeting-2'").state,'PENDING');
 let seenContext='',sentMessage='';
 const response=await handleSalesTurn('consecom-principal:proposed-greeting-2',{
  qualify:async()=>({confirmed:false}),
  status:async()=>({connected:true,sessionId:'consecom-principal'}),
  draft:async(args)=>{seenContext=args.context;return {ok:true,draft:'Sou a Francisca, assistente virtual da Consecom. Criamos sites profissionais para empresas. Posso entender sua necessidade?'};},
  send:async(route,options)=>{sentMessage=options.data.message.text;return {status:true};}
 });
 assert.equal(response.state,'SENT');
 assert.match(seenContext,/Francisca/);
 assert.match(sentMessage,/Sou a Francisca/);
 assert.equal((await tickApproachQueue(sendDeps)).status,'COMPLETED');
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
