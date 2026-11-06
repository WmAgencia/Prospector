import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentMethodChosen,fullPaymentChosen} from '../francisca-payment-intent.mjs';
test('a compra não envia PIX antes da escolha explícita da forma de pagamento',()=>{
 for(const value of ['gostei, quero fechar','aceito o site','vou pensar','posso pagar depois?','prefiro pagar no cartão'])
  assert.equal(paymentMethodChosen(value),false,value);
 for(const value of ['manda o PIX','qual é a chave PIX?','vou pagar a entrada no PIX','prefiro pagar à vista','vai ser 50% de entrada'])
  assert.equal(paymentMethodChosen(value),true,value);
});
test('pagamento integral e entrada são modalidades diferentes',()=>{
 assert.equal(fullPaymentChosen('prefiro pagar à vista'),true);
 assert.equal(fullPaymentChosen('quero pagar tudo agora'),true);
 assert.equal(fullPaymentChosen('50% agora e o saldo à vista na entrega'),false);
 assert.equal(fullPaymentChosen('50% de entrada e o resto no cartão'),false);
});
