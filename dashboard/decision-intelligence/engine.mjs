// CONSECOM Decision Intelligence v2 - Choice + Score + Noul.
// Motor deterministicamente auditável. Não chama LLM/serviço externo, nem
// aprende automaticamente com as próprias previsões. Não gera mensagens.
import {normalize} from '../classifier.mjs';
const optOut=/\b(?:pare de (?:me )?(?:enviar|mandar|chamar)|nao (?:me )?(?:mande|manda|chame|chama|contate)|nao (?:quero|desejo) (?:mais )?(?:mensagens?|contato)|retir(?:e|a) (?:meu )?(?:contato|numero)|me (?:remova|remove|exclua|exclui)|descadastr|bloqueia|bloqueie|para de me chamar|nao me procure)\b/;
const refusal=/\b(?:nao tenho interesse|sem interesse|nao quero|nao preciso|nao obrigado|obrigad[oa] mas nao|dispenso|melhor nao|prefiro nao|ja tenho (?:site|pagina|quem faz|agencia|empresa fazendo)|agora nao|nao estou interessad[oa]|nao desejo|nao aceito)\b/;
const uncertain=/\b(?:talvez|nao sei|nao tenho certeza|preciso pensar|vou pensar|vou ver|deixa eu pensar|tenho que avaliar|pode ser depois|vou consultar|vou conversar com|nao posso decidir)\b/;
const objectionPrice=/\b(?:caro demais|muito caro|sem orcamento|sem verba|nao tenho dinheiro|fora do orcamento|desconto maior|tem parcelamento|pode parcelar|parcelar|pagar depois)\b/;
const objectionTiming=/\b(?:mes que vem|semana que vem|mais pra frente|ano que vem|nao e o momento|nao tenho tempo|estou ocupad[oa]|depois falamos)\b/;
const question=/\b(?:quanto custa|qual (?:o )?valor|quanto fica|como funciona|qual o prazo|quanto tempo|tem exemplo|qual a garantia|como e feito|pode explicar|me explique|o que voces fazem|como voces trabalham|quem sao voces)\b/;
const sitePositive=/\b(?:quero (?:um|uma|o|esse|site|fazer|contratar)|gostaria de ter|gostaria de contratar|tenho interesse|me interessei|estou interessad[oa]|vamos (?:fechar|fazer|comecar)|pode comecar|pode fazer|pode fechar|quero fechar|quero um desse|aceito a proposta)\b/;
const presentationPositive=/\b(?:pode (?:me )?(?:enviar|mandar|explicar|falar)|me (?:envia|manda|explica)|pode passar|quero (?:receber|ouvir)|manda (?:ai|o audio|o video|pra mim)|mostra|pode mostrar)\b/;
const smallYes=/^(?:sim|s|claro|pode sim|pode|com certeza|ok|beleza|blz|bora|perfeito|tranquilo|manda|manda sim|pode mandar|pode enviar|por favor|pode falar|quero sim|quero um assim|gostaria sim)[!?. ]*$/;
const smallNo=/^(?:nao|n|nunca|negativo|dispenso|nao obrigado)[!?. ]*$/;
const plainGreeting=/^(?:oi|ola|opa|bom dia|boa tarde|boa noite|tudo bem|tudo certo)[!?. ]*$/;
export const contexts=['general_interest','sample_offer','website_interest','presentation_permission'];

