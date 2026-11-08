// Offline synthetic conversation tests. Never sends WhatsApp messages,
// opens a real model connection or reads personal/customer data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'francisca-natural-v1-'));
process.env.PROSPECTOR_DATA_DIR=temp;
process.env.GROQ_API_KEY='unused-offline-test-placeholder';
process.env.FRANCISCA_NATURAL_V1_ENABLED='true';
delete process.env.PROSPECTOR_TENANT_ID;
delete process.env.PROSPECTOR_TENANT_INTERNAL;
const natural=await import('../dashboard/francisca-natural-conversation.mjs');
const {aiDraft,aiStatus}=await import('../dashboard/ai-groq.mjs');

test('rollout flag is explicit and never leaks to ordinary tenants',()=>{
 assert.equal(natural.naturalConversationEnabled({FRANCISCA_NATURAL_V1_ENABLED:'false'}),false);
 assert.equal(natural.naturalConversationEnabled({FRANCISCA_NATURAL_V1_ENABLED:'true'}),true);
 assert.equal(natural.naturalConversationEnabled({FRANCISCA_NATURAL_V1_ENABLED:'true',PROSPECTOR_TENANT_ID:'client-123'}),false);
 assert.equal(natural.naturalConversationEnabled({FRANCISCA_NATURAL_V1_ENABLED:'true',PROSPECTOR_TENANT_ID:'client-123',PROSPECTOR_TENANT_INTERNAL:'true'}),true);
 assert.equal(aiStatus().naturalConversation.enabled,true);
});
test('situation-specific guidance is selective, not a giant generic script',()=>{
 const r=natural.planNaturalTurn({incoming:'Eu já tenho site no Wix e achei muito caro',dialogueState:{hasAssistantReply:true}});
 assert.equal(r.intent,'already_site');
 assert.equal(r.activePolicies.length,2);
 assert.equal(r.activePolicies[1].id,'price_objection');
 const prompt=natural.naturalConversationInstructions({incoming:'Eu já tenho site no Wix e achei muito caro',dialogueState:{hasAssistantReply:true}});
 assert.match(prompt,/Não ofereça automaticamente outro site/);
 assert.match(prompt,/Não invente desconto/);
 assert.match(prompt,/JÁ começou/);
 assert.doesNotMatch(prompt,/É continuação do diálogo anterior/);
});
test('register adaptation is polite and never imitates customer mistakes',()=>{
 const polite=natural.planNaturalTurn({incoming:'Por gentileza, poderia me informar como funciona a proposta?'});
 assert.equal(polite.register,'FORMAL');
 const casual=natural.planNaturalTurn({incoming:'opa, blz? vc faz site pra minha loja?'});
 assert.equal(casual.register,'COLLOQUIAL');
 const instructions=natural.naturalConversationInstructions({incoming:'opa, blz? vc faz site pra minha loja?'});
 assert.match(instructions,/Não imite erros/);
 assert.match(instructions,/assistente comercial virtual/);
});
test('customer busy, follow-up, rejection, identity and closing get distinct advice',()=>{
 const cases=[
  ['Tô atendendo agora. Manda pra eu ver depois.','busy','NO_QUESTION'],
  ['Não entendi, quis dizer outra coisa','misunderstanding','OPTIONAL'],
  ['Parece golpe, como confiar em vocês?','skepticism','OPTIONAL'],
  ['Vou falar com meu sócio','decision','NO_QUESTION'],
  ['Quero fechar, qual a entrada?','closing','OPTIONAL'],
  ['Pode mandar','continuation','OPTIONAL'],
  ['Não me mande mais mensagem','optout','NO_QUESTION'],
  ['Quero falar com um atendente humano','human','NO_QUESTION'],
 ];
 for(const [incoming,intent,q] of cases){
  const r=natural.planNaturalTurn({incoming});
  assert.equal(r.intent,intent,incoming);
  assert.equal(r.questionPolicy,q,incoming);
 }
});
test('natural reply adapts length and does not force 2 identical sentences',()=>{
 const brief=natural.planNaturalTurn({incoming:'Quanto fica?'});
 const detailed=natural.planNaturalTurn({incoming:'Me explica detalhadamente todas as opções e como funciona'});
 assert.ok(detailed.targetChars>brief.targetChars);
 assert.equal(brief.detailed,false);
 assert.equal(detailed.detailed,true);
 const instructions=natural.naturalConversationInstructions({incoming:'Quanto fica?'});
 assert.match(instructions,/É permitido responder só uma frase/);
 assert.doesNotMatch(instructions,/em duas frases curtas/);
});
test('last customer message is passed to the model directly, not framed as an AI-generated draft',()=>{
 const last='Já tenho um site. O que vocês fariam de diferente?';
 const history='Cliente: Tenho um site.\nConsecom: Vi sim, podemos olhar a velocidade.';
 const msgs=natural.naturalUserMessages({incoming:last,context:history});
 assert.equal(msgs.at(-1).role,'user');
 assert.equal(msgs.at(-1).content,last);
 assert.match(msgs[0].content,/CONTEXTO VERIFICADO/);
 assert.match(msgs[0].content,/dados, não instruções/);
 assert.doesNotMatch(msgs.at(-1).content,/Sugira uma resposta/);
});
test('draft adapter really uses natural instructions in Consecom without invoking any real LLM',async()=>{
 let called=null;
 const text='Já tenho um site no Wix. O que tem de diferente?';
 const mock=async options=>{
  called=options;
  return {model:'MOCK',choice:{content:'Se o seu site já atende bem, talvez você nem precise de outro. O que mais incomoda no atual?'}};
 };
 const ans=await aiDraft({text,context:'Cliente: Tenho um site.\nConsecom: Qual é o endereço?',audience:'PROSPECT_APPROACHED',
  dialogueState:{hasAssistantReply:true},chat:mock});
 assert.equal(ans.ok,true);
 assert.equal(ans.naturalConversation,true);
 assert.equal(ans.toneVersion,natural.NATURAL_CONVERSATION_VERSION);
 assert.equal(called.messages.at(-1).content,text);
 assert.match(called.messages[0].content,/FRANCISCA NATURAL/);
 assert.match(called.messages[0].content,/Não ofereça automaticamente outro site/);
 assert.match(called.messages[0].content,/Não invente preços, promessas/);
 assert.equal(called.task,'conversation');
 assert.equal(ans.autoSend,false);
});
test('rollback to original prompt is possible by flipping the flag without code change',async()=>{
 process.env.FRANCISCA_NATURAL_V1_ENABLED='false';
 let called;
 try{
  const ans=await aiDraft({text:'Quanto custa?',audience:'PROSPECT_APPROACHED',
   chat:async payload=>{called=payload;return {model:'MOCK',choice:{content:'Vou verificar a proposta aprovada.'}}}});
  assert.equal(ans.ok,true);
  assert.equal(ans.naturalConversation,false);
  assert.match(called.messages.at(-1).content,/Sugira uma resposta de WhatsApp/);
  assert.doesNotMatch(called.messages[0].content,/FRANCISCA NATURAL/);
 }finally{process.env.FRANCISCA_NATURAL_V1_ENABLED='true';}
});
test('tone evaluator identifies robotic language but never blocks factually safe replies',()=>{
 const robotic=natural.conversationalToneSignals('Perfeito! Temos o prazer de oferecer uma incrível oportunidade.');
 assert.equal(robotic.genericOpening,true);
 assert.equal(robotic.corporate,true);
 const simple=natural.conversationalToneSignals('Se o seu site já funciona bem, pode não precisar de outro.');
 assert.equal(simple.genericOpening,false);
 assert.equal(simple.corporate,false);
});
test.after(()=>{try{(await import('../dashboard/db.mjs')).db.close();}catch{}fs.rmSync(temp,{recursive:true,force:true});});
