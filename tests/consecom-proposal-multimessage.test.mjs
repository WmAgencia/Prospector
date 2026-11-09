import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PROPOSAL_MESSAGES,proposalTypingDelayMs,PROPOSAL_TEXT_VERSION} from '../dashboard/consecom-proposal-copy.mjs';

test('the provided seven nonempty lines become seven separate WhatsApp messages',()=>{
 assert.equal(PROPOSAL_MESSAGES.length,7);
 assert.match(PROPOSAL_MESSAGES[0],/^Então, a minha agencia/);
 assert.match(PROPOSAL_MESSAGES[1],/^A proposta é a seguinte/);
 assert.match(PROPOSAL_MESSAGES[2],/^Eu vou deixar aqui alguns sites/);
 assert.deepEqual(PROPOSAL_MESSAGES.slice(3),[
  'https://consecom.com.br/','https://oficinasc.com/',
  'https://quimerasite.vercel.app/','https://tweco.com.br/'
 ]);
 assert.ok(PROPOSAL_MESSAGES.every(part=>part.length>0&&!part.includes('\n')));
 assert.doesNotMatch(PROPOSAL_MESSAGES.join(' '),/R\$\s*\d+/);
 assert.match(PROPOSAL_TEXT_VERSION,/multimessage/);
});

test('typing takes a plausible time and longer texts take longer',()=>{
 assert.ok(proposalTypingDelayMs(PROPOSAL_MESSAGES[0])>=13000);
 assert.ok(proposalTypingDelayMs(PROPOSAL_MESSAGES[1])>proposalTypingDelayMs(PROPOSAL_MESSAGES[0]));
 assert.ok(proposalTypingDelayMs(PROPOSAL_MESSAGES[1])<=45000);
 assert.ok(proposalTypingDelayMs(PROPOSAL_MESSAGES[3])>=2200);
 assert.equal(proposalTypingDelayMs('x'.repeat(1500)),45000);
});

test('outbox guards against duplicate sends, pause, opt-out and new incoming messages',()=>{
 const code=fs.readFileSync(new URL('../dashboard/consecom-proposal-sequence.mjs',import.meta.url),'utf8');
 assert.match(code,/ownerProspectionPaused/);
 assert.match(code,/documentedOptIn/);
 assert.match(code,/conversationAuthorized/);
 assert.match(code,/manual_takeover/);
 assert.match(code,/CUSTOMER_REPLIED/);
 assert.match(code,/state='SENDING'/);
 assert.match(code,/state='UNKNOWN'/);
 assert.match(code,/presence:'composing'/);
 assert.match(code,/presence:'paused'/);
 assert.match(code,/PROPOSAL_MESSAGES\[row\.next_index\]/);
});

test('Wesley introduction schedules the text sequence but never directly sends the old audio',()=>{
 const code=fs.readFileSync(new URL('../dashboard/prospecting-introduction.mjs',import.meta.url),'utf8');
 assert.match(code,/scheduleConsecomProposalAfterIntro/);
 assert.doesNotMatch(code,/sendOfferAbAfterIntro/);
});
