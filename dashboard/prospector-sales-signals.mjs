// Deterministic signals for the owner's original recorded portfolio proposal.
// No generic AI may replace the approved audio with an improvised text pitch.
import {salesEnding} from './sales-policy.mjs';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const negative=s=>Boolean(salesEnding(s))||/\b(?:nao|nunca|jamais)\s+(?:quero|gostei|tenho|podem|pode|manda|envie|envia|preciso|estou|estamos|vou)\b/.test(s);
// A clear refusal is terminal. Never treat words like "falar" in
// "não dá tempo de falar" as consent to send a recorded sales pitch.
export function declinesProposalAudio(text=''){
 const s=norm(text);
 if(!s||s.length>1500)return false;
 if(/(?:^|[.!?]\s*)(?:nao[, ]+)?(?:amigo[, ]+)?(?:so|apenas|somente)\s+(?:fac[oa]|atendo|recebo|quero|trato)?\s*(?:de\s+)?orcamentos\b/.test(s))return true;
 if(/\b(?:so|apenas|somente)\s+(?:trabalho\s+com\s+|recebo\s+|atendo\s+)?orcamentos\b/.test(s))return true;
 if(/\bnao\s+(?:da\s+tempo|tenho\s+tempo|posso|vou|queremos|quero|tenho\s+interesse|me\s+interessa|preciso|estamos\s+interessados)\b/.test(s) &&
    !/\bnao\s+(?:da\s+tempo|posso)\s+(?:esperar|agora)\b.*\b(?:pode\s+enviar|manda(?:r)?)\b/.test(s))return true;
 if(/^(?:nao[,!. ]+)?(?:obrigad[oa]|valeu)[.! ]*$/.test(s)&&/^(?:nao)\b/.test(s))return true;
 if(/^(?:nao[,!. ]+)(?:amigo[,!. ]+)?(?:obrigad[oa]|prefiro\s+nao|pode\s+deixar|sem\s+interesse)\b/.test(s))return true;
 return false;
}

export function acceptsProposalAudio(text=''){
 const original=norm(text);
 if(!original||original.length>280||negative(original))return false;
 // A polite greeting before an explicit yes must not hide authorization.
 const s=original.replace(/^(?:oi|ola|bom dia|boa tarde|boa noite)[,! .-]+(?=(?:sim|pode|manda|envia|envie|claro)\b)/,'');
 if(/^(?:sim|claro|pode|pode sim|com certeza|beleza|blz|ok|okay|ta bom|tudo bem|manda|envia|envie|pode mandar|pode enviar|pode falar|pode explicar|fala|manda ai|envia ai|pode sim mandar|pode ser|claro que pode|manda sim|envia sim)[.!? ]*$/.test(s))return true;
 if(/^(?:sim[,!. ]*)?(?:pode(?: sim)?(?: me)? (?:mandar|enviar)|manda|envia|envie)(?: (?:o |um |a |essa )?(?:audio|proposta|oferta|detalhes))?(?:[,!. ]+(?:sim|por favor|pra mim|quando puder))*[.!? ]*$/.test(s))return true;
 if(/^(?:sim[,!. ]*)?(?:pode sim[,!. ]*)?(?:manda|envia|envie)(?: (?:o |um |a |essa )?(?:audio|proposta|oferta|detalhes))?(?:[,!. ]+(?:sim|por favor|pra mim))*[.!? ]*$/.test(s))return true;
 return /^(?:sim,? |claro,? |beleza,? |pode,? )?(?:pode |poderia |consegue )?(?:me )?(?:mandar|manda|enviar|envia|mostrar|mostra|apresentar|apresenta|explicar|explica|falar|fala|contar|conta)(?: (?:um |o |essa |a |sua )?(?:audio|proposta|ideia|oferta|detalhes|mais|pra mim|por favor|ai))?[.!? ]*$/.test(s)||
  /\b(?:quero ouvir|quero saber|gostaria de ouvir|pode mandar (?:o |um )?audio|manda (?:o |um )?audio|pode enviar a proposta)\b/.test(s);
}
export function interestedAfterProposal(text=''){
 const s=norm(text);
 if(!s||s.length>1100||negative(s))return false;
 if(/\b(?:nao tenho interesse|sem interesse|nao quero|nao gostei|por enquanto nao|agora nao|nao podemos|nao vou|talvez nao)\b/.test(s))return false;
 return /\b(?:tenho interesse|temos interesse|estou interessado|estamos interessados|achei interessante|gostei|gostamos|faz sentido|quero fazer|queremos fazer|quero fechar|vamos fechar|vamos marcar|pode marcar|vamos conversar|podemos conversar|quero conversar|me liga|pode me ligar|pode ligar|me chama|quero saber mais|quero entender melhor|quero ver|pode mostrar|manda a previa|manda um exemplo|como podemos comecar|quando podemos comecar|qual o valor|quanto custa|qual o preco|vamos agendar|podemos agendar)\b/.test(s)||
 /^(?:sim|claro|pode sim|com certeza|vamos|pode|quero)[.!? ]*$/.test(s);
}
