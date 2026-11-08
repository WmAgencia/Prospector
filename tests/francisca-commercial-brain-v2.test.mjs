import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'commercial-brain-test-'));
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.GROQ_API_KEY='offline-test-placeholder';
process.env.FRANCISCA_COMMERCIAL_BRAIN_V2_ENABLED='true';
process.env.FRANCISCA_NATURAL_V1_ENABLED='true';
delete process.env.PROSPECTOR_TENANT_ID;
delete process.env.PROSPECTOR_TENANT_INTERNAL;
const c=await import('../dashboard/francisca-commercial-brain.mjs');
const mem=await import('../dashboard/francisca-conversation-state.mjs');
const db=await import('../dashboard/db.mjs');
await import('../dashboard/sales-outcomes.mjs');
const {salesConversionFunnel}=await import('../dashboard/sales-conversion-funnel.mjs');
const {aiDraft}=await import('../dashboard/ai-groq.mjs');

test('feature flag never enables external tenants',()=>{
 assert.equal(c.commercialBrainEnabled({FRANCISCA_COMMERCIAL_BRAIN_V2_ENABLED:'false'}),false);
 assert.equal(c.commercialBrainEnabled({FRANCISCA_COMMERCIAL_BRAIN_V2_ENABLED:'true'}),true);
 assert.equal(c.commercialBrainEnabled({FRANCISCA_COMMERCIAL_BRAIN_V2_ENABLED:'true',PROSPECTOR_TENANT_ID:'client'}),false);
 assert.equal(c.commercialBrainEnabled({FRANCISCA_COMMERCIAL_BRAIN_V2_ENABLED:'true',PROSPECTOR_TENANT_ID:'client',PROSPECTOR_TENANT_INTERNAL:'true'}),true);
});
test('suspiciously cheap offer requires trust response, not discount',()=>{
 const p=c.analyzeCommercialTurn({incoming:'Muito barato, como sei que é confiável?'});
 assert.equal(p.concern,'trust');
 assert.equal(p.stage,'EVALUATION');
 assert.match(c.commercialBrainInstructions({plan:p}),/Nenhum desconto/);
});
test('existing Wix site and slow mobile require actual diagnosis',()=>{
 const p=c.analyzeCommercialTurn({incoming:'Já tenho site no Wix, mas ele demora no celular'});
 assert.equal(p.need,'mobile_performance');
 assert.equal(p.concern,'already_has_solution');
 assert.match(p.nextAction,/Não tente vender outro site/);
});
test('consultative objection handles price without changing terms',()=>{
 const p=c.analyzeCommercialTurn({incoming:'Tá caro, tem desconto?'});
 assert.equal(p.concern,'budget');
 assert.match(c.commercialBrainInstructions({plan:p}),/escute a preocupação concreta/);
 assert.equal(p.canPromisePayment,false);
});
test('busy customer and decision maker get room, not another question',()=>{
 for(const sentence of ['Tô ocupado, tô atendendo agora','Vou falar com meu sócio']){
  const p=c.analyzeCommercialTurn({incoming:sentence});
  assert.equal(p.question,'NONE',sentence);
 }
});
test('refusal and handoff take precedence over selling',()=>{
 assert.equal(c.analyzeCommercialTurn({incoming:'Não me mande mais mensagem'}).stage,'CLOSED_DECLINED');
 assert.equal(c.analyzeCommercialTurn({incoming:'Quero falar com atendente humano'}).stage,'HUMAN_REVIEW');
});
test('contracting signal is not payment verification nor authorization to send',()=>{
 const p=c.analyzeCommercialTurn({incoming:'Quero fechar, como eu pago?'});
 assert.equal(p.stage,'READY_TO_CLOSE');
 assert.equal(p.canContact,false);
 assert.equal(p.canSendFollowup,false);
 assert.equal(p.canPromisePayment,false);
});
test('commercial memory stores only categorical information, no phone or raw client text',()=>{
 const state=mem.nextConversationState({},[
  {direction:'in',body:'Meu site demora no celular. Contato 5515999001122.'},
  {direction:'out',body:'Podemos analisar o tempo de carregamento.'},
  {direction:'in',body:'Vou falar com meu sócio e retorno.'}
 ]);
 assert.equal(state.need,'mobile_performance');
 assert.equal(state.concern,'decision_maker');
 assert.equal(state.lastCommercialStage,'DECISION_PENDING');
 assert.ok(!JSON.stringify(state).includes('5515999001122'));
 assert.match(mem.memoryPrompt(state),/Necessidade comercial categorizada/);
});
test('only verified approved relevant HTTPS portfolio may be suggested',()=>{
 const approved=[
  {kind:'portfolio',approved:true,title:'Oficina Teste',description:'site para oficina',url:'https://example.com/oficina'},
  {kind:'portfolio',approved:false,title:'Oficina Não Aprovada',description:'oficina',url:'https://example.com/invalido'},
  {kind:'portfolio',approved:true,title:'Buffet',description:'festas',url:'https://example.com/buffet'},
  {kind:'portfolio',approved:true,title:'Inseguro',description:'oficina',url:'http://example.com/inseguro'}
 ];
 assert.equal(c.selectApprovedProof({incoming:'Tem portfólio de oficina?',segment:'oficina',approved})?.title,'Oficina Teste');
 assert.equal(c.selectApprovedProof({incoming:'Quanto custa?',segment:'oficina',approved}),null);
 assert.equal(c.selectApprovedProof({incoming:'Mostre portfólio',segment:'clínica',approved:[approved[2]]}),null);
});
test('handoff brief is factual and does not copy raw customer speech',()=>{
 const p=c.analyzeCommercialTurn({incoming:'Vou falar com meu sócio'});
 const txt=c.commercialHandoffSummary({plan:p,memory:{offerExplained:true},business:'Oficina Teste'});
 assert.match(txt,/Oficina Teste/);
 assert.match(txt,/não é venda nem pagamento confirmado/);
 assert.doesNotMatch(txt,/Vou falar com meu sócio/);
});
test('actual Groq draft request uses commercial strategies only on authorized prospects',async()=>{
 let captured;
 const mock=async data=>{captured=data;return {model:'MOCK',choice:{content:'Se o seu site atual já funciona, podemos avaliar a lentidão no celular.'}}};
 const res=await aiDraft({text:'Meu site no Wix demora no celular',audience:'PROSPECT_APPROACHED',
  dialogueState:{hasAssistantReply:true,salesMemory:{offerExplained:true,need:'mobile_performance'}},chat:mock});
 assert.equal(res.ok,true);
 assert.equal(res.commercialBrain,true);
 assert.equal(res.autoSend,false);
 assert.match(captured.messages[0].content,/MOTOR COMERCIAL V2/);
 assert.match(captured.messages[0].content,/já foi explicada/);
 const other=await aiDraft({text:'Pode me ajudar?',audience:'EXISTING_CLIENT',chat:mock});
 assert.equal(other.commercialBrain,false);
 assert.doesNotMatch(captured.messages[0].content,/MOTOR COMERCIAL V2/);
});
test('flag-off rollback keeps existing behavior',async()=>{
 process.env.FRANCISCA_COMMERCIAL_BRAIN_V2_ENABLED='false';
 let input;try{
  const result=await aiDraft({text:'Quanto fica?',audience:'PROSPECT_APPROACHED',chat:async x=>(input=x,{model:'MOCK',choice:{content:'Vou conferir as condições aprovadas.'}})});
  assert.equal(result.commercialBrain,false);
  assert.doesNotMatch(input.messages[0].content,/MOTOR COMERCIAL V2/);
 }finally{process.env.FRANCISCA_COMMERCIAL_BRAIN_V2_ENABLED='true';}
});
test('funnel has true unique contacted cohort, excludes bot replies and unconfirmed sends',()=>{
 const make=(name,number,status)=>{
  const lead=db.addLead({business:name,phone:number,source:'TEST',contact_permission:true}).lead;
  db.run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',lead.id,number,status,'job-'+name,db.now());
  const id=db.id();
  db.run('INSERT INTO threads(id,lead_id,jid,created_at) VALUES(?,?,?,?)',id,lead.id,number+'@s.whatsapp.net',db.now());
  return {lead,id};
 };
 const add=(thread,body)=>db.run('INSERT INTO messages(id,thread_id,provider_id,direction,type,body,status,at) VALUES(?,?,?,?,?,?,?,?)',db.id(),thread,db.id(),'in','text',body,'RECEIVED',db.now());
 const a=make('Funnel A','5515999554401','SENT'),b=make('Funnel B','5515999554402','SENT'),
  automated=make('Funnel Auto','5515999554403','SENT'),queued=make('Funnel Q','5515999554404','QUEUED');
 add(a.id,'Quero fechar um site, por favor.');
 add(b.id,'Já tenho site, mas está lento.');
 add(automated.id,'Mensagem automática: digite 1 para atendimento.');
 add(queued.id,'Quero contratar.');
 db.run("UPDATE leads SET stage='CLOSED_WON' WHERE id=?",a.lead.id);
 db.run('INSERT INTO sales_outcomes(lead_id,status,source,provider_id,summary,updated_at) VALUES(?,?,?,?,?,?)',a.lead.id,'CLOSED_WON','TEST','','Venda fictícia confirmada',db.now());
 db.run('CREATE TABLE IF NOT EXISTS sales_payment_intents(lead_id TEXT PRIMARY KEY,status TEXT NOT NULL)');
 db.run('INSERT INTO sales_payment_intents(lead_id,provider_id,session_id,amount_cents,entry_cents,remaining_cents,method,status,requested_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',a.lead.id,'intent-test-1','session-test',55000,27500,27500,'pix','PAYMENT_VERIFIED',db.now(),db.now());
 const f=salesConversionFunnel();
 assert.equal(f.delivered,3);
 assert.equal(f.replied,2);
 assert.equal(f.qualified,1);
 assert.equal(f.proposed,1);
 assert.equal(f.won,1);
 assert.equal(f.ratios.replyPct,66.67);
 assert.equal(f.ratios.wonFromDeliveredPct,33.33);
});
test('quality suggestions require sufficient evidence',()=>{
 const x=c.qualityRecommendations({delivered:5,replied:0,qualified:0,ratios:{replyPct:0,qualifiedFromRepliedPct:null,wonFromQualifiedPct:null}});
 assert.equal(x.length,1);
 assert.match(x[0],/causalidade/);
});
test.after(()=>{try{db.db.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
