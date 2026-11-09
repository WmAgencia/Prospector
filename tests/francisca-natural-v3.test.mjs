import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'francisca-v3-'));
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.GROQ_API_KEY='fictional-mocked-key';
process.env.FRANCISCA_NATURAL_V1_ENABLED='true';
process.env.FRANCISCA_COMMERCIAL_BRAIN_V2_ENABLED='true';
process.env.FRANCISCA_STYLE_EXAMPLES_V1_ENABLED='true';
process.env.FRANCISCA_COMPACT_PROMPT_V3_ENABLED='true';
delete process.env.PROSPECTOR_TENANT_ID;
delete process.env.PROSPECTOR_TENANT_INTERNAL;
const {compactPromptEnabled,compactFranciscaInstructions}=await import('../dashboard/francisca-compact-policy-v3.mjs');
const {aiDraft,aiStatus}=await import('../dashboard/ai-groq.mjs');
const {generate100FranciscaScenarios,evaluateFrancisca100,gradeFranciscaReply}=await import('../dashboard/francisca-quality-evaluator.mjs');
const {findStyleExamples,styleIntentCategory}=await import('../dashboard/francisca-style-examples.mjs');
const {trainingPrompt}=await import('../dashboard/training.mjs');
const {db}=await import('../dashboard/db.mjs');
test('production tenant flags keep v3 exclusive to Consecom',async()=>{
 const {workerEnvironment}=await import('../dashboard/platform.mjs');
 process.env.FRANCISCA_COMPACT_PROMPT_V3_ENABLED='true';
 try{
  const root=workerEnvironment({id:'internal',name:'Consecom',is_internal:1,is_demo:0},3010);
  const external=workerEnvironment({id:'other',name:'Another company',is_internal:0,is_demo:0},3011);
  const demo=workerEnvironment({id:'demo',name:'Demo',is_internal:0,is_demo:1},3012);
  assert.equal(root.FRANCISCA_COMPACT_PROMPT_V3_ENABLED,'true');
  assert.equal(external.FRANCISCA_COMPACT_PROMPT_V3_ENABLED,'false');
  assert.equal(demo.FRANCISCA_COMPACT_PROMPT_V3_ENABLED,'false');
 }finally{process.env.FRANCISCA_COMPACT_PROMPT_V3_ENABLED='true';}
});
test('compact conversational prompt requires explicit internal Consecom flag',()=>{
 assert.equal(compactPromptEnabled({FRANCISCA_COMPACT_PROMPT_V3_ENABLED:'false'}),false);
 assert.equal(compactPromptEnabled({FRANCISCA_COMPACT_PROMPT_V3_ENABLED:'true'}),true);
 assert.equal(compactPromptEnabled({FRANCISCA_COMPACT_PROMPT_V3_ENABLED:'true',PROSPECTOR_TENANT_ID:'client'}),false);
 assert.equal(compactPromptEnabled({FRANCISCA_COMPACT_PROMPT_V3_ENABLED:'true',PROSPECTOR_TENANT_ID:'client',PROSPECTOR_TENANT_INTERNAL:'true'}),true);
 assert.equal(aiStatus().compactPolicy.enabled,true);
});
test('compact guide respects natural language, no fake human identity or capabilities',()=>{
 const prompt=compactFranciscaInstructions({incoming:'Já tenho um site e tá lento',commercialPlan:{stage:'DISCOVERY',nextAction:'Ajudar se autorizado.'}});
 assert.match(prompt,/FRANCISCA NATURAL V3/);
 assert.match(prompt,/assistente virtual/);
 assert.match(prompt,/nunca ofereça/i);
 assert.match(prompt,/não repita "se quiser"/i);
 assert.doesNotMatch(prompt,/Você gostaria que eu realizasse uma análise para identificar as causas principais\?/);
});
test('compact training removes duplicated global voice text but retains all approved facts',()=>{
 const full=trainingPrompt();
 const concise=trainingPrompt({compact:true});
 assert.ok(concise.length<full.length);
 assert.match(concise,/CONDIÇÕES DE FECHAMENTO AUTORIZADAS/);
 assert.match(concise,/PORTFÓLIO E PROVAS SOCIAIS APROVADOS/);
 assert.match(concise,/R\$ 550/);
 assert.match(concise,/50% de entrada/);
 assert.match(concise,/MANUAL COMERCIAL PRIVADO/);
});
test('same drafting engine receives a shorter policy with verified business facts',async()=>{
 const prompts=[];
 const mock=async payload=>{prompts.push(payload.messages[0].content);return {model:'MOCK',choice:{content:'Se quiser, te explico direitinho o que entra no projeto.'}};};
 const next=await aiDraft({text:'Achei caro',audience:'PROSPECT_APPROACHED',chat:mock});
 assert.equal(next.ok,true);
 assert.equal(next.compactPolicy,true);
 assert.equal(next.autoSend,false);
 const compact=prompts.at(-1);
 assert.match(compact,/FRANCISCA NATURAL V3/);
 assert.match(compact,/R\$ 550/);
 assert.match(compact,/CONSENTIMENTO|consentimento|não contato|não contatar|não envie/i);
 process.env.FRANCISCA_COMPACT_PROMPT_V3_ENABLED='false';
 try{
  const old=await aiDraft({text:'Achei caro',audience:'PROSPECT_APPROACHED',chat:mock});
  assert.equal(old.ok,true);
  assert.equal(old.compactPolicy,false);
  const legacy=prompts.at(-1);
  assert.doesNotMatch(legacy,/FRANCISCA NATURAL V3/);
  assert.ok(compact.length<legacy.length,'compact='+compact.length+' legacy='+legacy.length);
 }finally{process.env.FRANCISCA_COMPACT_PROMPT_V3_ENABLED='true';}
});
test('style intent retrieval never conflates opt-out with incomprehension',()=>{
 const misunderstanding=findStyleExamples({incoming:'kkkk não entendi nada, fala mais simples',limit:3});
 assert.ok(misunderstanding.some(x=>/não entendi/i.test(x.incoming)));
 assert.ok(!misunderstanding.some(x=>/não quero mais receber/i.test(x.incoming)));
 assert.ok(misunderstanding.every(x=>x.topic==='confusion'&&x.score>=0.24));
 assert.equal(styleIntentCategory('Não quero mais receber mensagens'),'optout');
 assert.equal(styleIntentCategory('Não entendi nada'),'confusion');
});
test('no off-topic greeting, portfolio or website sample from an unrelated query',()=>{
 const examples=findStyleExamples({incoming:'Oie, estou olhando esse site aí',limit:3});
 assert.ok(!examples.some(x=>/lento|carregamento/.test(x.incoming)));
 assert.ok(!examples.some(x=>/não quero receber/.test(x.incoming)));
 const approved=findStyleExamples({incoming:'Quero ver com meu sócio antes',limit:3});
 assert.ok(approved.every(x=>x.topic==='decision'));
});
test('100 unique fictitious situations cover ten essential categories',()=>{
 const cases=generate100FranciscaScenarios();
 assert.equal(cases.length,100);
 assert.equal(new Set(cases.map(x=>x.id)).size,100);
 assert.equal(new Set(cases.map(x=>x.category)).size,10);
 assert.ok(cases.every(x=>x.kind==='SYNTHETIC'));
 assert.ok(cases.every(x=>typeof x.reference==='string'&&typeof x.robotic==='string'));
});
test('100-scenario heuristic distinguishes references from deliberately robotic texts',()=>{
 const cases=generate100FranciscaScenarios();
 const good=evaluateFrancisca100({cases});
 const bad=evaluateFrancisca100({cases,answers:cases.map(x=>x.robotic)});
 assert.ok(good.passed>=90,good.passed+' of 100');
 assert.ok(bad.passed<=35,bad.passed+' of 100');
 assert.ok(good.averageScore>bad.averageScore+20);
 assert.match(good.limits.join(' '),/não demonstram que o modelo escreve de forma natural/);
});
test('evaluator flags fake actions, Pix data harvesting and form-like replies',()=>{
 const bad=gradeFranciscaReply({incoming:'Como recebo a chave Pix?',answer:'A chave Pix já foi enviada. Me informe seu telefone para gerar a chave.',category:'pix'});
 assert.equal(bad.pass,false);
 assert.ok(bad.flags.includes('PIX_PII_REQUEST')||bad.flags.includes('UNVERIFIED_ACTION'));
 const robotic=gradeFranciscaReply({incoming:'Meu site tá lento',answer:'Entendo sua preocupação. Você gostaria que eu realizasse uma análise para identificar as causas principais?',category:'slow_site'});
 assert.equal(robotic.pass,false);
 assert.ok(robotic.flags.includes('ROBOTIC_FORMAL'));
});
test('100-case prompt smoke test uses mocked models only; no outbound messages',async()=>{
 const cases=generate100FranciscaScenarios();
 let count=0;
 for(const item of cases){
  let payload;
  const result=await aiDraft({text:item.incoming,audience:'PROSPECT_APPROACHED',chat:async p=>{
   payload=p;count++;return {model:'MOCK',choice:{content:item.reference}};
  }});
  assert.equal(result.ok,true,item.id);
  assert.equal(result.compactPolicy,true,item.id);
  assert.equal(result.autoSend,false,item.id);
  assert.match(payload.messages[0].content,/FRANCISCA NATURAL V3/);
  assert.equal(gradeFranciscaReply({incoming:item.incoming,answer:result.draft,category:item.category,hasAssistantReply:item.hasAssistantReply}).pass,true,item.id);
 }
 assert.equal(count,100);
});
test.after(()=>{try{db.close();}catch{}try{fs.rmSync(dir,{recursive:true,force:true});}catch{}});
