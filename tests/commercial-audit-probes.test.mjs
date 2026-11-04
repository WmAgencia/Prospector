import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {salesEnding,priceQuestion,prospectSalesContext} from '../dashboard/sales-policy.mjs';
import {reviewGroqReply} from '../dashboard/groq-live-test-guard.mjs';
import {classify} from '../dashboard/classifier.mjs';
import {insideApproachWindow} from '../dashboard/outreach-window.mjs';

// These are non-mutating audit probes, not acceptance tests for the desired
// future policy. Expose the actual current result and classify its risk.
const dir=mkdtempSync(join(tmpdir(),'prospector-offline-policy-'));
process.env.PROSPECTOR_DATA_DIR=dir;
const {greetingForProspect,asksAboutProposal}=await import('../dashboard/prospecting-introduction.mjs');
const {db}=await import('../dashboard/db.mjs');
test.after(()=>{db.close();rmSync(dir,{recursive:true,force:true})});

test('observe the mismatches in real production rule modules, in an isolated SQLite database',()=>{
 const realWorldRefusal='Ah sim, no momento não temos interesse';
 const q='Bom dia Wesley, seria sobre o que?';
 const autoReply='Para que possamos ajudar, informe nome, modelo do carro, ano, motor e defeito.';
 const observations={
  lateRefusal:{recognized:salesEnding(realWorldRefusal)==='NO_INTEREST',result:salesEnding(realWorldRefusal),legacyClass:classify(realWorldRefusal).intent},
  asksProposal:{recognized:asksAboutProposal(q)},
  greeting:{text:greetingForProspect({name:null,business:'Eletrotec - Auto Elétrica | Mecânica | Injeção Eletrônica'},new Date('2026-11-04T12:00:00Z'))},
  autoReply:{state:salesEnding(autoReply),legacyClass:classify(autoReply).intent},
  fixed550:{priceQuestion:priceQuestion('Quanto custa o site?'),guard:reviewGroqReply({inbound:'Quanto custa?',draft:'O preço do site é R$ 550.',allowAveragePrice:true}).code},
  context:{mentionsIndividualPriceApproval:prospectSalesContext({business:'Loja Fictícia',offerType:'portfolio'}).includes('aprovação individual')},
  window:{before:insideApproachWindow(new Date('2026-11-04T10:59:59Z')),open:insideApproachWindow(new Date('2026-11-04T11:00:00Z')),close:insideApproachWindow(new Date('2026-11-04T20:30:00Z'))}
 };
 assert.equal(observations.window.before,false);
 assert.equal(observations.window.open,true);
 assert.equal(observations.window.close,false);
 assert.equal(observations.fixed550.priceQuestion,true);
 assert.ok(observations.greeting.text.startsWith('Olá,'));
 console.log('COMMERCIAL_BASELINE_PROBES',JSON.stringify(observations));
});

test('read-only code inspection detects high-priority conflicting legacy behavior',()=>{
 const read=file=>readFileSync(new URL('../dashboard/'+file,import.meta.url),'utf8');
 const owner=read('owner-price-approvals.mjs');
 const groq=read('groq-sales-automation.mjs');
 const intro=read('prospecting-introduction.mjs');
 const queue=read('prospecting-queue.mjs');
 const source=read('gosom-maps.mjs');
 const flags={
  ownerLegacy350:owner.includes('portfolio:350')||owner.includes('portfólio: R$ 350'),
  ownerLegacy4Days:owner.includes('prazo mínimo: 4 dias')||owner.includes('prazo mínimo de quatro dias'),
  priceBypassesWesleyIntro:intro.includes("['GREETING_SENT','WAITING'].includes(item.stage)&&priceQuestion(body)"),
  aiRequiresOwnerApproval:groq.includes('requestPriceApproval')&&groq.includes('financial?'),
  autonomousQueueOverridesConsent:queue.includes("eligibleLead(lead.id,'',false,true)"),
  mapsBusinessDataNotConsent:source.includes('contact_permission:false'),
  noNaturalAutoReplyDetector:!intro.includes('detectAutoReply')&&!intro.includes('isAutomaticReply')
 };
 console.log('COMMERCIAL_STATIC_RISK_FLAGS',JSON.stringify(flags));
 assert.ok(Object.values(flags).every(x=>typeof x==='boolean'));
});
