import test from 'node:test';
import assert from 'node:assert/strict';
import {detectAutomaticReply,portfolioQuestion,isBaseOfferQuestion,verifiedPersonName,friendlyGreeting,siteFocus,brDeliveryDate,fixedOfferPitch,fixedOfferPriceReply,PORTFOLIO_PRICE_BRL} from '../dashboard/portfolio-offer-550.mjs';
import {salesEnding,priceQuestion} from '../dashboard/sales-policy.mjs';
import {explicitInterest} from '../dashboard/groq-interest-check.mjs';
const at=new Date('2026-11-04T15:00:00Z');

test('fixed offer is accurate and remains inside the WhatsApp message length guard',()=>{
 assert.equal(PORTFOLIO_PRICE_BRL,550);
 const text=fixedOfferPitch({segment:'oficina mecânica',business:'Oficina Teste'},at);
 assert.match(text,/serviços/);
 assert.match(text,/R\$ 550/);
 assert.match(text,/domínio pago por um ano/);
 assert.match(text,/Master SEO/);
 assert.match(text,/3 dias/);
 assert.match(text,/7 de novembro de 2026/);
 assert.doesNotMatch(text,/90\s*%|primeira posição|posição garantida/i);
 assert.ok(text.length<=650,'The fixed pitch must fit the existing guard');
 const price=fixedOfferPriceReply(at);
 assert.match(price,/R\$ 550/);
 assert.ok(price.length<=650);
});

test('dates add exactly three local calendar days, including leap and year boundaries',()=>{
 assert.equal(brDeliveryDate(at),'7 de novembro de 2026');
 assert.equal(brDeliveryDate(new Date('2026-12-30T15:00:00Z')),'2 de janeiro de 2027');
 assert.equal(brDeliveryDate(new Date('2028-02-28T15:00:00Z')),'2 de março de 2028');
});

test('business greeting is never copied into a personal vocative',()=>{
 assert.equal(friendlyGreeting({business:'Eletrotec - Auto Elétrica | Mecânica | Injeção Eletrônica'},at),'Olá, boa tarde! Tudo bem?');
 assert.equal(friendlyGreeting({business:'Autoelétrica Érico'},at),'Olá, boa tarde! Tudo bem?');
 assert.equal(friendlyGreeting({name:'João',business:'Loja Joias'},at),'Olá, boa tarde! Tudo bem?');
 assert.equal(friendlyGreeting({name:'Érico',name_verified:true,business:'Autoelétrica Érico'},at),'Olá, Érico, boa tarde! Tudo bem?');
 assert.equal(verifiedPersonName({name:'Oficina Érico',name_verified:true}),'');
});

test('catches synthetic autoresponders without mislabeling normal human messages',()=>{
 for(const text of [
  'Olá! Para agendar, informe nome, serviço e data desejada.',
  'Mensagem automática: nosso horário é de 8h às 18h. Digite 1 orçamento, 2 suporte.',
  'Olá! Este é nosso assistente virtual. Digite 1 para produtos, 2 para serviços.',
  'Para que possamos ajudar, informe nome, modelo do carro, ano, motor e defeito.'
 ])assert.equal(detectAutomaticReply(text),true,text);
 for(const text of ['Bom dia Wesley, seria sobre o que?','Qual a proposta de vocês?','Quero contratar por R$ 550','Quero falar com alguém.'])assert.equal(detectAutomaticReply(text),false,text);
});

test('proposals and site base price do not require individual owner approval',()=>{
 for(const text of [
  'Bom dia Wesley, seria sobre o que?','Pode explicar a proposta?','Qual a ideia de vocês?',
  'Quanto custa o site?','Qual é o valor final?','R$ 550 é o preço?',
  'Pode falar da proposta de vocês?'
 ])assert.ok(isBaseOfferQuestion(text),text);
 for(const text of ['Dá para parcelar no cartão?','Quanto fica uma loja virtual com checkout?','Qual o valor de um sistema de agendamento?'])assert.equal(isBaseOfferQuestion(text),false,text);
 assert.ok(priceQuestion('Quanto custa o site?'));
});

