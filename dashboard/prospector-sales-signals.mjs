// Deterministic signals for the owner's original recorded portfolio proposal.
// No generic AI may replace the approved audio with an improvised text pitch.
import {salesEnding} from './sales-policy.mjs';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const negative=s=>Boolean(salesEnding(s))||/\b(?:nao|nunca|jamais)[\s,!.]+(?:quero|gostei|tenho|podem|pode|manda|envie|envia|preciso|estou|estamos|vou)\b/.test(s)||/^nao[,!.](?:\s|$)/.test(s);
export function acceptsProposalAudio(text=''){
 const s=norm(text);
 if(!s||s.length>280||negative(s))return false;
 if(/^(?:sim|claro|pode|pode sim|com certeza|beleza|blz|ok|okay|ta bom|tudo bem|manda|envia|envie|pode mandar|pode enviar|pode falar|pode explicar|fala|manda ai|envia ai|pode sim mandar)[.!? ]*$/.test(s))return true;
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
