// Server-owned answers for verified Consecom offer. No payment key or customer data.
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function extractProposalEmail(text=''){
 const m=String(text||'').match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
 return m?m[0].slice(0,180):null;
}
export function approvedConsecomAnswer(message=''){
 const s=norm(message);
 if(/\b(?:contrato|gov\.?br|assinatura digital)\b/.test(s))
  return 'Fazemos contrato, sim! Nesse pacote normalmente não é necessário, mas, se você preferir, a equipe prepara um contrato de prestação de serviço pra assinatura digital de ambas as partes pelo Gov.br.';
 if(/(?:nao (?:quero|podem?|pode|gostaria).{0,45}(?:portfolio|credito|rodape|feito por consecom)|sem (?:portfolio|credito)|codigo (?:vai ser|e) meu|direitos do codigo)/.test(s))
  return 'Sem problema. O valor promocional de R$ 550 permite mostrar o site no nosso portfólio e manter o crédito no rodapé. Sem essas duas condições, podemos fazer por R$ 2.800, sem divulgar o site nem colocar nosso crédito; os direitos sobre o código ficam definidos no contrato.';
 if(/(?:nao tenho (?:foto|imagem)|sem fotos|fotos? (?:amadoras?|ruins?|simples)|imagens? de ia)/.test(s))
  return 'Não tem problema! Podemos melhorar suas fotos com IA ou criar imagens ilustrativas que combinem com os serviços. Só não vamos apresentar imagens geradas como se fossem fotos reais da sua empresa.';
 if(/(?:mudanc|alterac|alterar|editar|revisao|revisar|personalizar)/.test(s)&&/(?:depois|aprova|fase final|entrega|pronto|suporte)/.test(s))
  return 'Durante a criação você acompanha cada etapa e pode pedir mudanças até aprovar a fase final. Depois da aprovação, seguimos dando suporte, mas novas alterações têm orçamento conforme o que for necessário.';
 if(/(?:pagar (?:tudo )?(?:depois|no final)|sem entrada|so (?:quando|depois) entregar)/.test(s))
  return 'Pra começar precisamos de uma entrada de 50%, porque já iniciamos a produção e os custos do projeto. O restante fica pra entrega e pode ser pago à vista ou em até três vezes sem juros no cartão, quando disponível.';
 if(/(?:nota fiscal|emitir nota|emite nota|recibo)/.test(s))
  return 'Nesse serviço de portfólio a cobrança é feita pelo CPF do responsável, sem emissão de nota fiscal nessa operação. Se você precisar, podemos fornecer um recibo de pagamento.';
 if(/(?:mensalidade|pagar por mes|cobranca mensal|valor mensal)/.test(s))
  return 'A criação do site tem pagamento único, sem mensalidade. O domínio personalizado está pago por um ano; depois desse período, você pode renovar o domínio.';
 if(/(?:loja virtual|e-?commerce|carrinho|checkout|catalogo|comprar pelo site|pagamento no site)/.test(s)){
  if(/(?:checkout|carrinho|pagamento no site|pagar (?:direto )?pelo site|cartao no site)/.test(s))
   return 'Conseguimos fazer uma loja com pagamento no próprio site pela Shopify, a partir de R$ 750, mais a assinatura da plataforma conforme o preço vigente. A gente confirma o escopo antes de fechar.';
  return 'Dá pra montar um catálogo com os produtos e um botão de compra que abre a conversa no WhatsApp, dentro da oferta de R$ 550, conforme o material e o escopo. Se quiser pagamento dentro do site, aí é outra modalidade.';
 }
 if(/(?:mais barato|faz por menos|desconto|valor minimo|450|sem dominio|tirar o dominio|nao quero dominio)/.test(s))
  return 'R$ 550 já é o mínimo com domínio personalizado pago por um ano. Se você preferir sem domínio próprio, conseguimos fazer por R$ 450, usando um endereço gratuito terminado em vercel.app.';
 if(/(?:por e-?mail|pelo e-?mail|mand[ae].{0,30}e-?mail|envia.{0,30}e-?mail)/.test(s)){
  return extractProposalEmail(message)?'Tudo bem, vou encaminhar esse endereço ao responsável para preparar o envio da proposta. Obrigado pelo contato!':'Tudo bem! Me informa, por favor, qual e-mail você prefere para receber a proposta?';
 }
 if(/(?:tres dias|3 dias|prazo|quanto tempo|quando fica pronto|atraso)/.test(s))
  return 'O prazo do site é de até três dias úteis, contados depois da confirmação do pagamento e do recebimento de todo o material necessário. Geralmente concluímos antes e você acompanha as aprovações.';
 if(/(?:fotos? profissionais?)/.test(s))
  return 'Se você não tiver fotos profissionais, conseguimos melhorar as que tiver ou criar imagens ilustrativas com IA para o site, sem fingir que elas são registros reais da empresa.';
 if(/(?:quero fechar|vamos fechar|quero contratar|aceito a proposta)/.test(s))
  return 'Ótimo! Pra organizar o começo do projeto, você tem algumas fotos que gostaria de usar no site?';
 return null;
}
