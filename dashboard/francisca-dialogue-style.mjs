// Speech-specific style, independent of account permissions or external data.
// Designed to reduce filler/repeated greetings without silently inventing facts.
export const FRANCISCA_DIALOGUE_VERSION='francisca-voice-natural-2026-10-30';
const normalize=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const leadIn=/^\s*(?:ol[aá](?:\s+de\s+novo)?|oi|al[oô]|bom dia|boa tarde|boa noite)(?:[!.,:;\s\u2013\u2014-]+|$)/i;
const genericLead=/^\s*(claro|entendi|perfeito|com certeza|sem problema|vamos l[aá]|ótimo|otimo)(?:[!.,:;\s\u2013\u2014-]+|$)/i;
const longForm=/(?:explique|explica(?:r)?|detalh|aprofund|analise|an[aá]lise|comp[ae]r|quais (?:s[aã]o|seriam)|o que falta|por que|por qu[eê]|como funciona|como melhorar|me ensina|estrat[eé]gia|possibilidades|alternativas|passo a passo|quero entender|me fala mais|contexto inteiro|tudo sobre)/;
export function voiceReplyPlan(heard='',history=[]){
 const n=normalize(heard);
 const detailed=longForm.test(n)||n.length>120;
 const backAndForth=history.some(x=>x.role==='assistant');
 return {
  detailed,
  backAndForth,
  maxTokens:detailed?290:175,
  maxChars:detailed?610:390,
  maxSentences:detailed?4:2
 };
}
export function voiceStyleInstruction({heard='',history=[]}={}){
 const p=voiceReplyPlan(heard,history);
 const previous=history.filter(x=>x.role==='assistant').slice(-3).map(x=>String(x.content||''));
 const openerExamples=previous.map(x=>{
  const cleaned=x.replace(/^[\s"'“”]+/,'').match(/^.{1,48}?(?=[,.!?]|$)/)?.[0]||'';
  return cleaned.replace(/[\r\n<>]/g,' ').slice(0,45);
 }).filter(Boolean);
 return [
  'Você é a Francisca, assistente virtual da Consecom, conversando POR TELEFONE com o proprietário. Português brasileiro fluente e espontâneo, tom acolhedor, objetivo e seguro.',
  'A abertura da ligação já aconteceu. NÃO comece cada turno com oi, olá, alô, bom dia, boa tarde, "claro", "entendi", "perfeito" ou "vamos lá". Cumpra o pedido diretamente, usando transições variadas somente quando fizerem sentido.',
  'Não repita a pergunta recebida, nem a apresentação da agência, nem respostas anteriores. Se a pessoa disser "continua", retome o ponto em andamento sem recomeçar do zero.',
  'Se fizerem uma correção, aceite e ajuste o raciocínio sem pedir desculpas repetidas. Se mudarem de assunto, responda ao assunto novo.',
  'Fale como numa conversa real: alternar frases diretas, observações pertinentes, exemplos breves e uma pergunta de seguimento APENAS se ajudar; não encerre toda resposta com a mesma pergunta.',
  'Para brainstorming, apresente ideias realmente distintas; para uma pergunta factual, dê a resposta primeiro. Se a informação depender de dados não consultados, diga que não verificou.',
  p.detailed
   ? 'A pergunta pede explicação: ofereça conteúdo suficiente em até quatro frases faláveis, organizadas em sequência natural. Pode explicar o porquê, um exemplo e um próximo passo, sem leitura de lista.'
   : 'O turno pede uma resposta rápida: priorize uma ou duas frases espontâneas, sem enrolar nem alongar.',
  p.backAndForth
   ? 'Isto é CONTINUAÇÃO da mesma chamada, não o início de outro atendimento. Não cumprimente novamente.'
   : 'No primeiro turno você pode retribuir um cumprimento explícito do interlocutor, mas nunca faça uma nova apresentação completa.',
  openerExamples.length?'Aberturas usadas recentemente; evite repeti-las: '+openerExamples.join(' | '):'',
  'Nunca se passe por uma pessoa humana, invente serviços, dados do sistema, preços ou ações. Ferramentas administrativas e envios exigem confirmação por texto; em voz, somente leitura verificada.',
  'Não produza listas em markdown, emojis, manchetes ou tags de atuação. A saída é texto que será FALADO. Não há necessidade de sempre dizer o nome do interlocutor.'
 ].filter(Boolean).join('\n');
}
function cutNaturally(text,maxChars){
 if(text.length<=maxChars)return text;
 const prefix=text.slice(0,maxChars+1);
 const tail=prefix.slice(Math.max(0,Math.floor(maxChars*.55)),maxChars).search(/[.!?](?=\s|$)/);
 if(tail>=0){
  const idx=Math.max(0,Math.floor(maxChars*.55))+tail;
  return prefix.slice(0,idx+1).trim();
 }
 const split=prefix.slice(0,maxChars).lastIndexOf(' ');
 return prefix.slice(0,split>=maxChars*.65?split:maxChars).trim().replace(/[,;:\s]+$/,'')+'.';
}
export function polishVoiceReply(text,{history=[],heard='',maxChars}={}){
 const original=String(text||'').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim();
 if(!original)return original;
 const plan=voiceReplyPlan(heard,history);
 const earlier=history.filter(m=>m.role==='assistant').map(m=>String(m.content||''));
 let output=original.replace(/^\s*[-*]\s+/,'');
 // A requested literal greeting or script must not be rewritten.
 const quoting=/como (?:eu )?(?:cumpriment|saud|apresent)|roteiro|mensagem inicial|o que dizer|fala literalmente|citar exatamente|texto exato/.test(normalize(heard));
 if(earlier.length&&!quoting){
  output=output.replace(leadIn,'').trim();
  // Remove a crutch only when the same crutch opened the previous answer.
  const current=output.match(genericLead)?.[1];
  if(current&&genericLead.test(earlier.at(-1))){
   const previous=earlier.at(-1).match(genericLead)?.[1];
   if(previous&&normalize(current)===normalize(previous))output=output.replace(genericLead,'').trim();
  }
 }
 if(output.length<2)output=original;
 return cutNaturally(output,Math.min(640,Math.max(150,Number(maxChars)||plan.maxChars)));
}
