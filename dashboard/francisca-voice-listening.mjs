// Hold-to-finish speech: per-call only. No microphone data or transcript stored
// outside process memory. The caller controls when an answer is requested.
const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const start=/^(?:francisca[, ]+)?(?:espera|espere|aguarda|aguarde|pera ai|perai|nao responde ainda|nao me interrompe|deixa eu terminar|me deixa terminar|so escuta|so ouve|vou explicar uma coisa)(?:[,.! ]|$)/;
const release=/^(?:francisca[, ]+)?(?:pronto[,! ]*|terminei[,! ]*|agora\s+)?(?:pode\s+)?(?:responder|responde|falar|fala|me responder|me responde|continuar|continua)(?:\s+agora)?[.! ]*$|^(?:pronto|terminei)[.! ]*$/;
const abort=/^(?:cancela|cancelar|deixa pra la|esquece|nao precisa responder|nao responde|vamos mudar de assunto)[.! ]*$/;
export function newVoiceListeningFlow({maxParts=8,maxChars=1700,expiresMs=6*60_000}={}){
 let active=false,parts=[],started=0;
 const clear=()=>{active=false;parts=[];started=0;};
 return {
  turn(text){
   const heard=String(text||'').trim(),n=clean(heard);
   if(active&&Date.now()-started>expiresMs){clear();return {handled:true,spoken:'O tempo de escuta terminou. Pode me dizer novamente o que gostaria de perguntar?'};}
   if(!active){
    if(!start.test(n))return {handled:false};
    active=true;parts=[];started=Date.now();
    return {handled:true,spoken:'Estou ouvindo. Pode continuar; vou responder quando você pedir.'};
   }
   if(abort.test(n)){clear();return {handled:true,spoken:'Certo, deixei esse assunto de lado.'};}
   if(release.test(n)){
    const combined=parts.join(' ').trim();
    clear();
    if(!combined)return {handled:true,spoken:'Pode falar. Qual é a sua pergunta?'};
    return {handled:true,answerText:combined};
   }
   if(!heard)return {handled:true,spoken:'Estou ouvindo.'};
   // Never silently truncate a dictation; force an explicit release or restart.
   if(parts.length>=maxParts||parts.join(' ').length+heard.length+1>maxChars){
    return {handled:true,spoken:'Já anotei bastante coisa. Diga "pode responder" para eu considerar tudo o que você falou, ou "cancela" para recomeçar.'};
   }
   parts.push(heard);return {handled:true,spoken:parts.length===1?'Pode continuar.':'Estou ouvindo.'};
  },
  end:clear,
  get state(){return {active,parts:parts.length,chars:parts.join(' ').length};}
 };
}
