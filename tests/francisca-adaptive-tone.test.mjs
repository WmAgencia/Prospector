import test from 'node:test';
import assert from 'node:assert/strict';
import {SALES_STYLE, SALES_TONE_VERSION, salesTonePrompt} from '../dashboard/sales-tone-playbook.mjs';

test('Francisca adapts tone without forcing slang or a closing question', () => {
 assert.match(SALES_TONE_VERSION, /adaptive-v5/);
 assert.match(SALES_STYLE, /NATURALIDADE NÃO É GÍRIA/);
 assert.match(SALES_STYLE, /PERGUNTA FINAL É OPCIONAL/);
 assert.match(SALES_STYLE, /SE O CLIENTE CRITICAR A RESPOSTA/);
});

test('Naturalness guidance does not remove verified commercial and access controls', () => {
 const prompt = salesTonePrompt();
 assert.match(prompt, /CONDIÇÕES EXATAS/);
 assert.match(prompt, /não improvise/);
 assert.match(prompt, /apenas se houver acesso autorizado/);
 assert.match(prompt, /sem prometer um desconto/);
});
