import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,renderTemplate} from '../dashboard/classifier.mjs';
import {evaluateDecision,permitsPresentation} from '../dashboard/automation-router.mjs';
import {buildConsecomSteps,CAMPAIGN_INTRO,CAMPAIGN_VIDEO_CAPTION,CAMPAIGN_FAREWELL} from '../dashboard/consecom-flow.mjs';
const steps=buildConsecomSteps();
test('personalized first contact uses only known personal name, with safe fallback',()=>{
 assert.equal(renderTemplate(CAMPAIGN_INTRO,{name:'Maria Fernandes',business:'Clínica'}),'Olá, Maria, como vai? A gente conheceu o trabalho de vocês e gostaríamos de apresentar uma proposta. Posso te enviar um áudio explicando tudo certinho?');
 assert.equal(renderTemplate(CAMPAIGN_INTRO,{name:'Dra. Juliana',business:'Consultório de Juliana'}).startsWith('Olá, Juliana, como vai?'),true);
 assert.equal(renderTemplate(CAMPAIGN_INTRO,{business:'Empresa sem nome pessoal'}).startsWith('Olá, como vai?'),true);
 assert.equal(renderTemplate(CAMPAIGN_INTRO,{name:'Contato',business:'Empresa'}).startsWith('Olá, como vai?'),true);
});
test('recognizes explicit first-stage permissions across natural variants',()=>{
 assert.equal(classify('Pode enviar').intent,'UNCERTAIN');
 for(const msg of ['Pode enviar','Sim, pode enviar','Ok, pode mandar','Pode falar','Sim','Pode sim','Ok','Beleza','Manda aí','Claro','Com certeza','Pode me mandar','Perfeito, pode mandar'])
  assert.equal(permitsPresentation(steps,2,msg),true,'Falhou para: '+msg);
 assert.equal(permitsPresentation(steps,7,'Pode enviar'),false);
});
test('first-stage declines and ambiguous replies never release media',()=>{
 for(const msg of ['Não quero','Prefiro não','Agora não','Talvez depois','Quem é?','Quanto fica?','Não sei','Vou pensar'])
  assert.equal(permitsPresentation(steps,2,msg),false,'Aprovação indevida: '+msg);
 assert.equal(evaluateDecision('Não, pode enviar').decision,'NO');
});
test('video question classifies real purchase interest conservatively',()=>{
 for(const msg of ['Sim','Tenho interesse','Quero um assim','Gostaria de ter um site','Vamos fechar','Quero um desse','Pode começar','Quero fazer um site','Sim, tenho interesse'])
  assert.equal(evaluateDecision(msg,'website_interest').decision,'YES','Não confirmou: '+msg);
 for(const msg of ['Não','Sem interesse','Não tenho interesse','Não obrigado','Agora não'])
  assert.equal(evaluateDecision(msg,'website_interest').decision,'NO','Não recusou: '+msg);
 for(const msg of ['Ok','Beleza','Gostei','Legal','Vou pensar','Talvez','Quanto custa?','Gostei, vou pensar'])
  assert.equal(evaluateDecision(msg,'website_interest').decision,'REVIEW','Falso positivo/negativo: '+msg);
});
test('new campaign has 45 seconds before voice and 10 seconds before muted video',()=>{
 assert.deepEqual(steps.map(x=>x.type),['message','wait_reply','delay','audio','delay','video','wait_reply','decision','end']);
 assert.equal(steps[2].seconds,45);
 assert.equal(steps[4].seconds,10);
 assert.equal(steps[5].caption,CAMPAIGN_VIDEO_CAPTION);
 assert.equal(steps[7].yes_action,'handover');
 assert.equal(steps[7].no_action,'end');
 assert.equal(steps[7].no_text,CAMPAIGN_FAREWELL);
 assert.equal(steps[3].media_id,'');
 assert.equal(steps[5].media_id,'');
});
test('upgrade preserves attached audio, video, ids and campaign stays structurally consistent',()=>{
 const old=[{id:'a',type:'message',text:'Old text'},{id:'b',type:'wait_reply'},{id:'c',type:'delay',seconds:45},{id:'d',type:'audio',media_id:'ogg-prod'},{id:'e',type:'video',media_id:'mp4-prod'},{id:'f',type:'wait_reply'},{id:'g',type:'decision',context:'general_interest'},{id:'h',type:'end'}];
 const upgraded=buildConsecomSteps({existingSteps:old});
 assert.equal(upgraded[3].media_id,'ogg-prod');
 assert.equal(upgraded[5].media_id,'mp4-prod');
 assert.equal(upgraded[5].id,'e');
 assert.equal(upgraded[7].id,'g');
 assert.equal(upgraded[4].seconds,10);
 assert.equal(upgraded[7].context,'website_interest');
});