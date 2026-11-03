/**
 * WhatsApp conversation intelligence: offline/read-only with company isolation.
 * The application must verify the caller is authorized for tenantId.
 * Outcomes are supplied by the CRM, not inferred from raw private chat text.
 */
const labels = ['interested','sale','no_interest','no_response','unclassified'];
const flags = s => {
  const text = String(s || '').trim().toLocaleLowerCase('pt-BR');
  return {
    question: text.includes('?'),
    cta: /\b(agendar|marcar|orçamento|orcamento|proposta|conversar|falar com|posso te enviar)\b/u.test(text),
    concise: text.length > 0 && text.length <= 160,
    greeting: /^(oi|olá|ola|bom dia|boa tarde|boa noite)(\b|[!,.:])/u.test(text)
  };
};
const percentage = (n,d) => d ? Math.round(n*100/d) : 0;
export function analyzeAuthorizedConversations({
  tenantId,authorized,conversations,generatedAt=new Date().toISOString(),onProgress=()=>{}
}={}) {
  if (!authorized) throw Error('Autorização da empresa obrigatória');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(tenantId || '')) throw Error('Identificador da empresa inválido');
  if (!Array.isArray(conversations) || conversations.length > 10000) throw Error('Lote inválido');
  if (typeof onProgress !== 'function') throw Error('Progresso inválido');
  const outcomes = Object.fromEntries(labels.map(v=>[v,0]));
  const tactics = Object.fromEntries(['question','cta','concise'].map(v=>[v,{count:0,success:0}]));
  const result = {total:0,messagesIn:0,messagesOut:0,outcomes,replied:0,repeatGreetings:0,pricingMessages:0,tactics,generatedAt};
  let progress = -1;
  const notify = n => {if (n!==progress) {progress=n;onProgress({percent:n,processed:Math.round(n*conversations.length/100),total:conversations.length});}};
  notify(0);
  conversations.forEach((chat,index)=>{
    if (!chat || chat.tenantId !== tenantId) throw Error('Violação de isolamento entre empresas');
    if (!chat.isGroup) {
      if (!labels.includes(chat.outcome || 'unclassified')) throw Error('Classificação de resultado inválida');
      if (!Array.isArray(chat.messages) || chat.messages.length > 5000) throw Error('Quantidade de mensagens inválida');
      result.total++;
      const outcome = chat.outcome || 'unclassified';
      outcomes[outcome]++;
      let inbound=0,outbound=0,first=true,repeated=0,prices=0,short=0;
      let question=false,cta=false;
      const seen=new Set();
      for (const m of chat.messages) {
        if (!m || !['in','out'].includes(m.direction)) continue;
        if (m.id != null) {if(seen.has(String(m.id)))continue;seen.add(String(m.id));}
        if(m.direction==='in'){inbound++;continue;}
        outbound++;
        const s=String(typeof m.body==='string'?m.body:'');
        const f=flags(s);
        question ||= f.question;
        cta ||= f.cta;
        short+=Number(f.concise);
        if(!first && f.greeting)repeated++;
        first=false;
        if(/(?:r\$ ?\d|\bpreço\b|\bpreco\b|\bvalor\b|\bdesconto\b)/iu.test(s))prices++;
      }
      result.messagesIn+=inbound;
      result.messagesOut+=outbound;
      result.replied+=Number(inbound>0);
      result.repeatGreetings+=repeated;
      result.pricingMessages+=prices;
      const success=outcome==='interested'||outcome==='sale';
      for (const [name,used] of Object.entries({question,cta,concise:outbound>0 && short/outbound>=0.75})) {
        if(used){tactics[name].count++;tactics[name].success+=Number(success);}
      }
    }
    notify(Math.floor((index+1)*100/conversations.length));
  });
  notify(100);
  const lines=[
    '# Relatório de inteligência de conversas',
    '',
    'Data da análise: '+generatedAt,
    '',
    '## Resumo',
    '- Conversas analisadas: '+result.total,
    '- Mensagens recebidas: '+result.messagesIn+'; enviadas: '+result.messagesOut,
    '- Conversas com resposta: '+result.replied+' ('+percentage(result.replied,result.total)+'%)',
    '- Interessados: '+outcomes.interested+'; vendas: '+outcomes.sale,
    '- Sem interesse: '+outcomes.no_interest+'; sem resposta: '+outcomes.no_response+'; não classificadas: '+outcomes.unclassified,
    '- Saudações repetidas: '+result.repeatGreetings,
    '',
    '## Padrões (associação, não causalidade)'
  ];
  for (const [key,name] of Object.entries({question:'Perguntas',cta:'Convites para avançar',concise:'Mensagens curtas'})) {
    const t=tactics[key];
    lines.push(t.count<5 ? '- '+name+': amostra insuficiente ('+t.count+').' :
      '- '+name+': '+t.success+'/'+t.count+' conversas com interesse/venda ('+percentage(t.success,t.count)+'%).');
  }
  lines.push('','## Privacidade','Somente estatísticas agregadas. Sem nomes, telefones, identificadores nem trechos de mensagens. Grupos excluídos. Revisão humana obrigatória.','');
  const playbook=[
    '# PLAYBOOK.md (rascunho; aprovação humana obrigatória)',
    '',
    '- Cumprimente apenas na abertura da conversa.',
    '- Faça perguntas contextualizadas; não invente preço, prazo ou garantia.',
    '- Respeite opt-out; não envie mensagens com base neste documento.',
    '- Resultados do CRM são associações, não provas de causalidade.',
    '- Conversas analisadas: '+result.total,
    '- Status: PENDENTE_DE_APROVACAO',''
  ].join('\n');
  return {status:'PENDING_HUMAN_REVIEW',progress:100,summary:result,reportMarkdown:lines.join('\n'),playbookMarkdown:playbook};
}
