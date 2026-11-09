import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {OFFER_AB_TEXT,OFFER_AB_COPY_VERSION,OFFER_AB_AUDIO_SHA256,OFFER_AB_AUDIO_BYTES} from '../dashboard/consecom-offer-copy.mjs';
import {PROPOSAL_MESSAGES} from '../dashboard/consecom-proposal-copy.mjs';

const intro=fs.readFileSync(new URL('../dashboard/prospecting-introduction.mjs',import.meta.url),'utf8');
const sales=fs.readFileSync(new URL('../dashboard/groq-sales-automation.mjs',import.meta.url),'utf8');

test('the superseded original audio script still contains no quoted numeric price',()=>{
 assert.match(OFFER_AB_COPY_VERSION,/no-price-audio/);
 assert.doesNotMatch(OFFER_AB_TEXT,/R\$|\b550\b|\b2\.500\b|\b3\.000\b|\bpreço\b|\bvalor\b/i);
});

test('the old audio recording stays invalidated',()=>{
 assert.equal(OFFER_AB_AUDIO_SHA256,null);
 assert.equal(OFFER_AB_AUDIO_BYTES,0);
});

test('the introduction schedules four separate price-free text messages, not audio',()=>{
 assert.match(intro,/Eu me chamo Wesley, sou o dono da Agência Consecom/);
 assert.match(intro,/scheduleConsecomProposalAfterIntro\(/);
 assert.doesNotMatch(intro,/sendOfferAbAfterIntro\(/);
 assert.equal(PROPOSAL_MESSAGES.length,4);
 assert.doesNotMatch(PROPOSAL_MESSAGES.join('\n'),/R\$\s*\d+/);
});

test('the legacy A/B offer is not chosen in the new master conversation',()=>{
 assert.match(sales,/!proposalSequenceEnabled\(\)/);
});
