import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'francisca-lab-pix-'));
process.env.PROSPECTOR_DATA_DIR=temp;
const lab=await import('../dashboard/francisca-lab-safety.mjs');
const approved=await import('../dashboard/francisca-approved-replies.mjs');
const guard=await import('../dashboard/groq-live-test-guard.mjs');
const {workerEnvironment}=await import('../dashboard/platform.mjs');

const exampleHistory=[
 {role:'user',text:'oie'},
 {role:'assistant',text:'Oi, tudo bem? Como posso ajudar sua empresa hoje?'},
 {role:'user',text:'Como é esse site?'},
 {role:'assistant',text:'O site será uma página profissional...'},
 {role:'user',text:'Vocês fazem master seo?'},
 {role:'assistant',text:'Sim, preparamos SEO.'},
 {role:'user',text:'Eu quero comprar o site, qual é o valor?'},
 {role:'assistant',text:'R$ 550 pelo site, com 50% de entrada.'},
 {role:'user',text:'Eu posso pagar no cartão a segunda parte?'},
 {role:'assistant',text:'Sim, até 3x sem juros quando disponível.'},
 {role:'user',text:'Entendi, eu vou querer então'},
 {role:'assistant',text:'Ótimo, você prefere Pix ou cartão?'}
];

test('Master SEO is described by its approved name, not basic SEO',()=>{
 const input='Vocês fazem master seo?';
 const response=lab.approvedLabFactReply({incoming:input,history:exampleHistory.slice(0,4)});
 assert.match(response,/Master SEO/);
 assert.doesNotMatch(response,/seo básico/i);
 assert.match(response,/sem prometer/i);
 assert.match(approved.approvedConsecomAnswer(input),/Master SEO/);
});

test('exact site, portfolio and 550 entry flow are answered with verified terms',()=>{
 const site=lab.approvedLabFactReply({incoming:'Como é esse site?'});
 assert.match(site,/Master SEO/);
 assert.match(site,/domínio pago por um ano/);
 const price=lab.approvedLabFactReply({incoming:'Eu quero comprar o site, qual é o valor?'});
 assert.match(price,/R\$ 550/);
 assert.match(price,/R\$ 275 de entrada e R\$ 275 na entrega/);
 const card=lab.approvedLabFactReply({incoming:'Eu posso pagar no cartão a segunda parte?'});
 assert.match(card,/3x sem juros/);
 assert.match(card,/quando essa forma estiver disponível/);
});

test('customer wants to buy: natural closing without unverified Pix send',()=>{
 const answer=lab.approvedLabFactReply({incoming:'Entendi, eu vou querer então',history:exampleHistory});
 assert.match(answer,/R\$ 275/);
 assert.doesNotMatch(answer,/geramos a chave|já enviei|já foi enviado/i);
});

test('Pix choice in the exact reported dialogue NEVER invents a key',()=>{
 const h=[...exampleHistory,{role:'user',text:'Vou querer pagar no pix'}];
 const response=lab.approvedLabFactReply({incoming:h.at(-1).text,history:h.slice(0,-1)});
 assert.match(response,/Pix/);
 assert.match(response,/laboratório/);
 assert.match(response,/não vou gerar nem mostrar/i);
 assert.doesNotMatch(response,/me passa seu e-mail|me informa o telefone/i);
});

test('false email/phone requirement for a Pix key is directly corrected',()=>{
 const h=[...exampleHistory,{role:'user',text:'Vou querer pagar no pix'},
  {role:'assistant',text:'Qual o e-mail ou telefone que usaremos para gerar a chave PIX?'}];
 const answer=lab.approvedLabFactReply({incoming:'como assim? não são vocês que vão gerar a chave pix? kkk',history:h});
 assert.match(answer,/Não precisa informar outro e-mail ou telefone/);
 assert.match(answer,/laboratório não geramos cobranças/);
 assert.doesNotMatch(answer,/informe um e-mail ou telefone para/i);
});

