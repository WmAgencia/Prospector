import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PROPOSAL_MESSAGES,proposalTypingDelayMs,PROPOSAL_TEXT_VERSION,PROPOSAL_TEXT,proposalCopyIsCurrent} from '../dashboard/consecom-proposal-copy.mjs';

test('exactly four WhatsApp bubbles with all portfolio links in bubble three',()=>{
 assert.equal(PROPOSAL_MESSAGES.length,4);
 assert.match(PROPOSAL_MESSAGES[0],/^Então, a minha agencia/);
 assert.match(PROPOSAL_MESSAGES[1],/^A proposta é a seguinte/);
 assert.match(PROPOSAL_MESSAGES[2],/^Eu vou deixar aqui alguns sites/);
 assert.deepEqual(PROPOSAL_MESSAGES[2].split('\n').filter(x=>x.startsWith('https://')),[
  'https://consecom.com.br/',
  'https://oficinasc.com/',
  'https://quimerasite.vercel.app/',
  'https://tweco.com.br/'
 ]);
 assert.match(PROPOSAL_MESSAGES[3],/^Me diz aqui se conseguimos fazer essa parceiria, que já iniciamos hoje!$/);
 assert.ok(PROPOSAL_MESSAGES.slice(0,2).every(x=>!x.includes('\n')));
 assert.equal(PROPOSAL_TEXT,PROPOSAL_MESSAGES.join('\n\n'));
 assert.match(PROPOSAL_TEXT_VERSION,/v2-four-parts/);
 assert.doesNotMatch(PROPOSAL_TEXT,/R\$\s*\d+/);
});

test('human-paced typing is proportional to message length',()=>{
 assert.ok(proposalTypingDelayMs(PROPOSAL_MESSAGES[0])>=13000);
 assert.ok(proposalTypingDelayMs(PROPOSAL_MESSAGES[1])>proposalTypingDelayMs(PROPOSAL_MESSAGES[0]));
 assert.ok(proposalTypingDelayMs(PROPOSAL_MESSAGES[1])<=45000);
 assert.ok(proposalTypingDelayMs(PROPOSAL_MESSAGES[3])>=2200);
 assert.equal(proposalTypingDelayMs('x'.repeat(1500)),45000);
});

test('date-relative proposal is not reused on future days',()=>{
 assert.equal(proposalCopyIsCurrent(new Date('2026-11-09T15:00:00Z')),true);
 assert.equal(proposalCopyIsCurrent(new Date('2026-11-10T15:00:00Z')),false);
});

test('outbox prevents duplicate, stale, unauthorized and uncertain sends',()=>{
 const code=fs.readFileSync(new URL('../dashboard/consecom-proposal-sequence.mjs',import.meta.url),'utf8');
 for(const marker of ['ownerProspectionPaused','documentedOptIn','conversationAuthorized','manual_takeover','CUSTOMER_REPLIED',"state='SENDING'","state='UNKNOWN'","presence:'composing'","presence:'paused'",'PROPOSAL_MESSAGES[row.next_index]','proposalCopyIsCurrent'])
  assert.ok(code.includes(marker),marker);
});

test('Wesley intro schedules the multi-part text, never the old audio',()=>{
 const code=fs.readFileSync(new URL('../dashboard/prospecting-introduction.mjs',import.meta.url),'utf8');
 assert.match(code,/scheduleConsecomProposalAfterIntro/);
 assert.doesNotMatch(code,/sendOfferAbAfterIntro/);
});
