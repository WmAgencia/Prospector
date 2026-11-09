// Cada entrada é uma mensagem separada no WhatsApp.
// Quebras internas, especialmente os quatro links, permanecem na mesma bolha.
export const PROPOSAL_TEXT_VERSION='consecom-multimessage-2026-11-09-v3-fixed-typing';
// O texto comercial é mantido como fornecido pelo operador.
// A validade não é limitada a um único dia de calendário.
export const PROPOSAL_MESSAGES=Object.freeze([
  "Então, a minha agencia precisa entregar um projeto daqui 3 dias, e nós precisamos de mais um site para servir de portifólio para esse projeto, e eu achei que sua empresa vai servir certinho pra gente!",
  "A proposta é a seguinte, eu quero fazer um site pra vocês em tempo record já que preciso entregar em 3 dias, e ainda vou dar 1 ano de domínio grátis pra vocês, com SEO Master, que só nós fazemos na região, que vai fazer vocês estarem muito acima das pesquisas dos seus concorrentes no google de forma orgânica, e eu quero fazer isso pelo preço de custo pra gente fechar isso hoje e já começar a produção",
  "Eu vou deixar aqui alguns sites do nosso portifólio para vocês darem uma olhada\n\nhttps://consecom.com.br/\nhttps://oficinasc.com/\nhttps://quimerasite.vercel.app/\nhttps://tweco.com.br/",
  "Me diz aqui se conseguimos fazer essa parceiria, que já iniciamos hoje!"
]);
export const PROPOSAL_TEXT=PROPOSAL_MESSAGES.join('\n\n');
// Tempos fixos aprovados pelo proprietário, por posição de mensagem.
export const PROPOSAL_TYPING_DELAYS_MS=Object.freeze([13000,25000,11000,9000]);
export function proposalTypingDelayMs(messageIndex){
 if(!Number.isInteger(messageIndex)||messageIndex<0||messageIndex>=PROPOSAL_TYPING_DELAYS_MS.length)
  throw new RangeError('Índice de mensagem inválido');
 return PROPOSAL_TYPING_DELAYS_MS[messageIndex];
}
// Compatibilidade com integrações antigas: não bloquear pelo dia do calendário.
// As promessas temporais do texto devem continuar verdadeiras quando usadas.
export function proposalCopyIsCurrent(){return true;}
