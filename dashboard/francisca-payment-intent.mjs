// Pure, testable intent recognition. Never authorizes a payment by itself.
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function paymentMethodChosen(text=''){
 const s=norm(text);
 if(/\b(nao|nunca|talvez|depois|duvida|ainda nao)\b/.test(s))return false;
 if(/\b(?:no cartao|por cartao|boleto)\b/.test(s)&&!/\b(?:pix|entrada)\b/.test(s))return false;
 return /(?:manda|pode mandar|passa|pode enviar|me envia|me passa).{0,35}(?:pix|chave)|(?:qual|como).{0,25}(?:pix|faco o pix)|(?:vou|quero|prefiro).{0,30}(?:pagar|fazer).{0,30}(?:pix|entrada|a vista)|(?:vai ser|sera|prefiro|quero).{0,18}(?:a vista|50% de entrada|cinquenta por cento de entrada)/.test(s);
}
export function fullPaymentChosen(text=''){
 const s=norm(text);
 return /(?:tudo|integral|100%|cem por cento).{0,25}(?:agora|pix|a vista)|(?:a vista|pagar tudo agora|pagamento integral)/.test(s)&&!/(?:restante|saldo|50%|cinquenta por cento)/.test(s);
}
