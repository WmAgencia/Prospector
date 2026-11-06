import test from 'node:test';
import assert from 'node:assert/strict';
import {leadFirstName} from '../lead-salutation.mjs';
import {greetingName,friendlyGreeting} from '../portfolio-offer-550.mjs';
import {renderTemplate} from '../classifier.mjs';

const examples=[
 ['clínica genérica',{business:'Clínica'},''],
 ['clínica de estética',{business:'Clínica Belo Sorriso Estética'},''],
 ['nome de médica no estabelecimento',{business:'Dra Monique Bavia Estética'},'Monique'],
 ['doutora após clínica',{business:'Clínica Dra. Monique Bavia | Estética'},'Monique'],
 ['médico no consultório',{business:'Consultório Dr. Carlos Pereira'},'Carlos'],
 ['centro com doutora',{business:'Centro Médico - Dra. Ana Paula'},'Ana'],
 ['nome pessoal cadastrado',{name:'Monique Bavia',business:'Clínica de Estética'},'Monique'],
 ['primeiro nome informado',{name:'Monique',business:'Clínica'},'Monique'],
 ['nome de pessoa distinto',{name:'João Pedro',business:'Tecnologia JP'},'João'],
 ['nome comercial duplicado',{name:'Clínica Monique Estética',business:'Clínica Monique Estética'},''],
 ['departamento de atendimento',{name:'Equipe da Clínica',business:'Clínica'},''],
 ['negócio sem título profissional',{business:'Monique Bavia Estética'},''],
 ['marca com nome humano',{business:'Monique Bavia'},''],
 ['estúdio genérico',{business:'Studio de Beleza Boa Vista'},''],
 ['restaurante com apelido',{business:'Restaurante do Zé'},''],
 ['empresa com nome errado',{name:'Oficina Mecânica',business:'Oficina Mecânica'},''],
 ['palavra de cargo genérica',{name:'Atendimento',business:'Clínica'},''],
 ['nome informado como Dr.',{name:'Dr. João Silva',business:'Consultório'},'João'],
 ['sem dados pessoais',{business:'Empresa XYZ'},''],
 ['nome com dígitos',{name:'Dr. 12345',business:'Clínica'},'']
];
for(const [label,lead,expected] of examples){
 test('leadFirstName: '+label,()=>assert.equal(leadFirstName(lead),expected));
 test('greetingName: '+label,()=>assert.equal(greetingName(lead),expected));
}
const morning=new Date('2026-11-06T11:07:00Z'); // 08:07 in São Paulo
test('clínica must NOT be used as vocative',()=>{
 assert.equal(friendlyGreeting({business:'Clínica'},morning),'Olá, bom dia! Tudo bem?');
});
test('doctor appears by personal name only',()=>{
 assert.equal(friendlyGreeting({business:'Dra. Monique Bavia Estética'},morning),'Olá, Monique, bom dia! Tudo bem?');
});
test('avoid reusing business name in configurable message template',()=>{
 assert.equal(renderTemplate('{{greeting}}', {business:'Clínica Bela Estética'}),'Olá, como vai?');
});
test('preserve personal name in other templates',()=>{
 assert.equal(renderTemplate('{{greeting}}', {name:'João Silva',business:'Clínica Bela Estética'}),'Olá, João, como vai?');
});
