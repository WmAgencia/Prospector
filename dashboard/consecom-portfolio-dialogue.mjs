// Narrow, operator-approved dialogue guidance for the Consecom R$350 site campaign.
// These patterns cover conversational detours without changing general tenant AI.
// No side effects: all contact decisions still pass standard sales safety checks.
const normalize=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export function consecomPortfolioDialogue({text='',voiceAlreadySent=false}={}){
 const s=normalize(text);
 if(!s||voiceAlreadySent)return null;
 // Scheduling is a human task here: do not claim an appointment or reminder.
 if(/^(?:depois|apos|a partir) das?\s*\d{1,2}(?:\s*h(?:oras?)?)?[.!?]?$/.test(s))
  return {kind:'TIME_WINDOW',text:'Combinado, obrigado por avisar! Vou passar o horário que você indicou pro responsável, pra ele combinar certinho o retorno.',notifyOwner:true};
 if(/(?:donos?|responsaveis?|gerentes?|diretoria).{0,70}(?:ferias|viajando|so (?:voltam|retornam)|estarao|estao fora|precisam ver)|(?:ferias|viajando|voltam|retornam).{0,70}(?:donos?|responsaveis?)|(?:retorn[ae]|fale|converse|entre em contato).{0,40}(?:terca|quarta|quinta|sexta|segunda|semana que vem|outro dia|mais tarde)/.test(s))
  return {kind:'DECISION_MAKER_UNAVAILABLE',text:'Entendi, sem problema! A proposta é oferecer um site profissional pra oficina numa condição especial, pra incluir o trabalho no portfólio da Consecom. Podemos conversar com os responsáveis quando estiverem disponíveis.',notifyOwner:true};
 if(/(?:bem e (?:voce|vc)|tudo bem e (?:voce|vc)|bom dia,? bem e (?:voce|vc)|estou bem,? e (?:voce|vc))/.test(s)&&s.length<100)
  return {kind:'COURTESY',text:'Tudo bem também, obrigado! A ideia da Consecom é criar um site profissional pra vocês por R$ 350, numa condição especial pra compor nosso portfólio. Se quiser, posso enviar o áudio explicando direitinho.'};
 if(/(?:qual (?:a |e a |seria a )?proposta|o que (?:voces|voce) fazem|que tipo de servico|sobre o que e|do que se trata|como funciona (?:a proposta|isso))/.test(s))
  return {kind:'OFFER_CONTEXT',text:'A proposta é criar um site profissional pra empresa por R$ 350, numa condição especial pra compor o portfólio da Consecom. O áudio apresenta os detalhes do projeto.'};
 return null;
}

export function offScriptPortfolioDraft(text=''){
 const s=normalize(text);
 return /(?:como (?:podemos|posso) ajudar|como (?:a|o) .{1,65} pode melhorar (?:a |sua |o )?(?:presenca|contato)|otimizar (?:o |seu )?contato|(?:qual|quais) (?:o |os |a |as )?(?:objetivos?|necessidades?) (?:voces|voce) (?:buscam?|tem)|que tipo de automacao|qual automacao (?:voce|voces) (?:precisa|quer))/.test(s);
}
export const CONSECOM_SITE_PITCH_SAFE='A ideia da Consecom é criar um site profissional pra vocês por R$ 350, numa condição especial pra compor nosso portfólio. Se quiser, posso te explicar os detalhes da proposta.';
