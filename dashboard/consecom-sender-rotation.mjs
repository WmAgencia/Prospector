// Consecom must alternate specifically between its primary WhatsApp and
// the named Consecom account. A disconnected sender BLOCKS the next cold
// approach instead of silently sending two consecutive approaches from one
// number or using an unrelated third session such as "iphone".
export const CONSECOM_SECONDARY_WHATSAPP_LABEL='Consecom';
export function chooseConsecomAlternatingSender(items=[],primaryId='',last=''){
 const sessions=Array.isArray(items)?items:[];
 const primary=sessions.find(x=>x.session_id===primaryId);
 if(!primary)return {connected:false,reason:'PRIMARY_SESSION_NOT_REGISTERED'};
 const secondaries=sessions.filter(x=>x.session_id!==primaryId&&String(x.label||'').toLocaleLowerCase('pt-BR')===CONSECOM_SECONDARY_WHATSAPP_LABEL.toLocaleLowerCase('pt-BR'));
 if(secondaries.length!==1)return {connected:false,reason:'SECONDARY_CONSECOM_SESSION_NOT_UNIQUE'};
 const secondary=secondaries[0];
 if(!primary.connected)return {connected:false,reason:'PRIMARY_WHATSAPP_OFFLINE'};
 if(!secondary.connected)return {connected:false,reason:'SECONDARY_WHATSAPP_OFFLINE'};
 const chosen=last===primaryId?secondary:primary;
 return {connected:true,sessionId:chosen.session_id,sessionLabel:chosen.label,
  numberSuffix:chosen.numberSuffix||null,pair:[primary.session_id,secondary.session_id],
  reason:null};
}
export function consecomPairStatus(items=[],primaryId=''){
 const result=chooseConsecomAlternatingSender(items,primaryId,'');
 return {ready:result.connected===true,reason:result.reason||null,
  onlineCount:items.filter(x=>x.connected===true).length,requiredOnline:2};
}
