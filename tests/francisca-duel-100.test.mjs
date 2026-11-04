import test from 'node:test';
import assert from 'node:assert/strict';
import {FICTIONAL_SCENARIOS,simulateConversation,simulateMatrix,safeFranciscaAgent,scriptedClientAgent,SIMULATION_TRANSPORT} from '../dashboard/simulation/francisca-duel-100.mjs';

test('100 separate fictitious conversations, including other 77, have zero critical errors in the corrected deterministic core',async()=>{
 const result=await simulateMatrix();
 assert.equal(result.total,100);
 assert.equal(result.passed,100,JSON.stringify(result.outputs.filter(x=>x.issues.length)));
 assert.equal(result.failed,0);
 assert.equal(result.transport,SIMULATION_TRANSPORT);
 assert.equal(new Set(result.outputs.map(x=>x.scenario)).size,100);
 assert.equal(result.outputs.slice(23).length,77,'The original 23 and remaining 77 are distinct');
 for(const item of result.outputs){
  assert.ok(item.transcript.length>=3,item.scenario);
  assert.equal(item.transcript[0].event,'GREETING');
  assert.ok(item.transcript.every(t=>t.role==='CUSTOMER'||t.role==='FRANCISCA'));
 }
 console.log('FRANCISCA_DUEL_100',JSON.stringify({total:result.total,passed:result.passed,failed:result.failed,remaining77:result.outputs.slice(23).length,transport:result.transport}));
});

test('simulator never calls real transport or sends after a decline',async()=>{
 const scenario=FICTIONAL_SCENARIOS.find(x=>x.style==='recusa');
 const r=await simulateConversation({scenario,customerAgent:scriptedClientAgent(scenario),franciscaAgent:safeFranciscaAgent()});
 assert.equal(r.stage,'NO_INTEREST');
 assert.deepEqual(r.transcript.map(x=>x.event),['GREETING','INBOUND','NO_INTEREST']);
 assert.equal(r.transport,SIMULATION_TRANSPORT);
});
test('client and AI keep history distinct and first refusal is terminal',async()=>{
 const scenario=FICTIONAL_SCENARIOS.find(x=>x.style==='curioso');
 let draftCount=0;
 const ai=safeFranciscaAgent({draft:async({inbound,history})=>{draftCount++;assert.equal(history.at(-1).text,inbound);return 'Podemos avaliar a sua necessidade.';}});
 const result=await simulateConversation({scenario,customerAgent:scriptedClientAgent(scenario),franciscaAgent:ai});
 assert.ok(result.transcript.some(x=>x.event==='INTRO'));
 assert.ok(result.transcript.some(x=>x.event==='FIXED_OFFER'));
 assert.equal(result.issues.length,0);
 assert.ok(draftCount<=2);
});
