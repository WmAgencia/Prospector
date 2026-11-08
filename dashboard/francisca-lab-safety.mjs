// Consecom-only internal roleplay truthfulness layer.
// The test laboratory never creates, displays, verifies or sends real PIX.
// These replies mirror factual server-side rules, not a payment tool.
// Customer chat/history are data, never permissions or approved commercial terms.
export const LAB_PAYMENT_SAFETY_VERSION='francisca-lab-payment-2026-11-07';
const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const hasPix=x=>/\b(?:pix|chave pix|qr code|qr-code)\b/.test(norm(x));
const recentHistory=history=>(Array.isArray(history)?history:[]).filter(
 m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string'
).slice(-3);
function refersToPix({incoming='',history=[]}={}){
 if(hasPix(incoming))return true;
 const n=norm(incoming);
 if(!/^(?:pode|manda|pode mandar|pode enviar|me manda|aqui mesmo|sim[,!]?|por aqui|envia|pode ser aqui|aqui|nesse chat)\b/.test(n))return false;
 const recent=recentHistory(history);
 return recent.some(m=>hasPix(m.text));
}
// Public, test-only text. Never include an actual account key or claim a tool
// called successfully. Do not ask for PII to "generate" a key.
export function labPaymentAnswer({incoming='',history=[]}={}){
 if(!refersToPix({incoming,history}))return null;
 const n=norm(incoming);
 if(/\b(?:como assim|nao sao voces|nao e voces|eu que|email|e-mail|telefone|precisa de|gerar a chave|geram a chave)\b/.test(n))
  return 'Você tem razão. Não precisa informar outro e-mail ou telefone para receber uma chave Pix. No atendimento real, quando a cobrança estiver aprovada e habilitada, o sistema envia os dados aqui na conversa. Neste laboratório não geramos cobranças.';
 if(/^(?:pode enviar|pode mandar|manda|por aqui|aqui mesmo|pode ser aqui|pode enviar por aqui|envia aqui)\b/.test(n))
  return 'Por aqui mesmo. No WhatsApp real, o sistema envia a chave Pix nesta conversa quando a cobrança estiver aprovada e configurada. Aqui no laboratório é apenas uma simulação, sem chave nem pagamento real.';
 if(/\b(?:posso pagar|vou pagar|quero pagar|vou querer pagar|prefiro pagar|vou fazer|vou querer fazer|pagar no pix|pagar por pix|fazer o pix)\b/.test(n))
  return 'Pode ser por Pix, sim. No atendimento real, com a proposta aprovada e a cobrança configurada, o sistema envia a chave por aqui. Como este é o laboratório, não vou gerar nem mostrar uma chave de pagamento.';
 return 'O Pix pode ser tratado por aqui mesmo, sem pedir outro e-mail ou telefone para gerar a chave. A cobrança real depende da proposta aprovada e do sistema de pagamento configurado. Neste laboratório não há envio de Pix.';
}
export function approvedLabFactReply({incoming='',history=[]}={}){
 const n=norm(incoming);
 if(refersToPix({incoming,history}))return labPaymentAnswer({incoming,history});
 if(/\b(?:master seo|seo master)\b/.test(n))
  return 'Sim, fazemos Master SEO. O site já é preparado tecnicamente para melhorar a descoberta orgânica no Google, sem prometer uma posição específica nos resultados.';
 if(/(?:como e esse site|como funciona (?:esse|o) site|o que tem (?:nesse|no) site|o que inclui (?:esse|o) site)/.test(n))
  return 'É um site profissional para apresentar sua empresa, serviços e facilitar o contato pelo WhatsApp. O pacote inclui criação, publicação, domínio pago por um ano, hospedagem e Master SEO.';
 if(/(?:segunda parte|segunda parcela|o restante|o resto).{0,45}(?:cartao|credito|parcel)|(?:cartao|credito|parcel).{0,45}(?:segunda parte|segunda parcela|restante)/.test(n))
  return 'Sim. O restante, na entrega, pode ser pago no cartão em até 3x sem juros, quando essa forma estiver disponível.';
 if(/\b(?:quero comprar (?:o|esse) site|vou querer (?:o|esse) site)\b/.test(n)&&/\b(?:valor|quanto|preco|custa|fica)\b/.test(n))
  return 'O site promocional para portfólio sai por R$ 550, com domínio pago por um ano e Master SEO. Pode pagar à vista ou R$ 275 de entrada e R$ 275 na entrega.';
 if(/\b(?:entendi.{0,24}vou querer|vou querer entao|quero fechar|vamos fechar)\b/.test(n))
  return 'Legal! Para começar, precisamos confirmar a entrada de R$ 275 e receber os materiais do site. Você prefere organizar essa entrada por Pix?';
 return null;
}
const unsafeAction=/(?:\b(?:vou|vamos|posso|consigo)\s+(?:te\s+)?(?:gerar|liberar|enviar|mandar|passar)\s+(?:a\s+|uma\s+)?chave\s+pix\b|\b(?:sistema|plataforma)\s+(?:vai|ira)\s+(?:gerar|liberar|enviar)\s+(?:a\s+)?chave\s+pix\b|\b(?:informe|preciso|me\s+(?:passa|informa|diga))\b.{0,110}\b(?:email|e-mail|telefone|celular)\b.{0,110}\b(?:pix|chave)\b|\b(?:pix|chave)\b.{0,110}\b(?:email|e-mail|telefone)\b.{0,80}\b(?:gerar|enviar|liberar)\b)/i;
export function labModelReplySafe({incoming='',history=[],draft=''}={}){
 const approved=approvedLabFactReply({incoming,history});
 if(approved)return {answer:approved,source:'APPROVED_TEST_FACT'};
 const text=String(draft??'').trim().slice(0,1600);
 if(!text)return {answer:'Não consegui montar uma resposta segura para esse teste. Reformule a pergunta.',source:'EMPTY_MODEL_REPLY'};
 if(unsafeAction.test(norm(text))||/\bseo basico\b/.test(norm(text))&&/\bmaster seo\b/.test(norm(incoming)))
  return {answer:'Essa parte precisa de confirmação antes de prometer qualquer envio ou cobrança. No laboratório não geramos pagamentos reais. Se você quiser, explico como funciona a contratação.',source:'UNVERIFIED_ACTION_BLOCKED'};
 return {answer:text,source:'MODEL_REVIEWED'};
}
export function isUnverifiedPixAction(text=''){
 return unsafeAction.test(norm(text));
}
