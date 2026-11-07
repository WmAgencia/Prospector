import test from 'node:test';
import assert from 'node:assert/strict';
import {OFFER_AB_COPY_VERSION,OFFER_AB_TEXT,OFFER_AB_AUDIO_SCRIPT,OFFER_AB_REFERENCES_TEXT,OFFER_AB_REFERENCES_DELAY_MS,offerDeadlineMatchesScript} from '../dashboard/consecom-offer-copy.mjs';

test('áudio e texto de proposta usam roteiro v3 correspondente à instrução do operador',()=>{
 assert.equal(OFFER_AB_AUDIO_SCRIPT,OFFER_AB_TEXT);
 assert.match(OFFER_AB_COPY_VERSION,/2026-11-07-v3/);
 assert.match(OFFER_AB_TEXT,/uma empresa que está fechando com a gente, daqui a três dias/);
 assert.match(OFFER_AB_TEXT,/mais um site desse segmento pra concluir esse projeto/);
 assert.match(OFFER_AB_TEXT,/SEO Master/);
 assert.match(OFFER_AB_TEXT,/entregar em 3 dias/);
 assert.match(OFFER_AB_TEXT,/cerca de 80%/);
 assert.ok(OFFER_AB_TEXT.includes('R$ 550'));
 assert.ok(OFFER_AB_TEXT.includes('R$ 2.500 e R$ 3.000'));
 assert.match(OFFER_AB_TEXT,/um ano de domínio sem custo extra/);
 assert.match(OFFER_AB_TEXT,/Instagram e no site da Consecom/);
 assert.match(OFFER_AB_TEXT,/resposta ainda hoje/);
 assert.doesNotMatch(OFFER_AB_TEXT,/na segunda-feira|por áudio|entendeu|clientes garantidos/i);
});

test('referências ficam em uma única segunda mensagem após 25 segundos',()=>{
 assert.equal(OFFER_AB_REFERENCES_DELAY_MS,25_000);
 assert.ok(OFFER_AB_REFERENCES_TEXT.startsWith('Vou te enviar aqui algumas referências do nosso trabalho 👇'));
 const links=[
  'https://consecom.com.br/',
  'https://tweco.com.br/',
  'https://quimerasite.vercel.app/',
  'https://oficinasc.com/'
 ];
 for(const link of links){
  assert.equal(OFFER_AB_REFERENCES_TEXT.split(link).length-1,1,'Link duplicado ou ausente: '+link);
  assert.equal(OFFER_AB_TEXT.includes(link),false,'Não colocar referências no texto inicial');
 }
 assert.equal(OFFER_AB_REFERENCES_TEXT.split('\n').length,5);
});

test('promessa de três dias corridos fica elegível somente na data correta',()=>{
 const confirmedAt='2026-11-07T12:00:00.000Z';
 const at=new Date('2026-11-07T13:00:00.000Z');
 assert.equal(offerDeadlineMatchesScript({portfolioDueDate:'2026-11-10',confirmedAt},at),true);
 assert.equal(offerDeadlineMatchesScript({portfolioDueDate:'2026-11-10',confirmedAt},new Date('2026-11-08T13:00:00Z')),false);
 assert.equal(offerDeadlineMatchesScript({portfolioDueDate:'2026-11-11',confirmedAt},at),false);
 assert.equal(offerDeadlineMatchesScript({portfolioDueDate:'2026-02-30',confirmedAt},at),false);
 assert.equal(offerDeadlineMatchesScript({portfolioDueDate:'2026-11-10',confirmedAt:null},at),false);
});
