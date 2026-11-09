// Roteiro da oferta atual e referências enviadas 25 segundos depois da proposta.
// Áudio anterior com preços fica bloqueado até a nova gravação ser aprovada e validada.
export const OFFER_AB_COPY_VERSION='consecom-portfolio-2026-11-09-v5-no-price-audio';
// Versão escrita equivalente à gravação PROPOSTA.ogg fornecida pelo proprietário.
// As afirmações comerciais são de autoria da Consecom; nenhuma posição no Google é garantida.
export const OFFER_AB_TEXT="Então, vou te explicar melhor.\n\nA ideia é criar um site profissional pra empresa de vocês, totalmente personalizado, mostrando os serviços, fotos e tudo que o cliente precisa saber pra entrar em contato.\n\nA gente também trabalha a parte de SEO, pra melhorar a presença da empresa nas pesquisas do Google, de forma orgânica.\n\nE como a gente pode usar esse projeto no nosso portfólio, com a autorização de vocês, conseguimos oferecer uma condição promocional.\n\nAlém disso, o site já vai com um ano de domínio incluso.\n\nVou te mandar alguns exemplos de trabalhos que a gente já entregou, pra você conhecer melhor o que fazemos.\n\nE aí, queria saber se uma proposta assim faria sentido pra vocês.";
export const OFFER_AB_AUDIO_SCRIPT=OFFER_AB_TEXT;
export const OFFER_AB_AUDIO_SHA256=null; // Awaiting freshly recorded and operator-verified OGG.
export const OFFER_AB_AUDIO_BYTES=0;
export const OFFER_AB_AUDIO_DURATION_SECONDS=0;
export const OFFER_AB_REFERENCES_TEXT="Vou te enviar aqui algumas referências do nosso trabalho 👇\nhttps://consecom.com.br/\nhttps://tweco.com.br/\nhttps://quimerasite.vercel.app/\nhttps://oficinasc.com/";
export const OFFER_AB_REFERENCES_DELAY_MS=25_000;

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
