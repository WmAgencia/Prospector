import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../dashboard/public/signup-validation.js';

const v=globalThis.ProspectorSignupValidation;
test('CPF is checked locally without suggesting verification of its owner',()=>{
 assert.equal(v.validCpf('529.982.247-25'),true);
 assert.equal(v.validCpf('52998224726'),false);
 assert.equal(v.validCpf('111.111.111-11'),false);
 assert.equal(v.validCpf('123'),false);
 assert.equal(v.formatCpf('52998224725'),'529.982.247-25');
 assert.equal(v.formatCpf('5299822472'),'529.982.247-2');
 assert.equal(v.digits('529.982.247-25'),'52998224725');
});
test('full-name feedback permits accents and suffixes but rejects incomplete names',()=>{
 assert.equal(v.nameIsComplete('Wesley Rocha Correia Júnior'),true);
 assert.equal(v.nameIsComplete('José de Souza'),true);
 assert.equal(v.nameIsComplete('Ana'),false);
 assert.equal(v.nameIsComplete(''),false);
 assert.equal(v.nameIsComplete('Ana 123'),false);
});
test('signup UI has immediate field notifications without scary one-time notice',()=>{
 const root=new URL('../dashboard/public/',import.meta.url);
 const html=fs.readFileSync(new URL('landing.html',root),'utf8');
 const js=fs.readFileSync(new URL('landing.js',root),'utf8');
 const platform=fs.readFileSync(new URL('../platform.mjs',root),'utf8');
 assert.doesNotMatch(html,/Uma única tentativa gratuita por CPF, e-mail e celular\. O nome deve corresponder ao cadastro oficial/);
 assert.match(html,/id="signup-cpf-feedback"/);
 assert.match(html,/id="signup-name-feedback"/);
 assert.ok(html.indexOf('/signup-validation.js')<html.indexOf('/landing.js'));
 assert.match(js,/validateSignupCpf\(true\)/);
 assert.match(js,/validateSignupName\(true\)/);
 assert.match(js,/CPF válido pelo cálculo\. Nome ainda não confirmado/);
 assert.match(platform,/['"]\/signup-validation\.js['"]/);
});
