import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'francisca-review-cards-'));
process.env.PROSPECTOR_DATA_DIR=dataDir;
const {reviewSections,publicReviewCards,reviewTextState,modifyReviewMarkdown,createCardDraft}=await import('../dashboard/training-review-cards.mjs');
const {getSetting,setSetting}=await import('../dashboard/db.mjs');
const markdown='# Francisca — Empresa\n\n> Regras internas aprovadas.\n\n## Atendimento\n- Faça uma pergunta por vez.\n- Quando perguntarem sobre preço, explique o serviço primeiro.\n\n## Materiais e serviços\n- Mostre o portfólio somente quando aprovado.\n### Condições\n- Nunca prometa vendas garantidas.\n';
test('readable card list covers all sections but does not expose raw Markdown in labels',()=>{
 const sections=reviewSections(markdown);
 assert.equal(sections.length,3);
 assert.equal(sections[1].title,'Atendimento');
 assert.ok(sections[1].points.some(x=>x.includes('Faça uma pergunta por vez')));
 assert.equal(sections[2].title,'Materiais e serviços');
 assert.ok(sections[2].points.some(x=>x.includes('Nunca prometa')));
 assert.ok(!publicReviewCards(markdown)[0].raw);
});
test('manager edits one card, leaves other sections untouched, prepares review only',()=>{
 const start=reviewTextState(markdown,null);
 const current=start.cards.find(c=>c.title==='Atendimento');
 const updated=modifyReviewMarkdown(markdown,{action:'edit',index:current.index,cardId:current.id,title:'Respostas e preços',body:'Pergunte o serviço que a pessoa procura.\nNão prometa preço sem confirmação.',version:start.version});
 assert.ok(updated.includes('## Respostas e preços'));
 assert.ok(updated.includes('## Materiais e serviços'));
 assert.ok(updated.includes('Nunca prometa vendas garantidas'));
 assert.ok(!updated.includes('Faça uma pergunta por vez'));
 assert.throws(()=>modifyReviewMarkdown(updated,{action:'edit',index:current.index,cardId:current.id,title:'Novo',body:'Corpo de orientação válido'}),/desatualizada|alterada/i);
});
test('new rule goes to a private draft pending approval, with optimistic stale-version check',()=>{
 setSetting('training_draft',null);
 const before=getSetting('training_active',null);
 const result=createCardDraft({action:'add',title:'Pedidos de desconto',body:'Se o cliente pedir desconto, consulte o gestor antes de prometer outro valor.',version:reviewTextState(markdown,null).version},markdown);
 assert.equal(result.review.hasPendingReview,true);
 assert.ok(result.review.cards.some(x=>x.title==='Pedidos de desconto'));
 assert.equal(getSetting('training_active',null),before);
 assert.equal(getSetting('training_draft').id,result.draft.id);
 assert.throws(()=>createCardDraft({action:'add',title:'Outra',body:'A instrução não pode ser aplicada à versão antiga.',version:reviewTextState(markdown,null).version},markdown),/atualizado/i);
});
test('brief summary explains a real behavior rather than copying document metadata or raw Markdown',()=>{
 const sample='# Francisca — Documento técnico\n**Versão:** 1.0\n\n## Como responder sobre preços\n- Quando perguntarem o preço, informe apenas os valores aprovados pela empresa; se o valor não estiver disponível, peça ao responsável.\n- Nunca invente descontos ou condições diferentes do contrato vigente.\n';
 const cards=publicReviewCards(sample);
 assert.equal(cards.length,1,'Do not show the document title as a behavior card');
 assert.equal(cards[0].title,'Como responder sobre preços');
 assert.match(cards[0].summary,/Quando perguntarem o preço/);
 assert.doesNotMatch(cards[0].summary,/Versão|Documento técnico|##/);
 assert.ok(cards[0].summary.length<=210);
});
test('approved guidance can be deleted through a pending draft only, without erasing neighboring rules',()=>{
 setSetting('training_draft',null);
 const baseline=reviewTextState(markdown,null);
 const selected=baseline.cards.find(c=>c.title==='Atendimento');
 assert.ok(selected);
 const result=createCardDraft({action:'delete',index:selected.index,cardId:selected.id,version:baseline.version},markdown);
 assert.equal(result.review.hasPendingReview,true);
 assert.ok(!result.draft.text.includes('## Atendimento'));
 assert.ok(result.draft.text.includes('## Materiais e serviços'));
 assert.ok(markdown.includes('## Atendimento'),'approved source must not be changed');
 assert.throws(()=>modifyReviewMarkdown(result.draft.text,{action:'delete',index:selected.index,cardId:selected.id,version:baseline.version}),/atualizado/i);
});
test('duplicate identical headings are edited/deleted by exact position, never by the first matching text',()=>{
 const duplicates='# Orientações da empresa\n\n## Regras\nSempre responder com clareza e respeito.\n\n## Regras\nSempre responder com clareza e respeito.\n\n## Fechamento\nConferir as condições autorizadas antes de concluir.\n';
 const before=reviewTextState(duplicates,null);
 const second=before.cards.filter(x=>x.title==='Regras')[1];
 assert.ok(second);
 const updated=modifyReviewMarkdown(duplicates,{action:'edit',index:second.index,cardId:second.id,title:'Regras da segunda parte',body:'Orientação corrigida somente na segunda seção.',version:before.version});
 assert.equal((updated.match(/## Regras\n/g)||[]).length,1);
 assert.ok(updated.includes('## Regras da segunda parte'));
 assert.ok(updated.includes('## Fechamento'));
 const state=reviewTextState(updated,null);
 const target=state.cards.find(x=>x.title==='Regras da segunda parte');
 const removed=modifyReviewMarkdown(updated,{action:'delete',index:target.index,cardId:target.id,version:state.version});
 assert.ok(removed.includes('## Regras\n'));
 assert.ok(removed.includes('## Fechamento'));
 assert.ok(!removed.includes('## Regras da segunda parte'));
});
test('editing a long approved card keeps the text beyond its visible preview',()=>{
 const bullets=Array.from({length:100},(_,i)=>'- Quando surgir uma situação comercial '+(i+1)+', confirme apenas as condições aprovadas pela empresa.').join('\n');
 const long='# Manual de atendimento\n\n## Orientações completas\n'+bullets+'\n';
 const card=reviewTextState(long,null).cards[0];
 assert.equal(card.points.length,80,'Expanded preview intentionally limits list height');
 assert.match(card.editText,/situação comercial 100/);
 assert.ok(card.editText.length>card.summary.length);
});
test(' UI has no plain Markdown preview; includes search, add/edit, material review, checklist and analysis',()=>{
 const src=fs.readFileSync(new URL('../dashboard/public/simple-app.js',import.meta.url),'utf8');
 assert.match(src,/id="training-review-search"/);
 assert.match(src,/data-action="training-review-edit"/);
 assert.match(src,/data-action="training-review-add"/);
 assert.match(src,/data-action="training-review-approve"/);
 assert.match(src,/training-proof-edit/);
 assert.match(src,/franciscaOnboarding/);
 assert.match(src,/fr-setup-widget/);
 assert.match(src,/fr-analysis-progress/);
 assert.doesNotMatch(src,/function offerAbCard\(\)/);
 assert.doesNotMatch(src,/class="profile-text"/);
});
test.after(()=>{fs.rmSync(dataDir,{recursive:true,force:true})});
