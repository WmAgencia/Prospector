import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyOwnerProposalIntent as classify,OWNER_PROPOSAL_INTENT as I} from '../dashboard/owner-proposal-interest.mjs';

test('positive human responses after the introduction select the owner recording',()=>{
 const yes=[
 'Pode falar', 'beleza', 'Beleza, pode falar', 'Pode prosseguir',
 'Prossegue', 'Pode explicar', 'Pode mandar', 'Sim, manda',
 'claro', 'pode ser', 'OK', 'blz', 'Manda aí', 'Pode continuar',
 'O que seria sobre a proposta?', 'Que tipo de proposta?', 'Como funciona a proposta?',
 'Tenho interesse', 'Quero ouvir', 'Me conta mais sobre a oferta',
 'Qual o valor?', 'Gostei da ideia', 'Tô ouvindo', 'Estou ouvindo'
 ];
 for(const phrase of yes)assert.equal(classify(phrase),I.ACCEPT,phrase);
});
test('declines and time deferrals never trigger unsolicited owner audio',()=>{
 for(const phrase of ['Não tenho interesse','Não, obrigado, pode deixar','agora não',
 'Beleza, tô ocupado','mais tarde','Pode falar amanhã','Me chama depois',
 'Não quero ouvir','não me mande mais mensagens','sem interesse']){
  assert.equal(classify(phrase),I.DECLINE,phrase);
 }
});
test('respect customer preference for written explanation',()=>{
 for(const phrase of ['Prefiro em texto','Quero por texto','Sem áudio','Não quero áudio'])
  assert.equal(classify(phrase),I.TEXT_ONLY,phrase);
});
test('greetings without interest do not themselves qualify as audio consent',()=>{
 for(const phrase of ['oi','bom dia','quem é?','estou sem sinal','obrigado'])
  assert.equal(classify(phrase),I.UNCLEAR,phrase);
});
