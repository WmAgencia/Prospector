import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SCENARIOS,LAB_TRANSPORT,offerFacts,deliveryDate,makeScriptedCustomerAgent,makePolicyFranciscaAgent,runScenario,runMatrix,assessConversation,makeGroqAgent} from '../dashboard/simulation/dual-agent-lab.mjs';

test('calendar-based delivery math never mistakes today+3 days for portfolio deadline',()=>{
 assert.equal(deliveryDate('2026-11-04'),'7 de novembro de 2026');
 assert.equal(deliveryDate('2026-11-10'),'13 de novembro de 2026');
 assert.equal(deliveryDate('2026-12-30'),'2 de janeiro de 2027');
 assert.deepEqual(offerFacts().discountPercentRange,[79.6,81.7]);
 assert.equal(offerFacts().price,550);
 assert.equal(offerFacts().domainIncludedMonths,12);
});

test('current-policy baseline: two synthetic agents run 16 independent WhatsApp-free rehearsals',async()=>{
 const matrix=await runMatrix();
 assert.equal(matrix.transport,LAB_TRANSPORT);
 assert.equal(matrix.scenarios,16);
 assert.ok(matrix.failures>=3,'Current commercial script should expose known regressions');
 assert.ok(matrix.outcomes.every(x=>x.assessment.safety.whatsappCalls===0&&x.assessment.safety.contactsRead===0));
 const checks=Object.fromEntries(matrix.outcomes.map(x=>[x.scenario,x.assessment]));
 assert.ok(checks['eletrotec-question'].errors.includes('MISSING_FIXED_OFFER_AFTER_PROPOSAL_REQUEST'));
 assert.ok(checks['price-only'].errors.includes('UNNECESSARY_OWNER_PRICE_APPROVAL'));
 assert.ok(checks['autoresponder'].errors.includes('AUTORESPONDER_SHOULD_NOT_TRIGGER_OUTREACH'));
 assert.equal(checks['explicit-refusal'].passes,true,'Current inbound policy correctly suppresses a direct refusal');
 assert.equal(checks['optout'].passes,true,'Current inbound policy correctly suppresses explicit opt-out');
 console.log('LAB_BASELINE_OFFLINE',JSON.stringify({total:matrix.scenarios,passed:matrix.passes,failed:matrix.failures,failures:matrix.outcomes.filter(x=>!x.assessment.passes).map(x=>({scenario:x.scenario,problems:x.assessment.errors}))}));
});

test('agents exchange contextual messages with no actual send side effect',async()=>{
 const scenario=SCENARIOS.find(x=>x.id==='buffet-offer');
 let clientCalls=0,salesCalls=0;
 const customer={role:'CUSTOMER',async respond({turn,turns}){clientCalls++;assert.equal(turns[0].role,'CONSECOM_GREETING');return scenario.turns[turn]??null;}};
 const sales={role:'FRANCISCA',async respond({turn,inbound,turns}){salesCalls++;assert.equal(turns.at(-1).text,inbound);return {text:turn===0?'Fazemos um site para os serviços do seu buffet, por R$ 550.':'O domínio é pago por 1 ano e a entrega prevista é em 3 dias.'};}};
 const r=await runScenario({scenario,customerAgent:customer,franciscaAgent:sales});
 assert.equal(clientCalls,3);
 assert.equal(salesCalls,2);
 assert.equal(r.transcript.length,5);
 assert.equal(r.mode,LAB_TRANSPORT);
 assert.equal(r.transcript[1].role,'CUSTOMER');
 assert.equal(r.transcript[2].role,'FRANCISCA');
 assert.equal(r.transcript[3].role,'CUSTOMER');
 assert.equal(r.transcript[4].role,'FRANCISCA');
});

test('grader catches actual Wesley/client inversion from Eletrotec example',()=>{
 const scenario=SCENARIOS.find(x=>x.id==='eletrotec-question');
 const transcript=[{role:'CUSTOMER',text:'Bom dia Wesley, seria sobre o que?'},{role:'FRANCISCA',text:'Oi Wesley, a proposta seria para desenvolver um site profissional. Podemos entender suas necessidades?'}];
 const grade=assessConversation(scenario,transcript);
 assert.ok(grade.errors.includes('ROLE_CONFUSION_WESLEY_IS_NOT_CUSTOMER'));
 assert.ok(grade.errors.includes('MISSING_FIXED_OFFER_AFTER_PROPOSAL_REQUEST'));
});

test('synthetic agent cannot be connected to WhatsApp and live Groq use must be explicit',()=>{
 const source=readFileSync(new URL('../dashboard/simulation/dual-agent-lab.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/from ['"].*(?:waakg-control|waakg-bridge|notifications|server\.mjs)/);
 assert.doesNotMatch(source,/api\/messages\//);
 assert.doesNotMatch(source,/\bprocess\.env\.WA_AKG_/);
 assert.throws(()=>makeGroqAgent({role:'CUSTOMER',system:'Cliente'}),/Groq key required/);
 assert.throws(()=>makeGroqAgent({role:'OWNER',system:'Cliente',apiKey:'test'}),/Invalid laboratory role/);
});
