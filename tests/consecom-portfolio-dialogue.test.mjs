import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyInboundAutomation} from '../dashboard/inbound-automation.mjs';
import {consecomPortfolioDialogue} from '../dashboard/consecom-portfolio-dialogue.mjs';
test('autoeletrica away message is not human agreement',()=>{
 const message='Auto elétrica Conect agradece seu contato !! Assim que possível irei te responder .. horário de funcionamento Seg a sexta 8:00 as 18:00 hrs e de sábado 8:00 as 13:00 hrs !!!';
 assert.equal(classifyInboundAutomation(message).blocked,true);
});
test('human greeting continues site pitch without asking about customer needs',()=>{
 assert.equal(classifyInboundAutomation('Bom dia, bem e vc ?!').blocked,false);
 const t=consecomPortfolioDialogue({text:'Bom dia, bem e vc ?!'});
 assert.equal(t.kind,'COURTESY');
 assert.match(t.text,/site profissional/i);
 assert.match(t.text,/R\$ 350/);
 assert.match(t.text,/portfólio/);
 assert.doesNotMatch(t.text,/melhorar a presença online|otimizar o contato|objetivo vocês buscam/i);
});
test('vacationing owner is a deferral, not a discovery question',()=>{
 const t=consecomPortfolioDialogue({text:'Bom dia, Wesley. Os donos da oficina estão de férias, apenas a partir de terça-feira eles estarão aqui. Qualquer proposta tem que ser feita com eles.'});
 assert.equal(t.kind,'DECISION_MAKER_UNAVAILABLE');
 assert.equal(t.notifyOwner,true);
 assert.match(t.text,/site profissional/);
 assert.doesNotMatch(t.text,/o que vocês precisam|necessidades/i);
});
test('requested time is relayed without claiming scheduled followup',()=>{
 const t=consecomPortfolioDialogue({text:'depois das 14h'});
 assert.equal(t.kind,'TIME_WINDOW');
 assert.equal(t.notifyOwner,true);
 assert.doesNotMatch(t.text,/agendei|retorno marcado|volto na terça/i);
});
test('audio already received follows ordinary human-driven replies',()=>{
 assert.equal(consecomPortfolioDialogue({text:'Bom dia, bem e vc!',voiceAlreadySent:true}),null);
});
