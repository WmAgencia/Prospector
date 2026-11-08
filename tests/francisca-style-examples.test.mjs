import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'francisca-style-example-'));
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.FRANCISCA_STYLE_EXAMPLES_V1_ENABLED='true';
process.env.FRANCISCA_NATURAL_V1_ENABLED='true';
process.env.FRANCISCA_COMMERCIAL_BRAIN_V2_ENABLED='true';
process.env.GROQ_API_KEY='synthetic-offline-placeholder';
delete process.env.PROSPECTOR_TENANT_ID;
delete process.env.PROSPECTOR_TENANT_INTERNAL;
const style=await import('../dashboard/francisca-style-examples.mjs');
const {aiDraft,aiStatus}=await import('../dashboard/ai-groq.mjs');
const db=await import('../dashboard/db.mjs');

test('explicit rollout is Consecom-only: external and demo tenants never receive style examples',()=>{
 assert.equal(style.styleMemoryEnabled({FRANCISCA_STYLE_EXAMPLES_V1_ENABLED:'false'}),false);
 assert.equal(style.styleMemoryEnabled({FRANCISCA_STYLE_EXAMPLES_V1_ENABLED:'true'}),true);
 assert.equal(style.styleMemoryEnabled({FRANCISCA_STYLE_EXAMPLES_V1_ENABLED:'true',PROSPECTOR_TENANT_ID:'external'}),false);
 assert.equal(style.styleMemoryEnabled({FRANCISCA_STYLE_EXAMPLES_V1_ENABLED:'true',PROSPECTOR_TENANT_ID:'consecom',PROSPECTOR_TENANT_INTERNAL:'true'}),true);
 assert.equal(aiStatus().styleMemory.enabled,true);
});
test('built-in examples are synthetic, short and clearly scoped to tone not sales facts',()=>{
 const status=style.styleExampleStatus();
 assert.equal(status.enabled,true);
 assert.ok(status.seeded>=20);
 assert.equal(status.approved,0);
 assert.equal(status.items.length,0);
 const prompt=style.styleExamplesInstructions({incoming:'Já tenho site no Wix e não quero criar outro'});
 assert.match(prompt,/EXEMPLOS APROVADOS DE ESTILO/);
 assert.match(prompt,/NUNCA copie literalmente/);
 assert.match(prompt,/NÃO SÃO FATOS COMERCIAIS/);
 assert.doesNotMatch(prompt,/R\$ 550|CONSECOM_PIX_KEY/);
});
test('retrieval looks up the incoming customer message, not a random answer',()=>{
 const r=style.findStyleExamples({incoming:'Meu site ficou lento para carregar no celular',limit:3});
 assert.ok(r.length>0);
 assert.ok(r.some(x=>/lento no celular/.test(x.incoming)));
 assert.ok(r.every(x=>x.score>=0.14));
 assert.ok(r.every(x=>x.source==='SYNTHETIC_BUILTIN'));
});
test('a slow site can be answered as an optional, everyday-language offer',()=>{
 const examples=style.findStyleExamples({incoming:'Meu site está muito lento no celular',limit:3});
 assert.ok(examples.some(x=>/Se quiser, posso dar uma olhada no código/.test(x.reply)));
 const prompt=style.styleExamplesInstructions({incoming:'Meu site está muito lento no celular'});
 assert.match(prompt,/Se quiser, posso dar uma olhada/);
 assert.match(prompt,/NUNCA copie literalmente/);
 assert.match(prompt,/Isso não autoriza dizer que executará algo que não está disponível/);
});

test('natural tone examples cover price objections, clarification and a partner decision',()=>{
 const cases=[
  {incoming:'Nossa, achei caro',re:/te explico direitinho o que entra no valor/},
  {incoming:'Quero ver com meu sócio antes',re:/conversa com ele com calma/},
  {incoming:'Acho que não entendi muito bem',re:/Vou simplificar/}
 ];
 for(const sample of cases){
  const items=style.findStyleExamples({incoming:sample.incoming,limit:3});
  assert.ok(items.some(x=>sample.re.test(x.reply)),sample.incoming);
 }
});

