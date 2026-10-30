import test from 'node:test';
import assert from 'node:assert/strict';
import {priceQuestion,prospectSalesContext} from '../dashboard/sales-policy.mjs';
import {reviewGroqReply} from '../dashboard/groq-live-test-guard.mjs';
test('all financial questions await individual approval',()=>{
 for(const text of ['Quanto custa?','Qual valor do site?','Pode parcelar?','Como funciona o pagamento?','Tem desconto?','Me passa um orçamento'])assert.equal(priceQuestion(text),true,text);
 assert.equal(priceQuestion('Como funciona o site?'),false);
 assert.doesNotMatch(prospectSalesContext({business:'Padaria'}),/R\$\s*550/);
 assert.equal(reviewGroqReply({inbound:'Quanto custa?',draft:'Em média R$ 550 conforme escopo.',allowAveragePrice:true}).ok,false);
 for(const draft of ['Custa 550 reais.','O valor é 1500.','Em três dias está pronto.','Pagamento de 80% para iniciar.'])assert.equal(reviewGroqReply({draft}).ok,false,draft);
});
test('short and plural financial questions are not lost in natural conversation',()=>{
 for(const text of ['E quanto?','Quais os preços?','Me envie os valores','Faz no cartão?','Em quantas vezes?'])assert.equal(priceQuestion(text),true,text);
 for(const draft of ['Fica 350.','Quinhentos e cinquenta para fazer.','Entregamos em dois dias.','Fazemos por seiscentos reais.','Entregamos em 24 horas.','O pagamento é 100% antecipado.'])assert.equal(reviewGroqReply({draft}).ok,false,draft);
});
