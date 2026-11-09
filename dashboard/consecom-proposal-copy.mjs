// Exatamente uma mensagem por linha não vazia do roteiro aprovado pelo proprietário.
// Pausas em branco são separadores; URLs são mensagens individuais.
export const PROPOSAL_TEXT_VERSION='consecom-multimessage-2026-11-09-v1';
export const PROPOSAL_TEXT="Então, a minha agencia precisa entregar um projeto daqui 3 dias, e nós precisamos de mais um site para servir de portifólio para esse projeto, e eu achei que sua empresa vai servir certinho pra gente!\n\nA proposta é a seguinte, eu quero fazer um site pra vocês em tempo record já que preciso entregar em 3 dias, e ainda vou dar 1 ano de domínio grátis pra vocês, com SEO Master, que só nós fazemos na região, que vai fazer vocês estarem muito acima das pesquisas dos seus concorrentes no google de forma orgânica, e eu quero fazer isso pelo preço de custo pra gente fechar isso hoje e já começar a produção\n\nEu vou deixar aqui alguns sites do nosso portifólio para vocês darem uma olhada\n\nhttps://consecom.com.br/\nhttps://oficinasc.com/\nhttps://quimerasite.vercel.app/\nhttps://tweco.com.br/";
export const PROPOSAL_MESSAGES=Object.freeze(PROPOSAL_TEXT.split(/\r?\n/).map(x=>x.trim()).filter(Boolean));
// Digitação rápida (~9 caracteres por segundo), sem mensagem instantânea.
export function proposalTypingDelayMs(text){
 const n=String(text||'').trim().length;
 return Math.min(45000,Math.max(2200,1000+n*110));
}
