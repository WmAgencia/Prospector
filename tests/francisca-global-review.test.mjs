import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'francisca-global-review-'));
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.PROSPECTOR_TENANT_ID='review-global-test-tenant';
const {trainingStatus,trainingPrompt,handleTraining}=await import('../dashboard/training.mjs');
const {getSetting}=await import('../dashboard/db.mjs');
async function call(input){
 let status,body;
 await handleTraining({method:'POST'},null,new URL('http://localhost/api/training/global-cards'),
  {json:async()=>input,respond:(_res,code,payload)=>{status=code;body=payload;}});
 return {status,body};
}
test('shared method is only hidden for this workspace, and never changed in the actual model prompt',async()=>{
 const beforePrompt=trainingPrompt();
 const cards=trainingStatus().review.globalCards;
 assert.ok(cards.length>3);
 const id=cards[1].id;
 const hidden=await call({action:'hide',id});
 assert.equal(hidden.status,200);
 assert.ok(!hidden.body.review.globalCards.some(x=>x.id===id));
 assert.equal(hidden.body.review.hiddenGlobalCount,1);
 assert.equal(trainingPrompt(),beforePrompt,'global guidance must remain active');
 assert.deepEqual(getSetting('training_review_hidden_shared_cards_v1'),[id]);
 const restored=await call({action:'restore'});
 assert.equal(restored.status,200);
 assert.equal(restored.body.review.hiddenGlobalCount,0);
 assert.ok(restored.body.review.globalCards.some(x=>x.id===id));
 assert.equal(trainingPrompt(),beforePrompt);
});
test('cannot hide any card by fabricating its id',async()=>{
 const invalid=await call({action:'hide',id:'not-in-the-shared-manual'});
 assert.equal(invalid.status,422);
 assert.match(invalid.body.error,/não encontrada/i);
});
test.after(()=>{fs.rmSync(dir,{recursive:true,force:true});});
