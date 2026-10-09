// Regras determinísticas contextualizadas pela pergunta anterior — sem modelo de IA.
import {normalize} from './classifier.mjs';
export function evaluateDecision(text, context='general_interest'){
 const s=normalize(text);
 if(!s)return {decision:'REVIEW',reason:'empty'};
 // Desistência e recusa sempre sobrepõem afirmações presentes na mesma mensagem.
 if(/\b(?:nao|nunca|nem|sem interesse|nao quero|nao preciso|dispenso|prefiro nao|ja tenho (?:site|pagina)|agora nao|nao obrigado|melhor nao)\b/.test(s))
  return {decision:'NO',reason:'refusal'};
 // Não adivinhar "quero" no meio de frase que não fala de demonstração.
 const strong=/^(?:sim|s|pode|pode sim|pode mandar|pode enviar|manda|manda sim|me manda|manda ai|quero|quero sim|quero ver|claro|claro que sim|com certeza|por favor|pode ser|beleza|ok|bora|pode falar|fale|gostaria|pode mostrar|mostra|me mostra)[!?. ]*$/;
 const sample=/(?:(?:quero|pode|manda|me envia|me mostra|gostaria|aceito).{0,45}(?:exemplo|demonstracao|previa|modelo).{0,50}(?:site|pagina|landing)?|(?:exemplo|demonstracao|previa).{0,32}(?:site|pagina))/.test(s);
 const positive=strong.test(s)||sample||/\b(?:tenho interesse|gostaria de ver|tenho vontade de conhecer|quero saber mais|me interessa)\b/.test(s);
 if(positive)return {decision:'YES',reason:sample?'explicit_sample':'affirmative_in_context'};
 return {decision:'REVIEW',reason:'ambiguous'};
}
export function normalizeSegment(value){return normalize(value).replace(/[?!]/g,'').trim();}
export function selectAutomationForLead(lead,workflows,preferredId=null){
 const enabled=workflows.filter(w=>w.enabled!==0);
 if(preferredId){
  const chosen=enabled.find(w=>w.id===preferredId);
  if(!chosen)throw Error('Automação selecionada não existe ou está desativada');
  return chosen;
 }
 const segment=normalizeSegment(lead.segment||'');
 const matches=enabled.filter(w=>{
  let tags=[];try{tags=JSON.parse(w.segments_json||'[]');}catch{}
  return segment&&tags.some(t=>normalizeSegment(t)===segment);
 });
 if(matches.length)return [...matches].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')||a.id.localeCompare(b.id))[0];
 return enabled.find(w=>w.is_default===1)||null;
}
