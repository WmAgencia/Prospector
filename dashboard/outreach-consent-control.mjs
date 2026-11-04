// Meta/WhatsApp policy-driven outbound consent control.
// UI may display this control now, but changing the recipient permission requirement
// is NOT a customer preference while WhatsApp requires opt-in before initiation.
// Review official WhatsApp Business Messaging Policy before any future release.
export const WHATSAPP_POLICY_REVIEWED_AT='2026-11-04';
export const WHATSAPP_POLICY_VERSION='2026-09-23';
export const WHATSAPP_POLICY_URL='https://whatsappbusiness.com/policy/';

export function outreachConsentControl(){
 return Object.freeze({
  enforced:true,
  canDisable:false,
  policyStatus:'OPT_IN_REQUIRED',
  policyReviewedAt:WHATSAPP_POLICY_REVIEWED_AT,
  policyVersion:WHATSAPP_POLICY_VERSION,
  policyUrl:WHATSAPP_POLICY_URL,
  label:'Exigir autorização prévia para mensagens comerciais',
  message:'A política atual do WhatsApp exige consentimento antes do primeiro contato. A desativação ficará disponível somente depois de mudança oficial da política e atualização validada do Prospector.',
 });
}

export function requestOutreachConsentControl(input){
 if(!input||typeof input.enforced!=='boolean')return {
  status:400,body:{...outreachConsentControl(),error:'Informe enforced como verdadeiro ou falso.'}
 };
 if(input.enforced===false)return {
  status:409,body:{...outreachConsentControl(),error:'A proteção não pode ser desativada: a política vigente do WhatsApp ainda exige autorização prévia.'}
 };
 return {status:200,body:{...outreachConsentControl(),ok:true,message:'Proteção de autorização confirmada como ativa.'}};
}
