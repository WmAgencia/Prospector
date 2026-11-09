import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PROPOSAL_MESSAGES,proposalTypingDelayMs,PROPOSAL_TEXT_VERSION,PROPOSAL_TEXT,PROPOSAL_TYPING_DELAYS_MS,proposalCopyIsCurrent} from '../dashboard/consecom-proposal-copy.mjs';

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
 assert.match(PROPOSAL_TEXT_VERSION,/v3-fixed-typing/);
 assert.doesNotMatch(PROPOSAL_TEXT,/R\$\s*\d+/);
});

test('exact requested durations: composing 13s, 25s, 11s and 9s',()=>{
 assert.deepEqual(PROPOSAL_TYPING_DELAYS_MS,[13000,25000,11000,9000]);
 assert.deepEqual(PROPOSAL_MESSAGES.map((_,i)=>proposalTypingDelayMs(i)),[13000,25000,11000,9000]);
 assert.throws(()=>proposalTypingDelayMs(4),RangeError);
});

test('the four WhatsApp messages preserve the operator exact words',()=>{
 assert.deepEqual(PROPOSAL_MESSAGES,[
  "Então, a minha agencia precisa entregar um projeto daqui 3 dias, e nós precisamos de mais um site para servir de portifólio para esse projeto, e eu achei que sua empresa vai servir certinho pra gente!",
  "A proposta é a seguinte, eu quero fazer um site pra vocês em tempo record já que preciso entregar em 3 dias, e ainda vou dar 1 ano de domínio grátis pra vocês, com SEO Master, que só nós fazemos na região, que vai fazer vocês estarem muito acima das pesquisas dos seus concorrentes no google de forma orgânica, e eu quero fazer isso pelo preço de custo pra gente fechar isso hoje e já começar a produção",
  "Eu vou deixar aqui alguns sites do nosso portifólio para vocês darem uma olhada\n\nhttps://consecom.com.br/\nhttps://oficinasc.com/\nhttps://quimerasite.vercel.app/\nhttps://tweco.com.br/",
  "Me diz aqui se conseguimos fazer essa parceiria, que já iniciamos hoje!"
 ]);
});

test('date-relative proposal is not reused on future days',()=>{
 assert.equal(proposalCopyIsCurrent(new Date('2026-11-09T15:00:00Z')),true);
 assert.equal(proposalCopyIsCurrent(new Date('2026-11-10T15:00:00Z')),false);
});

test('outbox prevents duplicate, stale, unauthorized and uncertain sends',()=>{
 const code=fs.readFileSync(new URL('../dashboard/consecom-proposal-sequence.mjs',import.meta.url),'utf8');
 for(const marker of ['ownerProspectionPaused','documentedOptIn','conversationAuthorized','manual_takeover','CUSTOMER_REPLIED',"state='SENDING'","state='UNKNOWN'","presence:'composing'","presence:'paused'",'PROPOSAL_MESSAGES[row.next_index]','proposalTypingDelayMs(row.next_index)','typing_started_at','signal?.status!==true','proposalCopyIsCurrent'])
  assert.ok(code.includes(marker),marker);
});

test('Wesley intro schedules the multi-part text, never the old audio',()=>{
 const code=fs.readFileSync(new URL('../dashboard/prospecting-introduction.mjs',import.meta.url),'utf8');
 assert.match(code,/scheduleConsecomProposalAfterIntro/);
 assert.doesNotMatch(code,/sendOfferAbAfterIntro/);
});
