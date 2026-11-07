import test from 'node:test';
import assert from 'node:assert/strict';
import {OFFER_AB_COPY_VERSION,OFFER_AB_TEXT,OFFER_AB_AUDIO_SCRIPT,offerDeadlineMatchesScript} from '../dashboard/consecom-offer-copy.mjs';

test('nova proposta de áudio e texto usa exatamente o mesmo roteiro',()=>{
 assert.equal(OFFER_AB_AUDIO_SCRIPT,OFFER_AB_TEXT);
 assert.match(OFFER_AB_COPY_VERSION,/2026-11-07-v2/);
 assert.match(OFFER_AB_TEXT,/portfólio do seu nicho daqui a três dias/);
 assert.match(OFFER_AB_TEXT,/mais um site desse segmento pra concluir esse projeto/);
 assert.match(OFFER_AB_TEXT,/cerca de 80%/);
 assert.ok(OFFER_AB_TEXT.includes('R$ 550'));
 assert.ok(OFFER_AB_TEXT.includes('R$ 2.500 e R$ 3.000'));
 assert.match(OFFER_AB_TEXT,/um ano de domínio sem custo extra/);
 assert.match(OFFER_AB_TEXT,/Instagram e no site da Consecom/);
 assert.match(OFFER_AB_TEXT,/resposta ainda hoje/);
 assert.doesNotMatch(OFFER_AB_TEXT,/segunda-feira|por áudio|entendeu|primeiro lugar no Google|clientes garantidos/i);
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
