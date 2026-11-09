// Pure, conservative confirmation of a permission to explain a proposal.
// A greeting, auto-reply or ambiguous acknowledgement is NOT permission.
const norm=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[!?.,;:]+/g,' ').replace(/\s+/g,' ').trim();

// A refusal ends this proposal conversation, including during the 30s delay.
// A soft "not now" is not automatically treated as permanent WhatsApp opt-out.
export function explicitlyDeclinesProposal(text=''){
 const s=norm(text);
 return /^(?:nao|nao obrigado|nao obrigada|nao quero|nao tenho interesse|sem interesse|agora nao|melhor nao|prefiro nao|nao precisa|nao envie|nao manda|nao mande|pare|pode parar)(?:\\b|$)/.test(s)
  || /\\b(?:nao estou interessado|nao estou interessada|nao quero proposta|nao quero receber proposta|dispenso a proposta|pode encerrar)\\b/.test(s);
}
export function explicitlyAcceptsProposal(text=''){
 const s=norm(text);
 if(!s||/(?:^|\b)(?:nao|nunca|pare|parar|sem interesse|nao quero|nao pode|nao manda|nao envie|agora nao|nao obrigado)(?:\b|$)/.test(s))return false;
 if(/\b(?:queria|quero|gostaria de|tenho interesse em)\s+(?:saber|entender|conhecer|ver)\s+mais\b/.test(s))return true;
 if(/\b(?:pode (?:enviar|mandar|apresentar|explicar|falar)|me (?:manda|envia)|sim pode)\b/.test(s))return true;
 if(/^(?:sim|claro|com certeza|pode enviar|pode mandar|manda|mande|envia|envie|me manda|me envie|pode falar|pode explicar|pode apresentar|pode me contar|quero saber|quero ver|tenho interesse|gostaria de saber|gostaria de conhecer|vamos conversar)(?:\b|$)/.test(s))return true;
 // Asking directly about the proposal counts as consent to explain, not to
 // receive unrelated future campaigns.
 return /^(?:qual (?:seria )?(?:a |essa |sua )?(?:proposta|oferta)|do que (?:se trata|seria)|sobre o que (?:seria|e)|quanto (?:custa|fica|sai)|qual (?:o )?(?:valor|preco)|pode me explicar (?:a |essa )?(?:proposta|oferta)|me explica (?:a |essa )?(?:proposta|oferta))\b/.test(s);
}
