// Behavioral signals only: never infer demographics, health, politics or identity.
// Lightweight, deterministic pre-analysis; Groq drafts remain operator-reviewed.
export const STAGES=['new','discovery','evaluation','negotiation','decision','delivery','closed','opt_out','human_handoff'];
export const PROFILE_LABELS={
  direct:'Direto e objetivo',detail:'Quer entender os detalhes',visual:'Valoriza exemplos e portfólio',
  cautious:'Quer avaliar com calma',price:'Foco em investimento',ready:'Pronto para avançar',neutral:'Em descoberta'
};
const normalize=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const match=(t,p)=>p.test(t);
export function analyzeSalesConversation({text='',context=''}={}){
 const last=normalize(text).slice(0,1200);
 const history=normalize(context).slice(-3500);
 const all=history+'\n'+last;
 const signals=[];
 let stage='discovery',profile='neutral',risk='normal',nextAction='Perguntar qual resultado a empresa deseja obter';
 if(match(last,/\b(parar|pare|stop|remover|nao me (contate|mande|chame)|sem interesse|nao tenho interesse|nao quero (mensagem|contato))\b/)){
  stage='opt_out';profile='direct';risk='do_not_contact';nextAction='Encerrar com educação, registrar bloqueio e não retomar o contato';signals.push('recusa explícita');
 }else if(match(last,/\b(quero falar com (uma? )?(pessoa|atendente|responsavel)|falar com alguem|chama (o|a) (dono|responsavel)|atendimento humano)\b/)){
  stage='human_handoff';profile='direct';risk='human_required';nextAction='Transferir para uma pessoa, sem prometer horário não confirmado';signals.push('pediu atendimento humano');
 }else if(match(last,/\b(ja paguei|pagamento feito|recebi o site|ajusta|troca(r)? as fotos|alterar (a|o) (foto|link|texto)|nao esta funcionando|corrigir o site)\b/)){
  stage='delivery';profile='detail';nextAction='Acolher o pedido e confirmar exatamente quais ajustes serão feitos';signals.push('entrega ou suporte');
 }else if(match(last,/\b(vamos fechar|quero contratar|pode fazer|vamos fazer|aceito a proposta|pode mandar o contrato|fechado|vamos seguir)\b/)){
  stage='decision';profile='ready';nextAction='Confirmar o escopo e o próximo passo de contratação';signals.push('aceite ou intenção clara');
 }else if(match(last,/\b(quanto custa|quanto fica|qual (e )?o valor|preco|desconto|parcel|pagamento|valor final|orcamento)\b/)){
  stage='negotiation';profile='price';nextAction='Confirmar valores e condições já aprovados antes de apresentar proposta';signals.push('pergunta sobre investimento');
 }else if(match(last,/\b(pode(mos)? (marcar|agendar)|reuniao|visita|conversar pessoalmente|horario disponivel)\b/)){
  stage='evaluation';profile='direct';nextAction='Propor opções de agenda e confirmar disponibilidade real';signals.push('reunião');
 }else if(match(last,/\b(vou pensar|preciso pensar|analisar|ver com (meu|minha|o|a)|depois eu vejo|mais pra frente|nao sei ainda|tenho que ver)\b/)){
  stage='evaluation';profile='cautious';nextAction='Dar espaço para avaliação e ficar disponível sem pressionar';signals.push('decisão em análise');
 }else if(match(last,/\b(exemplo|portfolio|mostra|foto|link|site parecido|trabalho de voces)\b/)){
  stage='evaluation';profile='visual';nextAction='Compartilhar apenas portfólio autorizado e relevante';signals.push('quer ver exemplos');
 }else if(match(last,/\b(como funciona|me explica|nao entendi|o que e|detalhes|quais etapas|dominio|hospedagem)\b/)){
  stage='discovery';profile='detail';nextAction='Explicar de modo simples, com uma etapa por vez';signals.push('pediu esclarecimentos');
 }else if(last.length<65&&match(last,/\b(oi|ola|bom dia|boa tarde|boa noite|tudo bem|quem fala)\b/)){
  stage='new';profile='neutral';nextAction='Se for a primeira interação comprovada, cumprimentar uma vez; em conversa existente, retomar o tema sem apresentação';signals.push('cumprimento, abertura ainda não verificada');
 }
 if(stage==='discovery'&&match(all,/\b(preco|valor|pagar|orcamento)\b/)&&match(last,/\b(interessante|gostei|entendi)\b/)){stage='evaluation';signals.push('avaliando a proposta');}
 return {
  stage,profile,profileLabel:PROFILE_LABELS[profile],risk,nextAction,
  signals,confidence:signals.length?'moderate':'low',
  limitation:'Sinais da conversa; não é diagnóstico psicológico nem dado demográfico.',
  requiresHumanReview:true
 };
}
export function contextForGroq(a){
 return [
  'ETAPA COMERCIAL DETECTADA: '+a.stage,
  'SINAL DE COMUNICAÇÃO: '+a.profileLabel,
  'EVIDÊNCIAS TEXTUAIS: '+(a.signals.join('; ')||'insuficientes'),
  'PRÓXIMA AÇÃO RECOMENDADA: '+a.nextAction,
  a.risk==='do_not_contact'?'PRIORIDADE: pedido de não contato. Não continuar vendas.':a.risk==='human_required'?'PRIORIDADE: oferecer transferência humana.':'Nunca pressionar para fechar ou inferir intenções privadas.',
  'Estes rótulos são hipóteses revisáveis; observe o texto real e não invente informações.'
 ].join('\n');
}