test('commercial planning stays about customer needs while voice instructions are general',async()=>{
 const {analyzeCommercialTurn}=await import('../dashboard/francisca-commercial-brain.mjs');
 const {naturalConversationInstructions}=await import('../dashboard/francisca-natural-conversation.mjs');
 const plan=analyzeCommercialTurn({incoming:'Já tenho um site, mas ele demora no celular'});
 assert.equal(plan.need,'mobile_performance');
 assert.equal(plan.concern,'already_has_solution');
 assert.match(plan.nextAction,/Não tente vender outro site automaticamente/);
 assert.doesNotMatch(plan.nextAction,/código do seu site/);
 const natural=naturalConversationInstructions({incoming:'Meu site tá lento no celular'});
 assert.match(natural,/Jeito de falar|JEITO DE FALAR/);
 assert.match(natural,/não uma promessa de executar análise/);
 assert.match(natural,/Só ofereça uma ação que a empresa realmente possa realizar ou encaminhar/);
 assert.match(natural,/O mesmo estilo vale para preço, dúvidas e objeções/);
});

test('retrieval understands common colloquial questions, accents and short natural phrases',()=>{
 const r=style.findStyleExamples({incoming:'vou falar com meu socio antes'});
 assert.ok(r.some(x=>/sócio antes/.test(x.incoming)));
 const r2=style.findStyleExamples({incoming:'vcs tem algum exemplo para eu ver?'});
 assert.ok(r2.some(x=>/exemplo/.test(x.incoming)));
 assert.equal(style.findStyleExamples({incoming:'  '}).length,0);
});
test('examples never trigger send or payment instructions',()=>{
 const out=style.styleExamplesInstructions({incoming:'Como recebo a chave pix?'});
 assert.match(out,/não são fatos comerciais|NÃO SÃO FATOS COMERCIAIS/i);
 assert.match(out,/servidor/);
 assert.doesNotMatch(out,/^PIX\s*:/m);
});
test('manual example requires consent/rights declaration and declared source',()=>{
 assert.throws(()=>style.proposeStyleExample({incoming:'Tá muito lento',reply:'Vamos ver o que acontece',source:'SYNTHETIC'}),/Confirme origem/);
 assert.throws(()=>style.proposeStyleExample({incoming:'Tá muito lento',reply:'Vamos ver o que acontece',source:'EXPORTED_CHAT',permissionConfirmed:true}),/Confirme origem/);
});
test('PII and real payment details are rejected before storage',()=>{
 const inputs=[
  {incoming:'Meu telefone é (11) 99999-8888',reply:'Vamos ver a página.'},
  {incoming:'Me chama no nome@empresa.com.br',reply:'Vou conferir.'},
  {incoming:'Veja www.exemplo.com/site',reply:'Vamos olhar.'},
  {incoming:'Meu CPF 123.456.789-09',reply:'Vou verificar.'},
  {incoming:'Me mostra o valor',reply:'Esse site custa R$ 550.'},
  {incoming:'Qual a chave?',reply:'Minha chave pix: foo@banco.com'},
  {incoming:'Pode fechar agora',reply:'Já enviei a cobrança.'},
  {incoming:'Pode me ajudar?',reply:'O pagamento foi confirmado.'},
 ];
 for(const pair of inputs)
  assert.throws(()=>style.proposeStyleExample({...pair,source:'CONSENTED_ANONYMIZED',permissionConfirmed:true}),undefined,JSON.stringify(pair));
});
test('consented anonymized examples require separate approval; no immediate prompting',()=>{
 const item=style.proposeStyleExample({
  incoming:'Tem como diminuir esse texto?',
  reply:'Dá sim, vou deixar só o essencial sem perder a explicação.',
  source:'CONSENTED_ANONYMIZED',permissionConfirmed:true
 });
 assert.equal(item.ok,true);assert.equal(item.created,true);
 const st=style.styleExampleStatus();
 assert.equal(st.pending,1);assert.equal(st.approved,0);
 assert.equal(style.findStyleExamples({incoming:'Tem como diminuir esse texto?'}).some(x=>x.id===item.id),false);
 assert.equal(style.proposeStyleExample({
  incoming:'Tem como diminuir esse texto?',
  reply:'Dá sim, vou deixar só o essencial sem perder a explicação.',
  source:'CONSENTED_ANONYMIZED',permissionConfirmed:true
 }).created,false);
 style.reviewStyleExample({id:item.id,action:'APPROVE'});
 assert.equal(style.styleExampleStatus().approved,1);
 const got=style.findStyleExamples({incoming:'Tem como diminuir esse texto?'});
 assert.ok(got.some(x=>x.id===item.id));
});
test('approval cannot be spoofed for an unknown record or unsupported action',()=>{
 assert.throws(()=>style.reviewStyleExample({id:'not-a-real-id',action:'APPROVE'}),/não encontrado/);
 assert.throws(()=>style.reviewStyleExample({id:'not-a-real-id',action:'SEND'}),/Ação inválida/);
});
test('approved example may be removed immediately without erasing other examples',()=>{
 const item=style.proposeStyleExample({incoming:'Como você prefere que eu explique?',reply:'Me diz o que ficou confuso que eu adapto.',source:'SYNTHETIC',permissionConfirmed:true});
 style.reviewStyleExample({id:item.id,action:'APPROVE'});
 assert.ok(style.findStyleExamples({incoming:'Como você prefere que eu explique?'}).some(x=>x.id===item.id));
 style.reviewStyleExample({id:item.id,action:'DELETE'});
 assert.equal(style.styleExampleStatus().items.some(x=>x.id===item.id),false);
});
test('Groq receives 1-3 retrieved pairs as STYLE data, not facts or new permissions',async()=>{
 let captured;
 const result=await aiDraft({text:'Nossa, achei esse preço caro',audience:'PROSPECT_APPROACHED',chat:async payload=>{
  captured=payload;return {model:'MOCK',choice:{content:'Entendi a dúvida sobre o preço. Vou confirmar as condições.'}};
 }});
 assert.equal(result.ok,true);
 assert.equal(result.styleMemory,true);
 assert.equal(result.autoSend,false);
 const system=captured.messages[0].content;
 assert.match(system,/EXEMPLOS APROVADOS DE ESTILO/);
 assert.match(system,/MOTOR COMERCIAL V2/);
 assert.match(system,/preços, promessas, políticas/);
 assert.ok((system.match(/Par \d/g)||[]).length<=3);
});
test('disabling retrieval keeps current prompt and blocks access to previously approved examples',async()=>{
 process.env.FRANCISCA_STYLE_EXAMPLES_V1_ENABLED='false';
 let captured;
 try{
  const result=await aiDraft({text:'Já tenho site',audience:'PROSPECT_APPROACHED',chat:async payload=>{
   captured=payload;return {model:'MOCK',choice:{content:'Você quer melhorar algo no site atual?'}};
  }});
  assert.equal(result.styleMemory,false);
  assert.equal(style.findStyleExamples({incoming:'Tem como diminuir esse texto?'}).length,0);
  assert.equal(style.styleExampleStatus().enabled,false);
  assert.doesNotMatch(captured.messages[0].content,/EXEMPLOS APROVADOS DE ESTILO/);
 }finally{process.env.FRANCISCA_STYLE_EXAMPLES_V1_ENABLED='true';}
});
test('external worker never sees root style examples even if flag is accidentally set',async()=>{
 process.env.PROSPECTOR_TENANT_ID='external';
 process.env.PROSPECTOR_TENANT_INTERNAL='false';
 try{
  assert.equal(style.styleMemoryEnabled(),false);
  assert.equal(style.findStyleExamples({incoming:'Tem como diminuir esse texto?'}).length,0);
  assert.equal(style.styleExampleStatus().items.length,0);
 }finally{delete process.env.PROSPECTOR_TENANT_ID;delete process.env.PROSPECTOR_TENANT_INTERNAL;}
});
test.after(()=>{try{db.db.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
