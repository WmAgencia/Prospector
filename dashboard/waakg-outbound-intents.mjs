// Correlate WA-AKG message.sent webhooks with outbound requests made by Prospector.
// WhatsApp messages sent from the owner's phone have no matching API intent.
// This is a short-lived guard, not a persisted consent or delivery record.
const pending=new Map();
const validSession=s=>/^[A-Za-z0-9_-]{3,70}$/.test(String(s||''));
const validJid=j=>/^\d{10,15}@s\.whatsapp\.net$/.test(String(j||''));
function canonical(type,body=''){
 const kind=String(type||'').toUpperCase();
 return {kind:['AUDIO','VOICE','PTT'].includes(kind)?'AUDIO':kind==='TEXT'?'TEXT':kind,
         text:kind==='TEXT'?String(body||'').trim():''};
}
function keyOf(session,jid,type,text){
 const {kind,text:body}=canonical(type,text);
 return JSON.stringify([session,jid,kind,body]);
}
function prune(at){
 for(const [key,expires] of pending)if(expires<=at)pending.delete(key);
}
export function registerApiOutboundIntent({session,jid,type='TEXT',text=''}={}){
 if(!validSession(session)||!validJid(jid))return false;
 const {kind}=canonical(type,text);
 if(!['TEXT','AUDIO'].includes(kind))return false;
 const at=Date.now();
 prune(at);
 pending.set(keyOf(session,jid,kind,text),at+(kind==='AUDIO'?35_000:90_000));
 return true;
}
export function isApiOutboundEcho({session,jid,type,text=''}={}){
 const at=Date.now();
 prune(at);
 return (pending.get(keyOf(session,jid,type,text))||0)>at;
}
