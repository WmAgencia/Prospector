import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {OFFER_AB_TEXT,OFFER_AB_COPY_VERSION,OFFER_AB_AUDIO_SHA256,OFFER_AB_AUDIO_BYTES} from '../dashboard/consecom-offer-copy.mjs';

const intro=fs.readFileSync(new URL('../dashboard/prospecting-introduction.mjs',import.meta.url),'utf8');
const offer=fs.readFileSync(new URL('../dashboard/consecom-offer-ab.mjs',import.meta.url),'utf8');
const sales=fs.readFileSync(new URL('../dashboard/groq-sales-automation.mjs',import.meta.url),'utf8');

test('the new recorded proposal has no price or unsupported urgency',()=>{
 assert.match(OFFER_AB_COPY_VERSION,/no-price-audio/);
 assert.doesNotMatch(OFFER_AB_TEXT,/R\$|\b550\b|\b2\.500\b|\b3\.000\b|\bpreço\b|\bvalor\b/i);
 assert.doesNotMatch(OFFER_AB_TEXT,/resposta ainda hoje|preciso entregar daqui a três dias/i);
});

test('the old price recording is invalidated until the new approved audio is uploaded',()=>{
 assert.equal(OFFER_AB_AUDIO_SHA256,null);
 assert.equal(OFFER_AB_AUDIO_BYTES,0);
});

test('the confirmed Wesley intro calls the after-intro offer hook',()=>{
 assert.match(intro,/Eu me chamo Wesley, sou o dono da Agência Consecom/);
 assert.match(intro,/await sendOfferAbAfterIntro\(/);
 assert.ok(intro.indexOf("audit('PROSPECT_INTRO_SENT'")<intro.indexOf('await sendOfferAbAfterIntro('));
});

test('after-intro audio is one-time, consent-checked and never alternates with text',()=>{
 assert.match(offer,/operatorOffer\(leadId\)!=='portfolio'/);
 assert.match(offer,/!documentedOptIn\(leadId\)/);
 assert.match(offer,/const variant='AUDIO'/);
 assert.match(offer,/first_reply_id!==providerId/);
 assert.match(sales,/SELECT 1 FROM consecom_offer_ab WHERE lead_id=\? AND status='SENT'/);
});
