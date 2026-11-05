// Message signals, not a claim to identify every AI. Never follow a redirected
// number/link or treat a canned greeting as a person's interest or permission.
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export const INBOUND_AUTOMATION_VERSION='2026-11-05-v2';
export function classifyInboundAutomation(value=''){
 const n=normalize(value);
 const result=(reason,action='WAIT_HUMAN')=>({blocked:true,reason,action});
 const phone=/(?:\+?55\s*)?\(?[1-9]\d\)?[\s.-]*9?\d{4}[\s.-]?\d{4}|(?:wa\.me|api\.whatsapp\.com\/send)/;
 if(phone.test(n)&&/\b(?:entre em contato|entrar em contato|fale com|falar com|chame|chamar|ligue|ligar|mande (?:uma )?mensagem|envie (?:uma )?mensagem|novo numero|numero correto|atendimento (?:pelo|no)|nosso whatsapp)\b/.test(n))
  return result('CONTACT_REDIRECT','HUMAN_REVIEW');
 if(/\b(?:sou|somos|aqui e|este e|esta e|voce esta (?:falando|conversando) com)\s+(?:(?:o|a|um|uma|nosso|nossa|seu|sua)\s+)?(?:(?:assistente|atendente) (?:virtual|de ia|digital|inteligente)|chatbot|bot\b|robo\b|ia\b|inteligencia artificial)|\bsou\s+[^.!?]{1,50},\s*(?:uma?\s+)?(?:assistente|atendente) virtual/.test(n)&&!/\bnao (?:sou|somos)\b/.test(n))
  return result('AI_SELF_IDENTIFIED');
 if(/(?:mensagem|resposta|atendimento)\s+automatic[ao]|^[^a-z]*(?:assistente virtual|chatbot|menu (?:virtual|automatico))\b/.test(n)&&
    !/\b(?:nao (?:quero|mande|use)|recebi|recebemos|voces usam|voce e|isso e)\b.{0,45}(?:automatic|assistente|robo|bot)/.test(n))return result('AUTOMATIC_LABEL');
 if(/(?:digite|escolha|selecione|pressione)\s+(?:[0-9#*]|uma (?:das )?opco?e?s?|a opcao)|(?:para (?:agendar|orcamento|atendimento|suporte|continuar).{0,45}(?:informe|digite|selecione))|(?:informe (?:seu )?nome.{0,80}(?:modelo|ano|data|motor|servico|defeito))/.test(n))return result('AUTOMATIC_MENU');
 if(/(?:estamos|encontramo nos|no momento estamos).{0,35}(?:ausentes|indisponiveis|fora do horario|fechados)|(?:retornaremos|retornamos|responderemos).{0,45}(?:assim que possivel|em breve|horario comercial)|fora (?:do nosso|do) horario de atendimento/.test(n))return result('AWAY_MESSAGE');
 if(/(?:seja(?:m)? (?:muito )?bem[ -]?vind[oa]s?|agradece(?:mos)? (?:o |seu |o seu )?contato|obrigad[oa] pelo (?:seu )?contato).{0,180}(?:como (?:podemos|posso) ajudar|em que (?:podemos|posso) ajudar|retornaremos|horario de atendimento)/.test(n))return result('CANNED_GREETING');
 return {blocked:false,reason:'NO_AUTOMATION_SIGNAL',action:'CONTINUE'};
}
