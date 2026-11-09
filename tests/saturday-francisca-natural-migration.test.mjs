// No real contacts, WhatsApp transports or network calls. Runs before deploy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'francisca-saturday-natural-'));
process.env.PROSPECTOR_DATA_DIR=directory;
process.env.GROQ_API_KEY='offline-synthetic-test-only';
process.env.FRANCISCA_NATURAL_V1_ENABLED='true';
process.env.FRANCISCA_COMPACT_PROMPT_V3_ENABLED='true';
process.env.FRANCISCA_STYLE_EXAMPLES_V1_ENABLED='true';
process.env.FRANCISCA_COMMERCIAL_BRAIN_V2_ENABLED='true';
delete process.env.PROSPECTOR_TENANT_ID;
delete process.env.PROSPECTOR_TENANT_INTERNAL;
const natural=await import('../dashboard/francisca-natural-conversation.mjs');
const style=await import('../dashboard/francisca-style-examples.mjs');
const {compactPromptEnabled}=await import('../dashboard/francisca-compact-policy-v3.mjs');
const brain=await import('../dashboard/francisca-commercial-brain.mjs');
const {aiStatus,aiDraft}=await import('../dashboard/ai-groq.mjs');
const {generate100FranciscaScenarios,evaluateFrancisca100}=await import('../dashboard/francisca-quality-evaluator.mjs');
const {db}=await import('../dashboard/db.mjs');
test.after(()=>{try{db.close()}catch{}fs.rmSync(directory,{recursive:true,force:true});});

test('Saturday outreach eligibility remains byte-for-byte unchanged',()=>{
 const body=fs.readFileSync(new URL('../dashboard/prospecting-queue.mjs',import.meta.url));
 const prefix=Buffer.from('blob '+body.byteLength+'\0');
 const sha=crypto.createHash('sha1').update(Buffer.concat([prefix,body])).digest('hex');
 assert.equal(sha,'f1f7f8274a91ab47efd4569f7a13977c63382483');
});

test('Natural v3 features are internal-only, with original outbound permissions unaffected',()=>{
 assert.equal(aiStatus().naturalConversation.enabled,true);
 assert.equal(aiStatus().compactPolicy.enabled,true);
 assert.equal(aiStatus().styleMemory.enabled,true);
 assert.equal(aiStatus().commercialBrain.enabled,true);
 const other={FRANCISCA_NATURAL_V1_ENABLED:'true',FRANCISCA_STYLE_EXAMPLES_V1_ENABLED:'true',FRANCISCA_COMPACT_PROMPT_V3_ENABLED:'true',FRANCISCA_COMMERCIAL_BRAIN_V2_ENABLED:'true',PROSPECTOR_TENANT_ID:'client-a',PROSPECTOR_TENANT_INTERNAL:'false'};
 assert.equal(natural.naturalConversationEnabled(other),false);
 assert.equal(style.styleMemoryEnabled(other),false);
 assert.equal(compactPromptEnabled(other),false);
 assert.equal(brain.commercialBrainEnabled(other),false);
});

test('Francisca receives natural instructions, context and style without model/network access',async()=>{
 let request=null;
 const response=await aiDraft({text:'Meu site está lento no celular',context:'Cliente: Estou tentando melhorar meu site',audience:'PROSPECT_APPROACHED',
  dialogueState:{hasAssistantReply:true,offerApproved:false},chat:async payload=>{
   request=payload;return {model:'OFFLINE_MOCK',choice:{content:'Pode ter alguma coisa deixando o site pesado. Se você tiver os arquivos, eu consigo ajudar a investigar.'}};
  }});
 assert.equal(response.ok,true);
 assert.equal(response.naturalConversation,true);
 assert.equal(response.compactPolicy,true);
 assert.equal(response.styleMemory,true);
 assert.equal(response.commercialBrain,true);
 assert.match(request.messages[0].content,/FRANCISCA NATURAL V3/);
 assert.match(request.messages[0].content,/não.*repita|não.*reinicie|não.*volte/i);
 assert.equal(request.messages.at(-1).role,'user');
 assert.match(request.messages.at(-1).content,/Meu site está lento no celular/);
 assert.doesNotMatch(request.messages.at(-1).content,/Sugira uma resposta/);
});

test('Natural features do not enable unapproved tenant answers',()=>{
 const other={FRANCISCA_NATURAL_V1_ENABLED:'true',PROSPECTOR_TENANT_ID:'external',PROSPECTOR_TENANT_INTERNAL:'false'};
 assert.equal(natural.naturalConversationEnabled(other),false);
 const plan=brain.analyzeCommercialTurn({incoming:'Já tenho um site mas está muito lento',memory:{}});
 assert.equal(typeof plan.stage,'string');
});

test('100 synthetic dialogue cases are calibrated offline',()=>{
 assert.equal(generate100FranciscaScenarios().length,100);
 const result=evaluateFrancisca100();
 assert.equal(result.kind,'OFFLINE_HEURISTIC');
 assert.equal(result.failed,0);
 assert.equal(result.passed,100);
});
