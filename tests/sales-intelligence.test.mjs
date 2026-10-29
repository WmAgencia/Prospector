import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeSalesConversation,contextForGroq,STAGES} from '../dashboard/sales-intelligence.mjs';

const cases=[
 ['Como funciona esse site?','discovery','detail'],
 ['Me manda um exemplo do trabalho de vocês','evaluation','visual'],
 ['Vou pensar e falar com meu sócio','evaluation','cautious'],
 ['Quanto custa o projeto?','negotiation','price'],
 ['Conseguimos marcar uma reunião?','evaluation','direct'],
 ['Gostei, vamos fazer o site','decision','ready'],
 ['Já paguei, consegue trocar as fotos?','delivery','detail'],
 ['Não tenho interesse, não me contate','opt_out','direct'],
 ['Quero falar com um atendente humano','human_handoff','direct']
];
for(const [text,stage,profile] of cases){
 test('Classifies commercial intent: '+stage+' / '+profile+' / '+text.slice(0,21),()=>{
  const x=analyzeSalesConversation({text});
  assert.equal(x.stage,stage);
  assert.equal(x.profile,profile);
  assert.equal(x.requiresHumanReview,true);
  assert.ok(STAGES.includes(x.stage));
  assert.match(contextForGroq(x),/PRÓXIMA AÇÃO RECOMENDADA/);
 });
}
test('Insufficient evidence gets low confidence without demographic inference',()=>{
 const x=analyzeSalesConversation({text:'Tudo certo'});
 assert.equal(x.confidence,'low');
 assert.equal(x.profile,'neutral');
 assert.ok(!JSON.stringify(x).includes('idade'));
});
test('Opt-out is always prioritized above sales cues',()=>{
 const x=analyzeSalesConversation({text:'Quanto custa? Não quero contato mais.'});
 assert.equal(x.stage,'opt_out');
 assert.equal(x.risk,'do_not_contact');
});