test('saying “Pode enviar por aqui mesmo” refers to recent Pix, but never triggers a charge',()=>{
 const h=[...exampleHistory,
  {role:'user',text:'Vou querer pagar no pix'},
  {role:'assistant',text:'Qual o e-mail ou telefone que usaremos para gerar a chave PIX?'},
  {role:'user',text:'como assim? não são vocês que vão gerar a chave pix? kkk'},
  {role:'assistant',text:'A gente gera a chave PIX e envia os dados'}];
 const response=lab.approvedLabFactReply({incoming:'Pode enviar por aqui mesmo',history:h});
 assert.match(response,/Por aqui mesmo/);
 assert.match(response,/laboratório é apenas uma simulação/);
 assert.match(response,/sem chave nem pagamento real/);
});

test('“Pode enviar por aqui mesmo” without Pix context must not become a Pix request',()=>{
 const history=[{role:'user',text:'Quero ver o portfólio'}, {role:'assistant',text:'Posso enviar o catálogo aqui?'}];
 assert.equal(lab.approvedLabFactReply({incoming:'Pode enviar por aqui mesmo',history}),null);
});

test('fake Pix claims in model output are replaced before display in the laboratory',()=>{
 const utterance='Pode me mandar por aqui?';
 const samples=[
  'Qual o e-mail ou telefone que usaremos para gerar a chave PIX?',
  'A gente gera a chave PIX e envia os dados para o pagamento.',
  'Pode deixar. O sistema vai liberar a chave PIX protegida aqui no chat.',
  'Vou gerar a chave Pix agora.'
 ];
 for(const draft of samples){
  const result=lab.labModelReplySafe({incoming:utterance,history:[],draft});
  assert.equal(result.source,'UNVERIFIED_ACTION_BLOCKED',draft);
  assert.doesNotMatch(result.answer,/email ou telefone que usaremos|vai liberar a chave Pix|gera a chave PIX/i);
 }
});

test('real WhatsApp guard blocks fabricated payment steps, not just the lab',()=>{
 for(const draft of [
  'Qual o e-mail ou telefone que usaremos para gerar a chave PIX?',
  'A gente gera a chave PIX e envia os dados para o pagamento.',
  'O sistema vai liberar a chave PIX protegida aqui no chat.',
  'Vou gerar a chave PIX agora.'
 ]){
  const state=guard.reviewGroqReply({inbound:'Vou querer pagar no pix',draft});
  assert.equal(state.ok,false,draft);
  assert.equal(state.code,'UNVERIFIED_PAYMENT_ACTION',draft);
 }
});

test('ordinary neutral replies are not blocked by extra payment safety',()=>{
 const draft='Pode enviar as informações por aqui. Não preciso de outro contato.';
 assert.equal(lab.isUnverifiedPixAction(draft),false);
 assert.equal(guard.reviewGroqReply({inbound:'Como funciona?',draft}).ok,true);
});

test('only Consecom internal worker receives Pix environment config',()=>{
 process.env.CONSECOM_PIX_KEY='example-only-no-real-key';
 process.env.CONSECOM_PIX_HOLDER='CONSECOM TEST';
 try{
  const own=workerEnvironment({id:'internal',name:'Consecom',is_internal:1,is_demo:0},3010);
  const client=workerEnvironment({id:'outside',name:'Another customer',is_internal:0,is_demo:0},3011);
  const demo=workerEnvironment({id:'demo',name:'Demo',is_internal:0,is_demo:1},3012);
  assert.equal(own.CONSECOM_PIX_KEY,'example-only-no-real-key');
  assert.equal(own.CONSECOM_PIX_HOLDER,'CONSECOM TEST');
  assert.equal(Object.hasOwn(client,'CONSECOM_PIX_KEY'),false);
  assert.equal(Object.hasOwn(demo,'CONSECOM_PIX_KEY'),false);
  assert.equal(Object.hasOwn(client,'CONSECOM_PIX_HOLDER'),false);
 }finally{
  delete process.env.CONSECOM_PIX_KEY;
  delete process.env.CONSECOM_PIX_HOLDER;
 }
});

test.after(()=>{try{fs.rmSync(temp,{recursive:true,force:true});}catch{}});
