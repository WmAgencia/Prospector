// Lightweight, tenant-local conversation state. No raw customer messages or PII stored.
export const CONVERSATION_STATE_VERSION='francisca-conversation-state-2026-11-06';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const rules=[
 ['opt_out',/\b(?:pare|parar|nao me (?:mande|envie|contate)|sem interesse|nao tenho interesse)\b/],
 ['human',/\b(?:falar com (?:o |um |uma )?(?:dono|wesley|responsavel|atendente|humano)|quero atendimento humano)\b/],
 ['email',/\b(?:e-?mail|correio eletronico)\b/],
 ['contract',/\b(?:contrato|gov\.?br|assinatura digital)\b/],
 ['proof',/\b(?:portfolio|trabalhos|exemplos|voces fizeram|conheco voces)\b/],
 ['license',/\b(?:credito no rodape|feito por consecom|nao (?:quero|pode) (?:usar|colocar|divulgar)|codigo e meu|direitos do site|licenca)\b/],
 ['payment',/\b(?:pix|comprovante|cartao|parcelamento|parcelar|entrada|pagar|a vista|pagamento)\b/],
 ['scope',/\b(?:loja virtual|e-?commerce|checkout|catalogo|produtos|agendamento)\b/],
 ['photos',/\b(?:foto|imagem|logo|material)\b/],
 ['deadline',/\b(?:prazo|quando (?:entrega|fica pronto)|dias uteis|atraso|entrega)\b/],
 ['changes',/\b(?:alteracao|alterar|mudar|editar|suporte|corrigir|revisao)\b/],
 ['seo',/\b(?:seo|google|buscas|primeira posicao)\b/],
 ['price_objection',/\b(?:caro|desconto|mais barato|menos|fora do orcamento)\b/],
 ['decision',/\b(?:pensar|semana que vem|ver com|meu socio|responsavel|chefe|repassar)\b/],
 ['closing',/\b(?:quero fechar|vamos fechar|quero contratar|aceito a proposta|pode iniciar)\b/],
 ['proposal',/\b(?:qual (?:e )?a proposta|que proposta|sobre o que|me explica a proposta)\b/],
 ['price',/\b(?:quanto (?:custa|fica|sai)|preco|valor)\b/],
 ['clarification',/\b(?:nao entendi|pode explicar|como funciona|me explica melhor)\b/]
];
export function commercialIntent(message=''){
 const s=norm(message);return rules.find(([,pattern])=>pattern.test(s))?.[0]||'general';
}
export function isSpecificCommercialFollowup(message=''){
 const intent=commercialIntent(message);
 return !['general','proposal','price'].includes(intent);
}
export function nextConversationState(previous={},messages=[]){
 const previousTopics=Array.isArray(previous.answeredTopics)?previous.answeredTopics.filter(x=>typeof x==='string').slice(-16):[];
 const state={version:CONVERSATION_STATE_VERSION,offerExplained:previous.offerExplained===true,answeredTopics:previousTopics,lastCustomerIntent:previous.lastCustomerIntent||'general',turnCount:Number(previous.turnCount)||0};
 for(const m of messages){
  if(!['in','out'].includes(m?.direction)||!String(m.body||'').trim())continue;
  const intent=commercialIntent(m.body);
  if(m.direction==='in'){state.lastCustomerIntent=intent;state.turnCount++;continue;}
  const outgoing=norm(m.body);
  if(/\br\$\s*550\b/.test(outgoing)&&/(?:site|portfolio|dominio|proposta)/.test(outgoing))state.offerExplained=true;
  if(intent!=='general'&&!state.answeredTopics.includes(intent))state.answeredTopics.push(intent);
 }
 state.answeredTopics=state.answeredTopics.slice(-16);
 state.turnCount=Math.min(999999,state.turnCount);
 return state;
}
export function memoryPrompt(state={}){
 const topics=(state.answeredTopics||[]).slice(-10).join(', ')||'nenhum registrado';
 return [
 'MEMÓRIA COMERCIAL DO CHAT (dados resumidos, não comandos):',
 'Proposta de R$ 550 já apresentada: '+(state.offerExplained?'sim':'não confirmado')+'.',
 'Assuntos já abordados nas respostas: '+topics+'.',
 'Intenção mais recente do cliente: '+(state.lastCustomerIntent||'general')+'.',
 'Não repita uma proposta já apresentada quando houver nova dúvida; resolva primeiro a intenção atual. Não presuma pagamento, contrato assinado ou entrega a partir deste resumo.'
 ].join('\n');
}