export function tokenize(text){
 return normalize(text).split(/\s+/).filter(t=>t.length>2&&t.length<32).slice(0,80);
}
function result(intent,decision,confidence,rule,context,requiresHuman=false,extra={}){
 return {engine:'consecom-decision-v2',intent,decision,confidence,reason:rule,matched_rules:[rule],
  context,requires_human:requiresHuman,allow_media:decision==='YES'&&context!=='website_interest',...extra};
}
// Pipeline: segurança/recusa > incerteza > objeção > contexto > modelo.
export function decideMessage(text,context='general_interest',{modelPrediction=null}={}){
 const ctx=contexts.includes(context)?context:'general_interest';
 const s=normalize(text);
 if(!s)return result('EMPTY','REVIEW',1,'empty',ctx,true);
 if(s.length>1500)return result('LONG_MESSAGE','REVIEW',1,'long_message',ctx,true);
 if(optOut.test(s))return result('OPT_OUT','NO',1,'explicit_opt_out',ctx,true);
 if(refusal.test(s)||smallNo.test(s))return result('NOT_INTERESTED','NO',0.99,'explicit_refusal',ctx);
 // "não, pode sim" é contraditório e exige revisão, não uma decisão positiva.
 if(/^(?:nao|n)\s*,?\s*(?:pode|sim|claro)\b/.test(s))return result('CONTRADICTORY','NO',0.99,'contradictory_negative',ctx,true);
 if(uncertain.test(s))return result('UNDECIDED','REVIEW',0.96,'hesitation',ctx,true);
 if(objectionPrice.test(s))return result('PRICE_OBJECTION','REVIEW',0.96,'price_objection',ctx,true);
 if(objectionTiming.test(s))return result('TIMING_OBJECTION','REVIEW',0.96,'timing_objection',ctx,true);
 if(ctx==='website_interest'){
  if(sitePositive.test(s)||/^(?:sim|sim quero|sim tenho interesse|quero|quero sim|claro|com certeza|quero um|quero um assim|gostaria sim|tenho interesse)[!?. ]*$/.test(s))return result('INTERESTED','YES',0.97,'explicit_site_interest',ctx);
  if(question.test(s)||s.endsWith('?'))return result('QUESTION','REVIEW',0.95,'sales_question',ctx,true);
  return result('AMBIGUOUS','REVIEW',0.78,'site_interest_not_confirmed',ctx,true);
 }
 if(question.test(s)||s.endsWith('?')){
  // "pode me mandar?" é pedido explícito; a pergunta final não invalida o aceite.
  if(presentationPositive.test(s)&&!/\b(?:quanto|como|qual|quem|porque|por que)\b/.test(s))
   return result('PERMISSION_GRANTED','YES',0.97,'explicit_permission_question',ctx);
  return result('QUESTION','REVIEW',0.97,'sales_question',ctx,true);
 }
 if(presentationPositive.test(s)||/\b(?:quero ver|quero um exemplo|me manda uma previa|quero uma previa|me mostra um exemplo)\b/.test(s))return result('PERMISSION_GRANTED','YES',0.98,'explicit_presentation_permission',ctx);
 if(smallYes.test(s))return result('CONTEXT_YES','YES',0.93,'affirmative_in_context',ctx);
 if(plainGreeting.test(s))return result('GREETING','REVIEW',0.99,'greeting_only',ctx);
 // Bayesian learning is advisory: NEVER promote inferred text into sending
 // media or closing a deal without explicit affirmative signals.
 if(modelPrediction?.supported&&modelPrediction.confidence>=0.75){
  return result(modelPrediction.label==='YES'?'POSSIBLE_INTEREST':modelPrediction.label==='NO'?'POSSIBLE_REFUSAL':'AMBIGUOUS',
   'REVIEW',Math.min(0.9,modelPrediction.confidence),'model_advisory',ctx,true,{model:modelPrediction});
 }
 return result('AMBIGUOUS','REVIEW',0.35,'insufficient_evidence',ctx,true);
}

export function scoreOpportunity(lead,origins=[]){
 let score=0;const reasons=[];
 const add=(weight,ok,label)=>{if(ok){score+=weight;reasons.push({points:weight,reason:label});}};
 add(30,!!lead.phone,'Telefone comercial cadastrado');
 add(15,!!lead.city,'Cidade conhecida');
 add(15,!!lead.segment,'Nicho identificado');
 add(10,!!lead.business&&String(lead.business).length>=3,'Empresa identificada');
 add(20,lead.website_status==='NO_WEBSITE','Ausência de site após revisão');
 add(12,['SOCIAL_ONLY','LINK_AGGREGATOR_ONLY','BROKEN_WEBSITE'].includes(lead.website_status),'Oportunidade de melhoria digital');
 add(5,lead.website_status==='NOT_FOUND_AFTER_CHECK','Site não localizado na pesquisa, inconclusivo');
 add(7,lead.website_status==='HAS_WEBSITE','Site identificado');
 add(5,origins.length>=2,'Informações de fontes múltiplas');
 score=Math.min(100,score);
 return {score,grade:score>=78?'A':score>=53?'B':'C',reasons,kind:lead.website_status==='NO_WEBSITE'?'NO_SITE_CONFIRMED':lead.website_status==='HAS_WEBSITE'?'HAS_SITE':lead.website_status==='UNCERTAIN'?'UNVERIFIED':'DIGITAL_PRESENCE_REVIEW',
  version:'consecom-lead-score-v2',explanation:'Pontuação baseada em cadastro e evidências. Não mede probabilidade estatística de conversão.'};
}
