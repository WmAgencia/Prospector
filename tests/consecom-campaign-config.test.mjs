import test from 'node:test';
import assert from 'node:assert/strict';
import {classify} from '../dashboard/classifier.mjs';
import {evaluateDecision,permitsPresentation} from '../dashboard/automation-router.mjs';
const intro='Olá! Posso te enviar um áudio explicando e um vídeo?';
const steps=[{type:'message',text:intro},{type:'wait_reply'},{type:'delay',seconds:45},{type:'audio',media_id:''},{type:'video',media_id:''},{type:'wait_reply'},{type:'decision',yes_action:'handover',no_action:'end'},{type:'end'}];
test('lead permission to receive audio is recognized before generic uncertain classifier',()=>{
 assert.equal(classify('Pode enviar').intent,'UNCERTAIN');
 assert.equal(evaluateDecision('Pode enviar').decision,'YES');
 assert.equal(permitsPresentation(steps,2,'Pode enviar'),true);
 assert.equal(permitsPresentation(steps,2,'Sim, pode enviar'),true);
 assert.equal(permitsPresentation(steps,2,'Ok, pode mandar'),true);
 assert.equal(permitsPresentation(steps,2,'Pode falar'),true);
 assert.equal(permitsPresentation(steps,6,'Pode enviar'),false);
});
test('first-stage refusals and ambiguous messages do not release campaign media',()=>{
 for(const msg of ['Não quero', 'Prefiro não', 'Agora não', 'Talvez depois', 'Quem é?', 'Quanto fica?'])
  assert.equal(permitsPresentation(steps,2,msg),false,'Unexpected consent for: '+msg);
 assert.equal(evaluateDecision('Não, pode enviar').decision,'NO');
});
test('seeded campaign stays a disabled draft until media upload',()=>{
 assert.equal(steps[3].media_id,'');
 assert.equal(steps[4].media_id,'');
 assert.equal(steps[6].yes_action,'handover');
 assert.equal(steps[6].no_action,'end');
});