// Novo roteiro aprovado para a oferta Consecom. Grave este mesmo texto no áudio.
// O áudio anterior não fica automaticamente aprovado ao alterar este roteiro.
export const OFFER_AB_COPY_VERSION='consecom-portfolio-2026-11-07-v2';
export const OFFER_AB_TEXT="Então, a minha agência precisa entregar um portfólio do seu nicho daqui a três dias. E qual é a questão? A gente precisa de mais um site desse segmento pra concluir esse projeto.\n\nE aí, qual é a proposta? A gente vai criar pra vocês um site totalmente personalizado e profissional, com SEO pensado pra melhorar a presença no Google e ajudar a atrair clientes de forma orgânica. A entrega fica em até três dias úteis, depois da confirmação do pagamento e do recebimento dos materiais.\n\nPra vocês permitirem que a gente mostre esse trabalho no nosso portfólio, eu tô disposto a reduzir cerca de 80% do preço normal. Ou seja, vocês vão levar por R$ 550 um site que normalmente custa entre R$ 2.500 e R$ 3.000.\n\nAlém disso, a gente inclui um ano de domínio sem custo extra e divulga o trabalho de vocês no Instagram e no site da Consecom.\n\nPessoalmente, eu acredito que um site profissional com a qualidade da Consecom pode ajudar muito a destacar vocês dos concorrentes. Nosso compromisso é que cada cliente fique satisfeito com o resultado, e esse projeto também vai ajudar bastante a agência.\n\nComo precisamos entregar o portfólio daqui a três dias, seria excelente receber uma resposta ainda hoje. Faz sentido pra vocês?";
export const OFFER_AB_AUDIO_SCRIPT=OFFER_AB_TEXT;

// Histórico da transcrição anterior, preservado apenas para referência.
export const ORIGINAL_OFFER_AUDIO_TRANSCRIPT="Vou te explicar aqui por áudio, que é mais fácil.\n\nEntão, minha agência precisa entregar um portfólio do seu nicho na segunda-feira. E aí, qual que é a questão? A gente precisa de mais um site desse nicho, entendeu? Pra essa empresa desse projeto que a gente está concluindo agora.\n\nE eu estou disposto a tirar a maior parte do valor do nosso site, que você pagaria de dois mil e quinhentos reais a três mil reais. Eu estou disposto a te oferecer ele por quinhentos e cinquenta reais, mais um domínio, tá? Por um ano aí, de graça.\n\nE a gente faz um Master SEO, né, que é pra você ficar escalado ali nas pesquisas do Google.\n\nE isso daí é pra você permitir que a gente divulgue o seu site. Então, além disso, você ainda vai receber a nossa divulgação ali no nosso Instagram, no portfólio, né, e também no nosso site, que a gente sempre coloca as pessoas que vão fazer parte do nosso portfólio, a gente coloca lá no nosso site, entendeu?\n\nE aí eu queria saber se faz sentido pra você, se a gente conseguiria trabalhar dessa forma. Tenho certeza que vai ajudar vocês, né? Nenhum cliente que faz site com a gente sai insatisfeito e, sem dúvidas nenhuma, também vai ajudar muito a gente aqui.";


export function offerDeadlineMatchesScript({portfolioDueDate,confirmedAt}={},at=new Date()){
 if(!confirmedAt||!/^(?:19|20)\d\d-\d\d-\d\d$/.test(portfolioDueDate||''))return false;
 const due=new Date(portfolioDueDate+'T12:00:00Z');
 if(!Number.isFinite(due.getTime())||due.toISOString().slice(0,10)!==portfolioDueDate)return false;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
 const now=new Date(today+'T12:00:00Z');
 return Math.round((due.getTime()-now.getTime())/86400000)===3;
}
