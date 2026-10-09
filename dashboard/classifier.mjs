// Classificador determinístico conservador e auditável.
export const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}\s?!]/gu,' ').replace(/\s+/g,' ').trim();
const rules=[
 ['OPT_OUT',/\b(?:pare de (?:me )?(?:mandar|enviar|chamar)|nao (?:me )?(?:mande|manda|chame|chama|contate)|me (?:remova|remove|exclua|exclui)|remove meu (?:numero|contato)|descadastr|bloqueia|para de me chamar)\b/],
 ['NOT_INTERESTED',/\b(?:(?:nao|n) tenho interesse|sem interesse|nao quero|nao preciso|obrigad[oa] mas nao|ja tenho (?:site|quem (?:faz|cuida)|empresa fazendo)|agora nao|nao to afim|nao estou interessado|nao desejo)\b/],
 ['INTERESTED',/\b(?:tenho interesse|me interessei|quero saber mais|quero conhecer|pode explicar|me explica|qual (?:o )?valor|quanto custa|quanto fica|me passa (?:os )?(?:precos|valores)|vamos marcar|pode agendar|me manda (?:mais )?informac(?:oes|ao)|quero contratar)\b/],
 ['QUESTION',/\b(?:como funciona|me conte mais|o que voces fazem|que servico|tem algum exemplo|manda (?:o )?(?:video|audio))\b/]
];
export function classify(s){
 const text=normalize(s);
 for(const [intent,rx] of rules)if(rx.test(text))return {intent,confidence:intent==='OPT_OUT'?1:0.96,matched_rules:[intent],allow_media:!['OPT_OUT','NOT_INTERESTED'].includes(intent),requires_human:['INTERESTED','QUESTION'].includes(intent)};
 if(/^(oi|ola|bom dia|boa tarde|boa noite|tudo bem|pode falar|sim|ok|certo|manda ai|blz|beleza|pode mandar|opa)[!?. ]*$/.test(text))return {intent:'NEUTRAL',confidence:0.9,matched_rules:['GREETING'],allow_media:true,requires_human:false};
 return {intent:'UNCERTAIN',confidence:0.3,matched_rules:[],allow_media:false,requires_human:true};
}
export function safeName(s){
 const v=String(s||'').split(/[|•\n]/)[0].trim().replace(/\s+(?:24h|whatsapp|online|sorocaba|campinas).*$/i,'').trim();
 return v.length>1&&v.length<55&&!/\d/.test(v)&&!/^(clinica|consultorio|atendimento|psicologia)$/i.test(v)?v:null;
}
export function renderTemplate(template,lead){
 const values={first_name:safeName(lead.name)?.split(/\s+/)[0]||'',person_name:safeName(lead.name)||'',business_name:safeName(lead.business)||'',city:lead.city||'',segment:lead.segment||'',instagram_username:lead.instagram||''};
 return String(template||'').replace(/\{\{(\w+)\}\}/g,(_,k)=>values[k]||'').replace(/\s+([,.!?])/g,'$1').replace(/\s{2,}/g,' ').trim();
}
