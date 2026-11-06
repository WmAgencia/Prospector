import test from 'node:test';
import assert from 'node:assert/strict';
import {commercialIntent,isSpecificCommercialFollowup,nextConversationState,memoryPrompt} from '../francisca-conversation-state.mjs';
test('identifica pedidos específicos e elipses de contexto comercial',()=>{
 const cases={
  'Pode mandar tudo pelo meu e-mail?':'email',
  'Vocês fazem contrato pelo Gov.br?':'contract',
  'Não quero o Feito por Consecom no rodapé':'license',
  'A entrada pode ser no PIX?':'payment',
  'Tem como fazer loja virtual?':'scope',
  'Não tenho fotos boas':'photos',
  'E se atrasar os três dias úteis?':'deadline',
  'Depois posso pedir alteração?':'changes',
  'Vou ver com meu sócio':'decision',
  'Achei caro':'price_objection',
  'Quero fechar':'closing',
  'Não entendi':'clarification',
  'qual a proposta?':'proposal',
  'quanto custa?':'price',
  'não tenho interesse':'opt_out'
 };
 for(const [text,intent] of Object.entries(cases))assert.equal(commercialIntent(text),intent,text);
 assert.equal(isSpecificCommercialFollowup('vou falar com meu sócio'),true);
 assert.equal(isSpecificCommercialFollowup('que proposta?'),false);
});
test('memória mantém a proposta explicada e não mistura conversas',()=>{
 const first=nextConversationState({},[{direction:'in',body:'Qual a proposta?'},{direction:'out',body:'O site profissional de portfólio fica em R$ 550 com domínio.'}]);
 assert.equal(first.offerExplained,true);
 const second=nextConversationState(first,[{direction:'in',body:'Eu vou mostrar para meu sócio.'},{direction:'out',body:'Pode mostrar, fico à disposição para tirar dúvidas.'}]);
 assert.equal(second.offerExplained,true);
 const alt=nextConversationState(second,[{direction:'out',body:'Podemos fazer sem domínio por R$ 450.'}]);
 assert.equal(alt.alternativeOfferDiscussed,true);
 assert.match(memoryPrompt(alt),/Alternativa de preço já discutida: sim/);
 assert.equal(second.lastCustomerIntent,'decision');
 assert.match(memoryPrompt(second),/Proposta de R\$ 550 já apresentada: sim/);
 assert.equal(nextConversationState({},[{direction:'in',body:'vou pensar'}]).offerExplained,false);
});
test('memória só registra rótulos sem guardar números privados',()=>{
 const state=nextConversationState({},[{direction:'in',body:'meu email é contato@exemplo.com'},{direction:'out',body:'Anotei seu e-mail.'}]);
 assert.equal(JSON.stringify(state).includes('contato@'),false);
});
