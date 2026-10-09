import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify,normalize,renderTemplate} from '../dashboard/classifier.mjs';
test('recusas têm prioridade',()=>{
 for(const x of ['não tenho interesse','não quero','já tenho site','obrigado, mas não'])assert.equal(classify(x).intent,'NOT_INTERESTED',x);
 assert.equal(classify('não quero saber mais').intent,'NOT_INTERESTED');
 assert.equal(classify('pare de me mandar mensagem').intent,'OPT_OUT');
});
test('oportunidades e ambiguidade',()=>{
 assert.equal(classify('quanto custa?').intent,'INTERESTED');
 assert.equal(classify('quero saber mais').intent,'INTERESTED');
 assert.equal(classify('oi').intent,'NEUTRAL');
 assert.equal(classify('talvez futuramente').intent,'UNCERTAIN');
});
test('personalização não inventa dados',()=>{
 const x=renderTemplate('Oi {{first_name}} de {{business_name}}!',{name:'Ana Paula',business:'Clínica Souza'});
 assert.match(x,/Ana/);assert.ok(!x.includes('{{'));assert.equal(normalize('NÃO quero'),'nao quero');
});
