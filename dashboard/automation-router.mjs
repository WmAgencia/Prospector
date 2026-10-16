// Regras determinísticas contextualizadas pela pergunta anterior — sem modelo de IA.
import {normalize} from './classifier.mjs';
export function evaluateDecision(text, context='general_interest'){
 const s=normalize(text);
 if(!s)return {decision:'REVIEW',reason:'empty'};
 // Resposta hesitante deve passar por revisão, sem decisão presumida.
 if(/^(?:nao sei|nao tenho certeza|talvez|preciso pensar|vou pensar|vou ver|deixa eu pensar|tenho que avaliar)[!?. ]*$/.test(s))
  return {decision:'REVIEW',reason:'uncertain'};
 // Desistência e recusa sempre sobrepõem afirmações presentes na mesma mensagem.
 if(/\b(?:nao|nunca|nem|sem interesse|nao quero|nao preciso|dispenso|prefiro nao|ja tenho (?:site|pagina)|agora nao|nao obrigado|melhor nao)\b/.test(s))
  return {decision:'NO',reason:'refusal'};
 // Após o vídeo, o interesse precisa estar claro. "ok", "gostei" e "legal"
 // não viram automaticamente oportunidades no Kanban.
 if(context==='website_interest'){
  const direct=/^(?:sim|sim quero|sim tenho interesse|quero|quero sim|claro|com certeza|quero um|quero um assim|gostaria sim|tenho interesse|tenho interesse sim)[!?. ]*$/;
  const explicit=/\b(?:quero (?:um|uma|o|esse|site|fazer|contratar)|quero ter (?:um|o) site|gostaria de ter|gostaria de contratar|tenho interesse|me interessei|estou interessad[oa]|vamos (?:fechar|fazer|comecar)|pode comecar|pode fazer|pode fechar|quero fechar|vamos fechar|pode iniciar|quero um desse|quero um igual|aceito a proposta)\b/;
  if(direct.test(s)||explicit.test(s))return {decision:'YES',reason:'explicit_site_interest'};
  return {decision:'REVIEW',reason:'interest_not_confirmed'};
 }
 // Aceite explícito de receber a apresentação, mesmo com "sim" / "ok" antes da frase.
 if(/^(?:(?:sim|claro|beleza|ok|perfeito|tranquilo|tudo bem)\s+)?(?:pode enviar|pode mandar|pode me mandar|pode passar|me envia|pode explicar|pode falar|manda|manda ai)(?:\s+(?:sim|por favor|o audio|o video|a proposta|pra mim))?$/.test(s))
  return {decision:'YES',reason:'explicit_permission'};
 // Não adivinhar "quero" no meio de frase que não fala de demonstração.
 const strong=/^(?:sim|s|pode|pode sim|pode mandar|pode enviar|manda|manda sim|me manda|manda ai|quero|quero sim|quero ver|claro|claro que sim|com certeza|por favor|pode ser|beleza|ok|bora|pode falar|fale|gostaria|pode mostrar|mostra|me mostra)[!?. ]*$/;
 const sample=/(?:(?:quero|pode|manda|me envia|me mostra|gostaria|aceito).{0,45}(?:exemplo|demonstracao|previa|modelo).{0,50}(?:site|pagina|landing)?|(?:exemplo|demonstracao|previa).{0,32}(?:site|pagina))/.test(s);
 const conversational=s.replace(/^(?:oi|ola|opa|bom dia|boa tarde|boa noite)(?: tudo bem)?\s+(?=(?:pode|sim|claro|manda|quero|ok)\b)/,'');
 const positive=strong.test(conversational)||sample||/\b(?:tenho interesse|gostaria de ver|tenho vontade de conhecer|quero saber mais|me interessa)\b/.test(s);
 if(positive)return {decision:'YES',reason:sample?'explicit_sample':'affirmative_in_context'};
 return {decision:'REVIEW',reason:'ambiguous'};
}
export function evaluatePresentationReply(text){
 const raw=String(text||'').trim(),normalized=normalize(raw);
 if(/\b(?:talvez|vou pensar|preciso pensar|depois eu vejo|nao sei|nao tenho certeza)\b/.test(normalized))return {decision:'REVIEW',reason:'uncertain'};
 const existing=evaluateDecision(raw,'general_interest');
 if(existing.decision==='NO')return existing;
 const clauses=raw.split(/(?<=[.!?])\s+|\n+/).map(s=>s.trim()).filter(Boolean);
 const last=clauses[clauses.length-1]||raw;
 if(last.endsWith('?'))return {decision:'REVIEW',reason:'question_not_permission'};
 if(existing.decision==='YES')return existing;
 const s=normalize(last).replace(/[!?]/g,' ').trim();
 if(/\b(?:pode (?:me )?(?:mandar|enviar|falar|explicar|apresentar)|manda (?:ai|a proposta|o audio|pra mim|para mim)|me (?:manda|envia|explica)|quero (?:receber|ouvir|conhecer)|pode sim)\b/.test(s))return {decision:'YES',reason:'explicit_presentation_permission'};
 return existing;
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

export function permitsPresentation(steps,nextStep,text){
 return steps?.[nextStep]?.type==='delay'&&steps?.[nextStep+1]?.type==='audio'&&evaluatePresentationReply(text).decision==='YES';
}
