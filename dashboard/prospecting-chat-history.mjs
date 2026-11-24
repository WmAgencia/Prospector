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

/**
 * Read-before-first-attempt. Caller MUST first establish that its durable
 * per-step ledger contains no previous attempt. This function never sends.
 * An absent item in the most recent 100 messages is safe to act on ONLY when
 * the independent local ledger proves there was no prior network send.
 */
export async function preflightNewStep({sessionId,jid,kind='TEXT',text='',at=new Date(),fetchChat}={}){
 const history=await loadProspectorHistory({sessionId,jid,fetchChat});
 if(history.state!=='AVAILABLE')return {state:'UNAVAILABLE'};
 const atIso=new Date(at).toISOString();
 const type=String(kind||'TEXT').toUpperCase();
 if(type==='TEXT'){
  const found=findSentTextInHistory({messages:history.messages,expectedText:text,attemptedAt:atIso,spanMs:90000});
  return {state:found.state==='NOT_FOUND'?'CLEAR':found.state==='UNIQUE_CONTENT'?'EXISTS':found.state,message:found.message||null};
 }
 const nearby=history.messages.filter(m=>{
  if(m?.fromMe!==true||String(m.type||'').toUpperCase()!==type)return false;
  const timestamp=messageTime(m);
  if(!timestamp||Math.abs(timestamp-Date.parse(atIso))>90000)return false;
  return type!=='VIDEO'||normalize(m.content||m.caption)===normalize(text);
 });
 if(!nearby.length)return {state:'CLEAR'};
 if(nearby.length>1)return {state:'AMBIGUOUS'};
 // Video is uniquely identified by the campaign caption. An audio record
 // without a hash may be another voice note and requires human review.
 return {state:type==='VIDEO'?'EXISTS':'POSSIBLE_EXISTING',message:nearby[0]};
}
