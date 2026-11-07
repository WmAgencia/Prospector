import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'francisca-review-cards-'));
process.env.PROSPECTOR_DATA_DIR=dataDir;
const {reviewSections,publicReviewCards,reviewTextState,modifyReviewMarkdown,createCardDraft}=await import('../dashboard/training-review-cards.mjs');
const {getSetting}=await import('../dashboard/db.mjs');
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
 const current=start.cards[1];
 const updated=modifyReviewMarkdown(markdown,{action:'edit',index:current.index,cardId:current.id,title:'Respostas e preços',body:'Pergunte o serviço que a pessoa procura.\nNão prometa preço sem confirmação.',version:start.version});
 assert.ok(updated.includes('## Respostas e preços'));
 assert.ok(updated.includes('## Materiais e serviços'));
 assert.ok(updated.includes('Nunca prometa vendas garantidas'));
 assert.ok(!updated.includes('Faça uma pergunta por vez'));
 assert.throws(()=>modifyReviewMarkdown(updated,{action:'edit',index:current.index,cardId:current.id,title:'Novo',body:'Corpo de orientação válido'}),/desatualizada|alterada/i);
});
test('new rule goes to a private draft pending approval, with optimistic stale-version check',()=>{
 const before=getSetting('training_active',null);
 const result=createCardDraft({action:'add',title:'Pedidos de desconto',body:'Se o cliente pedir desconto, consulte o gestor antes de prometer outro valor.',version:reviewTextState(markdown,null).version},markdown);
 assert.equal(result.review.hasPendingReview,true);
 assert.ok(result.review.cards.some(x=>x.title==='Pedidos de desconto'));
 assert.equal(getSetting('training_active',null),before);
 assert.equal(getSetting('training_draft').id,result.draft.id);
 assert.throws(()=>createCardDraft({action:'add',title:'Outra',body:'A instrução não pode ser aplicada à versão antiga.',version:reviewTextState(markdown,null).version},markdown),/atualizado/i);
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
