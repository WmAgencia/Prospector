export function isOfferActive(expiry,at=Date.now()){
 return Boolean(expiry&&Date.parse(expiry+'T23:59:59-03:00')>=at);
}
export function validateExpiry(date,at=Date.now()){
 const s=String(date||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('Informe data final (AAAA-MM-DD)');
 const end=Date.parse(s+'T23:59:59-03:00');
 if(!Number.isFinite(end)||end<=at||end>at+30*86400000)throw Error('Prazo da promoção deve ser futuro e dentro de 30 dias');
 return s;
}
export function proposedFlow({audioId,videoId,intro}){
 const text=String(intro||'Olá, {{business_name}}! Posso te explicar uma proposta de criação de site da Consecom? Se não quiser receber mensagens, basta avisar.').trim();
 if(text.length<25||text.length>950)throw Error('Mensagem inicial de 25 a 950 caracteres');
 return [{id:'intro',type:'message',text},{id:'reply',type:'wait_reply'},{id:'pause',type:'delay',seconds:60},{id:'offer-audio',type:'audio',media_id:audioId,description:'Oferta de site por R$350 com validade real e entrega em até três dias.'},{id:'media-pause',type:'delay',seconds:8},{id:'demo-video',type:'video',media_id:videoId},{id:'interest-reply',type:'wait_reply'},{id:'end',type:'end'}];
}
