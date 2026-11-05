import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyInboundAutomation} from '../dashboard/inbound-automation.mjs';
const machines=[
 'Olá! Sou uma inteligência artificial e vou auxiliar no atendimento.',
 'Aqui é a assistente virtual da empresa. Como posso ajudar?',
 'Olá, sou o bot do atendimento.',
 'Sou a atendente virtual da empresa, como posso ajudar?',
 'Sou Alex, assistente virtual da empresa.',
 'Seja muito bem vindo à Oficina Exemplo! Como podemos ajudar?',
 'A equipe agradece seu contato. Em que podemos ajudar?',
 'Estamos ausentes no momento. Retornaremos assim que possível.',
 'Estamos fora do horário de atendimento. Retornaremos em breve.',
 'Digite 1 para orçamento, 2 para suporte.',
 'Selecione uma das opções para continuar.',
 'Para agendar, informe seu nome, serviço e data.',
 'Mensagem automática: deixe seu recado.',
];
test('known AI, menus, canned welcome and absence messages wait for a human reply',()=>{
 for(const text of machines){const result=classifyInboundAutomation(text);assert.equal(result.blocked,true,text);assert.equal(result.action,'WAIT_HUMAN',text);}
});
test('redirects to another number or WhatsApp link require manual review',()=>{
 for(const text of [
  'Para orçamento entre em contato no WhatsApp (11) 90000-1234.',
  'Fale com o responsável pelo número +55 11 90000-5678.',
  'Chame neste link: https://wa.me/5511900001234',
 ])assert.deepEqual(classifyInboundAutomation(text),{blocked:true,reason:'CONTACT_REDIRECT',action:'HUMAN_REVIEW'});
});
test('contextual human replies and questions about AI are not machine confirmations',()=>{
 for(const text of [
  'Bom dia, tudo bem com você? Eu estou bem, graças a Deus.',
  'Prazer, eu sou a pessoa responsável. Como funciona sua proposta?',
  'Já estou com uma pessoa cuidando disso.',
  'Podemos conversar pessoalmente hoje?',
  'Estou atendendo agora, manda os detalhes da proposta que vejo depois.',
  'Estou com clientes, deixa a proposta aqui que depois respondo.',
  'Vocês usam inteligência artificial?',
  'Você é um assistente virtual?',
  'Não sou um robô, sou a pessoa responsável.',
  'Recebi uma mensagem automática de vocês, mas quero entender a proposta.',
  'Quero colocar meu número (11) 90000-1234 no site.',
  'Você consegue fazer um assistente virtual para minha empresa?',
  'Nosso horário de atendimento é das oito às dezoito, podemos conversar amanhã?',
 ])assert.equal(classifyInboundAutomation(text).blocked,false,text);
});
