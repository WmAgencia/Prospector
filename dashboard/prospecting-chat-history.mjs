// Positive evidence from WA-AKG's last 100 persisted messages.
// Missing data is NOT proof of non-delivery (history may be partial).
const normalize=value=>String(value||'').replace(/\s+/g,' ').trim();
const validId=value=>/^[\w-]{5,150}$/.test(String(value||''));
export const outboundId=m=>String(m?.keyId||m?.key?.id||'');
export const messageTime=m=>{
 const value=m?.timestamp||m?.createdAt||m?.at;
 const n=Number(value);
 return Number.isFinite(n)&&n>1e11?n:Number.isFinite(n)&&n>1e8?n*1000:Date.parse(value)||0;
};
const isOutbound=(m,type)=>m?.fromMe===true&&String(m.type||'').toUpperCase()===type;
export function findSentTextInHistory({messages=[],expectedText='',attemptedAt='',providerId=null,spanMs=120000}={}){
 if(!Array.isArray(messages))return {state:'UNAVAILABLE'};
 if(providerId&&validId(providerId)){
  const found=messages.find(m=>isOutbound(m,'TEXT')&&outboundId(m)===String(providerId));
  return found?{state:'EXACT_ID',message:found}:{state:'NOT_FOUND'};
 }
 const expected=normalize(expectedText);
 const time=Date.parse(attemptedAt);
 if(!expected||!Number.isFinite(time))return {state:'INSUFFICIENT_EVIDENCE'};
 const matches=messages.filter(m=>isOutbound(m,'TEXT')&&validId(outboundId(m))&&normalize(m.content||m.text)===expected&&
  Math.abs(messageTime(m)-time)<=spanMs);
 return matches.length===1?{state:'UNIQUE_CONTENT',message:matches[0]}:
  {state:matches.length?'AMBIGUOUS':'NOT_FOUND'};
}
export function isConfirmedMessageState(status){
 return ['SENT','DELIVERED','READ'].includes(String(status||'').toUpperCase());
}
export async function loadProspectorHistory({sessionId,jid,fetchChat}={}){
 if(!sessionId||!/^\d{10,15}@s\.whatsapp\.net$/.test(jid||'')||typeof fetchChat!=='function')return {state:'UNAVAILABLE',messages:null};
 try{
  const result=await fetchChat('/api/chat/'+encodeURIComponent(sessionId)+'/'+encodeURIComponent(jid));
  if(result?.status!==true||!Array.isArray(result.data))return {state:'UNAVAILABLE',messages:null};
  return {state:'AVAILABLE',messages:result.data.slice(-100)};
 }catch{return {state:'UNAVAILABLE',messages:null};}
}
