import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeAuthorizedConversations} from '../dashboard/whatsapp-intelligence.mjs';

const tenantId='company_1';
const make=(outcome,n=0)=>({tenantId,id:'chat_'+n,outcome,messages:[
  {id:'in_'+n,direction:'in',body:'Olá, preciso de ajuda'},
  {id:'out_'+n,direction:'out',body:'Olá! Posso te enviar uma proposta?'},
  {id:'out2_'+n,direction:'out',body:'Podemos agendar uma conversa?'}
]});

test('requires authorization and isolates each company',()=>{
  assert.throws(()=>analyzeAuthorizedConversations({tenantId,authorized:false,conversations:[]}),/Autorização/);
  assert.throws(()=>analyzeAuthorizedConversations({tenantId,authorized:true,conversations:[{...make('sale'),tenantId:'company_2'}]}),/isolamento/);
});

test('progress, CRM outcomes and redacted Markdown drafts',()=>{
  const events=[];
  const chats=[make('sale',0),make('no_interest',1),make('interested',2),{...make('sale',3),isGroup:true}];
  chats[0].messages[0].body='nome privado 12345678900';
  const data=analyzeAuthorizedConversations({tenantId,authorized:true,conversations:chats,generatedAt:'2026-11-03T14:30:00Z',onProgress:e=>events.push(e.percent)});
  assert.equal(data.summary.total,3);
  assert.equal(data.summary.messagesOut,6);
  assert.equal(data.summary.outcomes.sale,1);
  assert.equal(data.summary.outcomes.interested,1);
  assert.equal(data.summary.repeatGreetings,0);
  assert.equal(data.status,'PENDING_HUMAN_REVIEW');
  assert.equal(events[0],0);
  assert.equal(events.at(-1),100);
  assert.ok(events.every((e,i)=>!i || e>=events[i-1]));
  assert.ok(!data.reportMarkdown.includes('12345678900'));
  assert.ok(!data.playbookMarkdown.includes('12345678900'));
  assert.match(data.playbookMarkdown,/PENDENTE_DE_APROVACAO/);
});

test('never infers commercial success from chat body',()=>{
  const data=analyzeAuthorizedConversations({tenantId,authorized:true,conversations:[make('unclassified',1)]});
  assert.equal(data.summary.tactics.cta.success,0);
  assert.match(data.reportMarkdown,/amostra insuficiente/);
});

test('deduplicates known message ids and handles empty batches',()=>{
  const chat=make('no_response',1);
  chat.messages.push({...chat.messages[1]});
  assert.equal(analyzeAuthorizedConversations({tenantId,authorized:true,conversations:[chat]}).summary.messagesOut,2);
  const empty=analyzeAuthorizedConversations({tenantId,authorized:true,conversations:[]});
  assert.equal(empty.progress,100);
  assert.equal(empty.summary.total,0);
});

test('fails closed on invalid input',()=>{
  assert.throws(()=>analyzeAuthorizedConversations({tenantId,authorized:true,conversations:[make('probably_sale')]}),/Classificação/);
  assert.throws(()=>analyzeAuthorizedConversations({tenantId:'bad ID',authorized:true,conversations:[]}),/Identificador/);
  assert.throws(()=>analyzeAuthorizedConversations({tenantId,authorized:true,conversations:{}}),/Lote/);
});
