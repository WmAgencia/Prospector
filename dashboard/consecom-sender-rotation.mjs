// Consecom sender selection validates the authenticated WhatsApp identity
// returned by WA-AKG. Names, labels and session ids are NOT phone numbers.
// Only the verified 7336 / 2994 pair can participate; all other accounts
// (including iPhone) are ignored. Missing or conflicting identity fails closed.
export const CONSECOM_SENDER_SUFFIXES=Object.freeze(['7336','2994']);
function verifiedNumber(row){
 if(row?.connected!==true)return '';
 const number=String(row.number||'');
 if(!/^\d{10,15}$/.test(number))return '';
 if(row.numberSuffix!==number.slice(-4))return '';
 return number;
}
export function chooseConsecomAlternatingSender(items=[],primaryId='',last=''){
 const sessions=Array.isArray(items)?items:[];
 const pool=CONSECOM_SENDER_SUFFIXES.map(suffix=>sessions.filter(x=>verifiedNumber(x).endsWith(suffix)));
 if(pool.some(matches=>matches.length!==1))return {connected:false,reason:'AUTHORIZED_NUMBER_MISSING_OR_AMBIGUOUS'};
 const [primary,secondary]=pool.map(matches=>matches[0]);
 if(primary.session_id!==primaryId)return {connected:false,reason:'PRIMARY_IDENTITY_MISMATCH'};
 if(primary.session_id===secondary.session_id)return {connected:false,reason:'DUPLICATE_SENDER_SESSION'};
 if(last&&last!==primary.session_id&&last!==secondary.session_id)return {connected:false,reason:'UNKNOWN_ROTATION_CURSOR'};
 const chosen=last===primary.session_id?secondary:primary;
 return {connected:true,sessionId:chosen.session_id,sessionLabel:chosen.label,
  numberSuffix:verifiedNumber(chosen).slice(-4),pair:[primary.session_id,secondary.session_id],
  reason:null};
}
export function consecomPairStatus(items=[],primaryId=''){
 const selection=chooseConsecomAlternatingSender(items,primaryId,'');
 return {ready:selection.connected===true,reason:selection.reason||null,
  onlineCount:selection.connected?2:0,requiredOnline:2};
}
