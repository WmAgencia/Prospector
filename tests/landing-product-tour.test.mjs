import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const read=p=>fs.readFileSync(fileURLToPath(new URL('../'+p,import.meta.url)),'utf8');
const html=read('dashboard/public/landing.html');
const js=read('dashboard/public/landing.js');
const css=read('dashboard/public/landing-redesign.css');
const server=read('dashboard/platform.mjs');

test('approved hero typography and client journey are implemented',()=>{
 for(const label of ['Uma plataforma.','Mais <em>oportunidades.</em>','Menos trabalho manual.','Acha o cliente','Aborda o cliente','Converte o interesse','Te notifica para fechar']){
  assert.ok(html.includes(label),'missing approved copy: '+label);
 }
 for(const id of ['como-funciona','demonstracao','investimento','perguntas','auth-dialog']){
  assert.ok(html.includes('id="'+id+'"'),'missing section '+id);
 }
 assert.match(html,/informações fictícias|dados fictícios/);
 assert.match(html,/autorizados|autorizações/);
 assert.match(html,/não realiza cobrança automática/);
 assert.match(html,/data-icon="search"/);
 assert.match(html,/p3-hero-panel/);
 assert.match(html,/p3-lead-popup/);
});
test('all four illustrated product tour tabs are accessible',()=>{
 for(const id of ['search','chat','pipeline','training']){
  assert.ok(html.includes('id="p2-tab-'+id+'"'),id);
  assert.ok(html.includes('id="p2-panel-'+id+'"'),id);
  assert.ok(html.includes('data-tour-panel="'+id+'"'),id);
 }
 assert.match(js,/event\.key==='ArrowRight'/);
 assert.match(js,/event\.key==='Home'/);
 assert.match(js,/aria-selected/);
 assert.match(js,/\.hidden=panel\.dataset\.tourPanel!==active/);
});
test('purple design sheets are served and responsive, no dependency on external stock photos',()=>{
 assert.ok(server.includes("'/landing-redesign.css'"));
 assert.ok(html.includes('href="/landing-redesign.css"'));
 assert.match(css,/@media\(max-width:520px\)/);
 assert.match(css,/@media\(max-width:1050px\)/);
 assert.match(css,/prefers-reduced-motion/);
 assert.match(css,/focus-visible/);
 assert.match(css,/linear-gradient/);
 assert.ok(!html.includes('https://images.unsplash.com'));
});
test('credit packages remain clickable, billed manually and lead to real signup',()=>{
 for(const [id,price] of [['essencial','4,90'],['padrao','9,90'],['pro','34,90'],['agencia','149,90']]){
  assert.ok(html.includes('data-package="'+id+'"'),id);
  assert.ok(html.includes(price),price);
 }
 assert.equal((html.match(/data-package="/g)||[]).length,4);
 assert.ok(html.includes('data-auth="signup"'));
});
