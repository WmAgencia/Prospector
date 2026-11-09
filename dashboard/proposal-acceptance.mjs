// Pure, conservative confirmation of a permission to explain a proposal.
// A greeting, auto-reply or ambiguous acknowledgement is NOT permission.
const norm=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[!?.,;:]+/g,' ').replace(/\s+/g,' ').trim();

export function explicitlyAcceptsProposal(text=''){
 const s=norm(text);
 if(!s||/(?:^|\b)(?:nao|nunca|pare|parar|sem interesse|nao quero|nao pode|nao manda|nao envie|agora nao|nao obrigado)(?:\b|$)/.test(s))return false;
 if(/\b(?:pode (?:enviar|mandar|apresentar|explicar|falar)|me (?:manda|envia)|sim pode)\b/.test(s))return true;
 if(/^(?:sim|claro|com certeza|pode enviar|pode mandar|manda|mande|envia|envie|me manda|me envie|pode falar|pode explicar|pode apresentar|pode me contar|quero saber|quero ver|tenho interesse|gostaria de saber|gostaria de conhecer|vamos conversar)(?:\b|$)/.test(s))return true;
 // Asking directly about the proposal counts as consent to explain, not to
 // receive unrelated future campaigns.
 return /^(?:qual (?:seria )?(?:a |essa |sua )?(?:proposta|oferta)|do que (?:se trata|seria)|sobre o que (?:seria|e)|quanto (?:custa|fica|sai)|qual (?:o )?(?:valor|preco)|pode me explicar (?:a |essa )?(?:proposta|oferta)|me explica (?:a |essa )?(?:proposta|oferta))\b/.test(s);
}
