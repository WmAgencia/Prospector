import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const read=p=>fs.readFileSync(fileURLToPath(new URL('../'+p,import.meta.url)),'utf8');
const html=read('dashboard/public/landing.html');
const js=read('dashboard/public/landing.js');
const css=read('dashboard/public/landing-redesign.css');
const server=read('dashboard/platform.mjs');

test('landing tells the complete prospecting journey with four explicit stages',()=>{
 for(const label of ['Achar a empresa certa','Começar a conversa','Entender o interesse','Entrar para fechar'])assert.ok(html.includes(label),label);
 for(const id of ['como-funciona','demonstracao','investimento','perguntas','auth-dialog'])assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(html,/empresas e conversas fictícias|empresas e conversas fictícias|empresas e conversas fictícias/i);
 assert.match(html,/canais conectados|números conectados/i);
 assert.match(html,/não realiza cobrança automática/);
});
test('interactive product tour has four keyboard-accessible tabs and correctly named panels',()=>{
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
test('new styles are reachable and responsive without third party imagery',()=>{
 assert.ok(server.includes("'/landing-redesign.css'"));
 assert.ok(html.includes('href="/landing-redesign.css"'));
 assert.match(css,/@media\(max-width:500px\)/);
 assert.match(css,/@media\(max-width:1020px\)/);
 assert.match(css,/prefers-reduced-motion/);
 assert.match(css,/focus-visible/);
 assert.ok(!html.includes('https://images.unsplash.com'));
});
test('all packages remain clickable through free signup',()=>{
 for(const [id,price] of [['essencial','4,90'],['padrao','9,90'],['pro','34,90'],['agencia','149,90']]){
  assert.ok(html.includes('data-package="'+id+'"'),id);
  assert.ok(html.includes(price),price);
 }
 assert.equal((html.match(/data-package="/g)||[]).length,4);
 assert.ok(html.includes('data-auth="signup"'));
});
