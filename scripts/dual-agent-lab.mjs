#!/usr/bin/env node
// Zero WhatsApp credentials, sender, receiver or gateway imports.
// Usage: node scripts/dual-agent-lab.mjs [--mode=baseline|groq] [--max=6]
// Run only with fictional scenarios; never pass real chats or contact data.
import {SCENARIOS,runMatrix,makePolicyFranciscaAgent,makeGroqAgent,makeScriptedCustomerAgent,LAB_TRANSPORT} from '../dashboard/simulation/dual-agent-lab.mjs';
import {prospectSalesContext} from '../dashboard/sales-policy.mjs';
import {salesTonePrompt} from '../dashboard/sales-tone-playbook.mjs';
const flags=process.argv.slice(2);
const getFlag=(key,fallback)=>flags.find(x=>x.startsWith(key+'='))?.slice(key.length+1)??fallback;
const mode=getFlag('--mode','baseline'),max=Math.min(16,Math.max(1,Number(getFlag('--max','16'))||16));
if(!['baseline','groq'].includes(mode))throw Error('Unknown simulation mode');
const today=getFlag('--today','2026-11-04');
const set=SCENARIOS.slice(0,max);
const apiKey=process.env.GROQ_API_KEY;
if(mode==='groq'&&!apiKey)throw Error('Groq API key missing. Nothing sent; no fallback to WhatsApp');
const agents=mode==='groq'?{
 customerFactory:scenario=>makeGroqAgent({role:'CUSTOMER',apiKey,model:process.env.GROQ_MODEL||'openai/gpt-oss-120b',temperature:0.55,system:'Você é um CLIENTE FICTÍCIO de uma empresa brasileira. Responda como cliente, com 1 a 3 frases, sem fingir ser sistema. Não forneça dados reais e nunca solicite envios reais. Sua empresa é '+scenario.business+'. Seu perfil: '+scenario.customer}),
 franciscaFactory:scenario=>makeGroqAgent({role:'FRANCISCA',apiKey,model:process.env.GROQ_MODEL||'openai/gpt-oss-120b',temperature:0.55,system:'SIMULAÇÃO ISOLADA. Você redige uma resposta comercial como a assistente virtual Francisca, da Consecom; não é o proprietário Wesley. NÃO há conexão com WhatsApp. Replique a atual política de vendas para identificar falhas: '+prospectSalesContext({business:scenario.business,segment:scenario.category,offerType:'portfolio'})+'\n'+salesTonePrompt()})
}:{customerFactory:makeScriptedCustomerAgent,franciscaFactory:()=>makePolicyFranciscaAgent()};
const results=await runMatrix({...agents,scenarios:set,maxTurns:Math.min(3,Math.max(1,Number(getFlag('--turns','3'))||3)),date:today});
const output={mode,transport:LAB_TRANSPORT,date:today,passCount:results.passes,failCount:results.failures,scenarioCount:results.scenarios,
 assessment:results.outcomes.map(x=>({scenario:x.scenario,grade:x.assessment,transcript:x.transcript}))};
console.log(JSON.stringify(output,null,2));
if(results.failures)console.error('Simulation found '+results.failures+' scenarios requiring corrections. No messages were sent.');