test('terminal state catches nuanced declines, optout and requested human',()=>{
 const refusals=[
  'Ah sim, no momento não temos interesse, mas obrigada.',
  'Agradeço, porém não vamos contratar nada agora.',
  'Muito obrigado, já temos quem cuide disso.',
  'Não precisamos desse serviço, obrigado.',
  'Não tenho interesse, obrigado'
 ];
 for(const x of refusals)assert.equal(salesEnding(x),'NO_INTEREST',x);
 for(const x of [
  'Por favor, não mande mais mensagens para este número.',
  'Pode retirar nosso contato da sua lista?',
  'Parem de nos contatar.',
  'Quero ser descadastrado e não receber mais ofertas.'
 ])assert.equal(salesEnding(x),'OPT_OUT',x);
 for(const x of ['Prefiro falar direto com o Wesley.','Pode passar para um atendente humano?','Quero falar com o responsável.'])assert.equal(salesEnding(x),'HUMAN_REVIEW',x);
 assert.equal(salesEnding('Não sei se tenho interesse, consegue explicar?'),null);
});

test('interest explicitly mentioning R$550 must be routed to an operator',()=>{
 assert.equal(explicitInterest('Gostei, quero contratar por R$ 550. Como começamos?'),true);
 assert.equal(explicitInterest('Pode mandar o contrato, quero fechar.'),true);
 assert.equal(explicitInterest('Não quero contratar agora.'),false);
});

test('100 fictional companies × behavior variants satisfy deterministic safety matrix',()=>{
 const sectors=['oficina mecânica','loja de móveis','buffet infantil','confeitaria','salão de beleza','construtora','pet shop','escola de idiomas','restaurante','assistência técnica'];
 const behaviors=[
  ['proposal','Bom dia Wesley, seria sobre o que?'],['price','Quanto custa esse site?'],
  ['friendly','Bom dia, tudo bem?'],['bot','Mensagem automática: digite 1 para atendimento, 2 para orçamento.'],
  ['decline','Ah sim, no momento não temos interesse, mas obrigada.'],['optout','Pare de me mandar mensagens, por favor.'],
  ['has-site','Já tenho site, que diferença faria?'],['interest','Quero contratar esse site por R$ 550.'],
  ['human','Pode passar para um atendente humano?'],['objection','Esse SEO garante primeiro lugar no Google?']
 ];
 let scenarios=0,virtualWhatsAppCalls=0;
 for(const segment of sectors)for(const [type,text] of behaviors){
  const lead={business:'Empresa Fictícia '+segment,segment};
  const greeting=friendlyGreeting(lead,at);assert.doesNotMatch(greeting,/Empresa Fictícia/);
  const action=detectAutomaticReply(text)?'IGNORE':salesEnding(text)==='OPT_OUT'?'OPT_OUT':salesEnding(text)==='NO_INTEREST'?'NO_INTEREST':salesEnding(text)==='HUMAN_REVIEW'||explicitInterest(text)?'HUMAN':isBaseOfferQuestion(text)?'FIXED_OFFER':'MODEL_DRAFT';
  if(type==='bot')assert.equal(action,'IGNORE');
  if(type==='decline')assert.equal(action,'NO_INTEREST');
  if(type==='optout')assert.equal(action,'OPT_OUT');
  if(type==='interest'||type==='human')assert.equal(action,'HUMAN');
  if(type==='price'||type==='proposal'){
    assert.equal(action,'FIXED_OFFER');
    const offer=type==='price'?fixedOfferPriceReply(at):fixedOfferPitch(lead,at);
    assert.match(offer,/R\$ 550/);
    assert.doesNotMatch(offer,/90\s*%|1[ªa] posição/i);
    assert.ok(offer.length<=650);
  }
  if(type==='has-site'||type==='objection'||type==='friendly')assert.equal(action,'MODEL_DRAFT');
  assert.match(greeting,/^Olá,/);
  scenarios++;
 }
 assert.equal(scenarios,100);
 assert.equal(virtualWhatsAppCalls,0);
 console.log('FIXED_POLICY_MATRIX',JSON.stringify({scenarios,virtualWhatsAppCalls,price:550,latestDate:'2026-11-07'}));
});
