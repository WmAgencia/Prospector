// Ephemeral per-call continuity: an interruption stops sound, not the topic.
// Contains transcripts only in RAM, never written to disk, with a bounded window.
const MAX_MESSAGES=24;
const MAX_CHARS=650;
const normalize=t=>String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function voiceInterruptionHint(text=''){
 const n=normalize(text);
 if(/(?:muda(?:r)? (?:de )?assunto|outro assunto|vamos falar de outra coisa|esquece (?:isso|essa (?:pergunta|ideia))|deixa isso pra la)/.test(n))
  return 'switch';
 if(/(?:inclui|inclua|acrescenta|adiciona|coloca tambem|considera tambem|mas (?:tambem|inclui|adiciona)|na verdade|so que|e se|alem disso|nesse caso|continuando|pode completar|termina de)/.test(n))
  return 'extend';
 return 'infer';
}
export function newCallContext(){
 let history=[],lastReply=null,lastInterruption=null;
 return {
  messages(){return history.map(x=>({...x}));},
  last(){return lastReply?{...lastReply}:null;},
  noteInterruption(data){
   if(!data||typeof data!=='object'||typeof data.replyId!=='string'||!lastReply||
      lastReply.id!==data.replyId||lastReply.interrupted)return false;
   const actual=Math.max(0,Math.min(60000,Number(data.playedMs)||0));
   const total=Math.max(200,Math.min(60000,Number(data.totalMs)||lastReply.totalMs||1000));
   const pct=Math.min(100,Math.round(actual/total*100));
   lastReply.interrupted=true;
   lastInterruption={replyId:lastReply.id,pct,fullText:lastReply.text};
   return true;
  },
  systemNote(userText){
   const hint=voiceInterruptionHint(userText);
   const notes=[
    'Preserve a continuidade desta ligação e as restrições da tarefa anterior.',
    'Quando a fala atual acrescenta ou corrige a anterior, integre ambas: não abandone o pedido em andamento.',
    'Quando o usuário mudar explicitamente de assunto OU sua nova pergunta for claramente independente, priorize o novo pedido, sem esquecer que o histórico existe.',
    'Quando a intenção for ambígua, prefira continuidade contextual, sem fazer perguntas desnecessárias.',
    'Nunca execute ações administrativas pela fala sem confirmação por texto.'
   ];
   if(lastInterruption){
    notes.push('ATENÇÃO: a resposta anterior foi CORTADA no meio, e não deve ser tratada como totalmente ouvida.');
    notes.push('Estimativa da parte reproduzida: '+lastInterruption.pct+'% (aproximada, não transcrição exata).');
    notes.push('Rascunho de resposta que estava em andamento: '+lastInterruption.fullText);
   }
   if(hint==='switch')notes.push('O usuário sinalizou uma MUDANÇA EXPLÍCITA de assunto. Responda ao novo pedido e não retome o anterior agora.');
   else if(hint==='extend')notes.push('A nova fala indica ADIÇÃO OU CORREÇÃO. Una-a ao pedido anterior e responda considerando ambos.');
   return notes.join('\n').slice(0,1800);
  },
  remember({heard,spoken,replyId,totalMs}){
   if(typeof heard!=='string'||!heard.trim()||typeof spoken!=='string'||!spoken.trim())return;
   history.push({role:'user',content:heard.slice(0,MAX_CHARS)});
   history.push({role:'assistant',content:spoken.slice(0,MAX_CHARS)});
   if(history.length>MAX_MESSAGES)history=history.slice(-MAX_MESSAGES);
   lastReply={id:replyId,text:spoken.slice(0,MAX_CHARS),
    totalMs:Math.max(0,Number(totalMs)||0),interrupted:false};
   lastInterruption=null;
  },
  clear(){history=[];lastReply=null;lastInterruption=null;}
 };
}
