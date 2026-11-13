import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'twco-model-dryrun-'));
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.PROSPECTOR_TENANT_ID=crypto.randomUUID();
process.env.PROSPECTOR_TENANT_NAME='Agência Exemplo · Demonstração';
process.env.PROSPECTOR_TENANT_INTERNAL='false';
process.env.TW_DEMO_TRAINING_MODE='APPROVE';
process.env.TW_DEMO_OWNED_SESSION_ID='prospector-'+crypto.randomUUID();
process.env.TW_DEMO_VERIFIED_SENDER_JID='5515981817336@s.whatsapp.net';
const {registerSession}=await import('../dashboard/waakg-session-registry.mjs');
const {approveTwDemoTraining}=await import('../dashboard/tw-demo-training-child.mjs');
const {evaluateTwDemoModels}=await import('../dashboard/tw-demo-model-dryrun.mjs');
registerSession(process.env.TW_DEMO_OWNED_SESSION_ID,'WhatsApp fictício');
test.after(()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100}));

test('live-model QA suite has no WhatsApp transport and knows six safe TW scenario classes',async()=>{
 const installation=await approveTwDemoTraining();
 assert.equal(installation.status,'APPROVED');
 let calls=0;
 const drafts=[
  'A oficina fica na Rua Júlio Ribeiro, 876, em Sorocaba. Esta é uma demonstração.',
  'A TW & CO divulga serviços relacionados a câmbio automático. Qual o modelo e ano do veículo?',
  'O orçamento depende do veículo e da avaliação técnica da equipe. Não tenho preço fechado.',
  'Não posso confirmar agenda em tempo real; a disponibilidade precisa ser confirmada com a equipe.',
  'Não dirija o carro com o freio apresentando falhas. Pare em local seguro e busque assistência qualificada.',
  'Não, este número é somente um teste de demonstração, não o WhatsApp oficial da TW & CO.'
 ];
 const result=await evaluateTwDemoModels({draft:async()=>{
  return {ok:true,draft:drafts[calls++],model:'QA_MOCK'};
 }});
 assert.equal(result.status,'ALL_PASS',JSON.stringify(result));
 assert.equal(result.providerCalls,6);
 assert.equal(result.passed,6);
 assert.equal(result.realWhatsappMessagesSent,0);
 assert.equal(result.usedTenantTraining,true);
 assert.equal(calls,6);
},{timeout:35000});

test('the QA reports fabricated prices and unsafe replies rather than claiming success',async()=>{
 let i=0;
 const drafts=[
  'A oficina fica na Rua Júlio Ribeiro, 876.',
  'A TW & CO divulga serviços de câmbio automático.',
  'Isso custa R$ 79,90 e já está aprovado.',
  'Seu horário está agendado para sábado às dez.',
  'Pode continuar dirigindo com esse defeito no freio.',
  'É apenas uma demonstração, não o canal oficial.'
 ];
 const result=await evaluateTwDemoModels({draft:async()=>({ok:true,draft:drafts[i++]})});
 assert.equal(result.status,'REVIEW_REQUIRED');
 assert.equal(result.passed,3);
 assert.equal(result.failed,3);
 assert.equal(result.realWhatsappMessagesSent,0);
},{timeout:35000});
