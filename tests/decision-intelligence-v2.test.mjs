import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'consecom-decision-v2-'));
const {decideMessage,scoreOpportunity}=await import('../dashboard/decision-intelligence/engine.mjs');
const {labelExample,modelPredict,modelStatistics}=await import('../dashboard/decision-intelligence/learning.mjs');
const {evaluateDecision}=await import('../dashboard/automation-router.mjs');
const db=await import('../dashboard/db.mjs');
test('Choice/Noul: context of audio permission, commercial interest, questions and objections',()=>{
 const yes=['sim','sim pode mandar','pode enviar o áudio','Claro, pode explicar','Me manda a apresentação'];
 for(const phrase of yes)assert.equal(decideMessage(phrase,'presentation_permission').decision,'YES',phrase);
 for(const phrase of ['não quero','Sem interesse','agora não','não, pode sim'])
  assert.equal(decideMessage(phrase,'presentation_permission').decision,'NO',phrase);
 assert.equal(decideMessage('pare de me mandar mensagens','presentation_permission').intent,'OPT_OUT');
 assert.equal(decideMessage('sim quero um site','website_interest').decision,'YES');
 assert.equal(decideMessage('gostei do vídeo','website_interest').decision,'REVIEW');
 assert.equal(decideMessage('quanto custa?','website_interest').decision,'REVIEW');
 assert.equal(decideMessage('vou pensar','presentation_permission').decision,'REVIEW');
 assert.equal(decideMessage('caro demais','website_interest').intent,'PRICE_OBJECTION');
 assert.equal(decideMessage('bom dia','presentation_permission').decision,'REVIEW');
 assert.equal(decideMessage('','presentation_permission').decision,'REVIEW');
});
test('Score: transparent points and website evidence, without inventing no-site',()=>{
 const base={business:'Ateliê Primavera',city:'Sorocaba',segment:'Moda',phone:null,website_status:'UNCERTAIN'};
 const a=scoreOpportunity(base);
 const b=scoreOpportunity({...base,phone:'5515990001111',website_status:'NO_WEBSITE'},[{source:'osm'},{source:'cnpj'}]);
 assert.ok(a.score<b.score);
 assert.equal(a.kind,'UNVERIFIED');
 assert.equal(b.kind,'NO_SITE_CONFIRMED');
 assert.ok(b.reasons.find(x=>x.reason.includes('fontes múltiplas')));
 assert.ok(b.score<=100);
});
test('learning uses explicitly labeled token sets; model remains advisory and private',()=>{
 const yes=['pode mandar explicação','aceito receber áudio','sim pode contar','claro me apresenta','quero ouvir detalhes','pode enviar apresentação'];
 const no=['não desejo ouvir','não quero sua proposta','dispenso sua oferta','não me interessa','prefiro não seguir','não vou receber'];
 const review=['preciso analisar mais','talvez outro momento','vou consultar equipe','ainda estou pensando','tenho algumas dúvidas','não sei ainda'];
 for(const [label,arr] of [['YES',yes],['NO',no],['REVIEW',review]]){
  for(const text of arr)assert.equal(labelExample({text,label,context:'presentation_permission'}).created,true);
 }
 assert.equal(modelStatistics('presentation_permission').ready,true);
 const pred=modelPredict('pode enviar áudio agora','presentation_permission');
 assert.equal(pred.supported,true);
 assert.ok(pred.confidence>=0&&pred.confidence<=1);
 assert.equal(decideMessage('resposta indefinida','presentation_permission',{modelPrediction:{supported:true,label:'YES',confidence:0.999}}).decision,'REVIEW');
 assert.equal(db.one('SELECT COUNT(*) n FROM decision_examples').n,18);
 assert.equal(db.one("SELECT COUNT(*) n FROM decision_examples WHERE tokens LIKE '%mandar explicação%'").n,0);
 assert.equal(labelExample({text:yes[0],label:'YES',context:'presentation_permission'}).created,false);
});
test('router preserves explicit yes, refusal precedence and conservative website qualification',()=>{
 db.setSetting('decision_engine_enabled',true);
 assert.equal(evaluateDecision('pode sim','sample_offer').decision,'YES');
 assert.equal(evaluateDecision('não, pode sim','sample_offer').decision,'NO');
 assert.equal(evaluateDecision('quero um assim','website_interest').decision,'YES');
 assert.equal(evaluateDecision('gostei','website_interest').decision,'REVIEW');
 assert.equal(evaluateDecision('quero ver','sample_offer').decision,'YES');
 db.setSetting('decision_learning_enabled',true);
 const result=evaluateDecision('talvez mais tarde','presentation_permission');
 assert.equal(result.decision,'REVIEW');
 db.setSetting('decision_learning_enabled',false);
});
test('OSM-only migration leaves existing campaigns, times and media untouched',()=>{
 const sources=db.getSetting('discovery_sources',{});
 assert.equal(sources.osm,true);
 assert.equal(sources.google_places,false);
 assert.equal(sources.web_search,false);
 assert.equal(db.getSetting('google_places_auto_enabled'),false);
 assert.equal(db.getSetting('decision_engine_enabled'),true);
 assert.equal(db.getSetting('decision_learning_enabled'),false);
 assert.equal(db.getSetting('business_start'),8);
 assert.equal(db.getSetting('business_end'),18);
 const cities=db.getSetting('cities','').split(',').filter(Boolean);
 const segments=db.getSetting('segments','').split(',').filter(Boolean);
 assert.ok(cities.length>=18);
 assert.ok(segments.length>=30);
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
