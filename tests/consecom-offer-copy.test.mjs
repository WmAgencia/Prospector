import test from 'node:test';
import assert from 'node:assert/strict';
import {ORIGINAL_OFFER_AUDIO_TRANSCRIPT,OFFER_AB_TEXT} from '../dashboard/consecom-offer-copy.mjs';

test('proposta escrita reproduz a transcrição original, alterando só referência ao canal',()=>{
 const onlyChannelAdaptation=ORIGINAL_OFFER_AUDIO_TRANSCRIPT.replace(
  'Vou te explicar aqui por áudio, que é mais fácil.',
  'Vou te explicar aqui, que é mais fácil.'
 );
 assert.equal(OFFER_AB_TEXT,onlyChannelAdaptation);
 assert.match(OFFER_AB_TEXT,/na segunda-feira/);
 assert.match(OFFER_AB_TEXT,/dois mil e quinhentos reais a três mil reais/);
 assert.match(OFFER_AB_TEXT,/quinhentos e cinquenta reais/);
 assert.match(OFFER_AB_TEXT,/Master SEO/);
 assert.match(OFFER_AB_TEXT,/Instagram, no portfólio/);
 assert.ok(!OFFER_AB_TEXT.includes('por áudio'));
});

test('a proposta A/B escrita preserva a conclusão do áudio',()=>{
 assert.match(OFFER_AB_TEXT,/Nenhum cliente que faz site com a gente sai insatisfeito/);
 assert.match(OFFER_AB_TEXT,/sem dúvidas nenhuma, também vai ajudar muito a gente aqui\./);
});
