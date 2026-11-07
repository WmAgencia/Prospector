// Only actionable coach replies become pending review cards; a clarification
// question stays in chat and never mutates the approved or pending manual.
export function trainingChatDraftProposal(userText,assistantText){
 const user=String(userText||'').trim().replace(/\s+/g,' ');
 const answer=String(assistantText||'').trim();
 if(user.length<5||answer.length<20||/\?\s*$/.test(answer))return null;
 if(!/\b(quando|sempre|nunca|deve|precisa|faça|pergunte|responda|explique|informe|confirme|encaminhe|ofereça|apresente|cliente|atendimento|serviço|empresa|venda|preço|orçamento|prazo|pagamento|contrato)\b/i.test(answer))return null;
 const topic=user
  .replace(/^(?:eu\s+)?(?:quero|gostaria|preciso)\s+(?:que\s+(?:a\s+)?(?:francisca|você)\s+)?(?:adicione|adicionar|ensine|ensinar|fale|responda|explique|registrar?|coloque)\s*/i,'')
  .replace(/^(?:orientação|regra)\s*:\s*/i,'')
  .split(/[.!?\n]/)[0].trim();
 const title=(topic.length>=8?topic:'Orientação adicional de atendimento').slice(0,95).replace(/[#<>]/g,' ');
 // A summary heading from a model must not accidentally split the review
 // Markdown into unrelated cards. The full answer stays visible in chat.
 const body=answer.replace(/^#{1,6}\s+/gm,'').trim();
 return {title,body};
}
