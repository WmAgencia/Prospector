import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedConsecomAnswer} from '../dashboard/francisca-approved-replies.mjs';
import {commercialIntent,nextConversationState,memoryPrompt} from '../dashboard/francisca-conversation-state.mjs';
const sectors=['oficina','buffet','salão','restaurante','consultoria','caldeiraria','loja','construtora','mecânica','escola'];
const objections=[
 ['Pode enviar a proposta por e-mail?',/e-mail/],
 ['Vocês fazem contrato?',/contrato/],
 ['Achei caro. Dá pra fazer mais barato?',/R\$ 450/],
 ['Não quero meu site no portfólio de vocês.',/R\$ 2\.800/],
 ['Não tenho fotos profissionais.',/IA/],
 ['Qual é o prazo para ficar pronto?',/três dias úteis/],
 ['Há mensalidade?',/sem mensalidade/],
 ['Posso pedir alterações depois da aprovação final?',/novas alterações/],
 ['Eu gostaria de um catálogo de produtos com compra pelo WhatsApp.',/R\$ 550/],
 ['A loja precisa aceitar pagamento no próprio site.',/R\$ 750/]
];
test('100 cenários comerciais simulados preservam oferta e memória sem envios reais',()=>{
 let count=0;
 for(const sector of sectors)for(const [question,expected] of objections){
  const intro=nextConversationState({},[
   {direction:'in',body:'Qual proposta para '+sector+'?'},
   {direction:'out',body:'É um site profissional de portfólio por R$ 550 com domínio.'}
  ]);
  const message=approvedConsecomAnswer(question);
  assert.equal(intro.offerExplained,true);
  assert.ok(message,question);
  assert.match(message,expected,question);
  assert.ok(message.length<=650);
  assert.notEqual(commercialIntent(question),'opt_out');
  const after=nextConversationState(intro,[{direction:'in',body:question},{direction:'out',body:message}]);
  assert.match(memoryPrompt(after),/já apresentada: sim/);
  assert.doesNotMatch(JSON.stringify(after),/contato@|telefone|cpf/i);
  count++;
 }
 assert.equal(count,100);
});
