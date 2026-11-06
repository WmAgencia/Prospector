import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedConsecomAnswer,extractProposalEmail} from '../francisca-approved-replies.mjs';
test('respostas comerciais aprovadas sem repetir a proposta',()=>{
 const scenarios=[
 ['vocês fazem contrato?',/contrato de prestação/],
 ['não quero o feito por Consecom no rodapé',/R\$ 2\.800/],
 ['achei caro, faz mais barato?',/R\$ 450/],
 ['posso pagar tudo depois?',/entrada de 50%/],
 ['quais são as formas de pagamento?',/até três vezes sem juros/],
 ['posso pagar 50% na entrada e 50% no final?',/50% de entrada/],
 ['quanto tempo pra ficar pronto?',/três dias úteis/],
 ['não tenho fotos',/IA/],
 ['vou querer loja virtual com checkout',/R\$ 750/],
 ['quero catálogo de produtos no whatsapp',/R\$ 550/],
 ['tem mensalidade?',/sem mensalidade/],
 ['posso pedir mudanças depois da aprovação final?',/novas alterações/],
 ['gostei, quero fechar',/fotos/],
 ['me manda por e-mail',/qual e-mail/]
 ];
 for(const [input,pattern] of scenarios)assert.match(approvedConsecomAnswer(input),pattern,input);
 assert.equal(approvedConsecomAnswer('vou falar com meu sócio'),null);
});
test('captura somente endereço fornecido, não inventa envio',()=>{
 assert.equal(extractProposalEmail('pode mandar para comercial@exemplo.com?'),'comercial@exemplo.com');
 assert.equal(extractProposalEmail('manda no meu e-mail'),null);
 assert.match(approvedConsecomAnswer('manda pelo e-mail comercial@exemplo.com'),/encaminhar/);
});
