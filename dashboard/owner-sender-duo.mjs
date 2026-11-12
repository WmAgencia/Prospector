// Consecom owner: only the two explicitly identified, authenticated WhatsApp
// numbers may originate first approaches. The inactive third session is excluded.
// Never silently switch to one number if its counterpart loses connectivity.
export const OWNER_SENDER_SUFFIXES=Object.freeze(['7336','2994']);
export function selectVerifiedOwnerDuo(items=[],previous=''){
 const chosen=[];
 for(const suffix of OWNER_SENDER_SUFFIXES){
  const found=items.filter(x=>x?.connected===true&&x?.transportStale!==true&&x?.numberSuffix===suffix&&typeof x?.session_id==='string');
  if(found.length!==1)return {connected:false,sessionId:'',cursor:previous,reason:found.length?'AMBIGUOUS_OWNER_SESSION':'OWNER_DUAL_SESSION_OFFLINE',missingSuffix:suffix};
  chosen.push(found[0]);
 }
 if(chosen[0].session_id===chosen[1].session_id)return {connected:false,sessionId:'',cursor:previous,reason:'DUPLICATE_OWNER_SESSION'};
 const index=chosen.findIndex(x=>x.session_id===previous);
 const next=chosen[index===0?1:0];
 return {connected:true,sessionId:next.session_id,cursor:previous,reason:'READY',
  numberSuffix:next.numberSuffix,rotation:'STRICT_7336_2994'};
}
