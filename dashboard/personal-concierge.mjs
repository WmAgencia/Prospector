// Private inbound concierge: classify the *request*, never infer personal traits.
// Notices are independent of customer autoreplies and idempotent per contact.
import {one,all,run,now,queueNotice as unused} from './db.mjs';
import {queueNotice} from './notifications.mjs';
import {waControlStatus,waIdentityStatus,waRequest,selectedWaSession} from './waakg-control.mjs';

const digits=x=>String(x||'').replace(/\D/g,'');
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function personalPhone(){
 const raw=digits(process.env.PROSPECTOR_PERSONAL_PHONE);
 const full=raw.length===11?'55'+raw:raw;
 return /^55\d{10,11}$/.test(full)?full:null;
}
export function classifyInbound(text){
 const t=norm(text);
 if(/^(?:pare|parar|stop|sair|remover|nao (?:quero|me contate)|sem interesse)(?:[.!\s]|$)/.test(t))return {category:'opt_out',intro:false,human:true,label:'Não contatar'};
 if(/\b(?:humano|atendente|falar com (?:o )?(?:dono|responsavel)|quero falar com alguem)\b/.test(t))return {category:'human',intro:false,human:true,label:'Solicitação de pessoa'};
 if(/^(?:oi+|ola+|oie+|bom dia|boa tarde|boa noite|hey|alo|tudo bem)[!?.,\s]*$/.test(t))return {category:'greeting',intro:true,human:false,label:'Novo contato'};
 if(/\b(?:erro|nao funciona|bug|suporte|ajuste|atualizar|corrigir|problema|trocar fotos)\b/.test(t))return {category:'support',intro:false,human:false,label:'Suporte ou ajuste'};
 if(/\b(?:contratar|orcamento|proposta|site|pagina|preco|valor|marketing|servico|agendar|reuniao)\b/.test(t))return {category:'commercial',intro:false,human:false,label:'Consulta comercial'};
 return {category:'other',intro:false,human:false,label:'Assunto a esclarecer'};
}
export const firstGreeting=()=> 'Olá! Sou o assistente virtual da Consecom. Como posso ajudar?';
export function queueInboundBrief({leadId,phone,body,source='WHATSAPP_INBOUND'}={}){
 const dest=personalPhone();
 if(process.env.PROSPECTOR_PERSONAL_NOTICES_ENABLED!=='true'||!dest||!leadId)return false;
 const p=digits(phone);
 if(p===dest)return false;
 const kind=classifyInbound(body);
 if(kind.category==='opt_out')return false;
 const clean=String(body||'').replace(/[\r\n\t]+/g,' ').slice(0,180);
 // Exactly one initial notice for each contact; subsequent interest is a separate alert.
 return queueNotice('inbound-first:'+leadId,'PERSONAL_INBOUND',
  '📥 *Novo contato recebido*\nAssunto: '+kind.label+'\nNúmero: https://wa.me/'+p+
  '\nMensagem: '+clean+'\nOrigem: '+String(source).slice(0,50)+'\nAcompanhe no Prospector.',leadId);
}
export function statusConcierge(){
 return {notificationsEnabled:process.env.PROSPECTOR_PERSONAL_NOTICES_ENABLED==='true',
  notificationPhoneConfigured:!!personalPhone(),phoneSuffix:(personalPhone()||'').slice(-4),
  incomingAutoReplyEnabled:process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED==='true',
  standaloneGreeting:true,audioReceive:'needs-transcription-integration',audioSend:'requires-voice-rendering'};
}
let busy=false;
export async function flushPersonalNotices(deps={}){
 if(busy||process.env.PROSPECTOR_PERSONAL_NOTICES_ENABLED!=='true'||!personalPhone()||
   !one("SELECT id FROM owner_notices WHERE kind='PERSONAL_INBOUND' AND status='PENDING' LIMIT 1"))return 0;
 busy=true;
 try{
  const getStatus=deps.getStatus||waControlStatus,identity=deps.getIdentity||waIdentityStatus,send=deps.send||waRequest;
  const state=await getStatus(),me=await identity(),target=personalPhone(),session=selectedWaSession()||state.sessionId;
  if(!state.connected||!session||!me.connected||!me.numberSuffix||me.numberSuffix===target.slice(-4))return 0;
  let count=0;
  for(const n of all("SELECT * FROM owner_notices WHERE kind='PERSONAL_INBOUND' AND status='PENDING' ORDER BY created_at LIMIT 5")){
   if(!run("UPDATE owner_notices SET status='SENDING',updated_at=? WHERE id=? AND status='PENDING'",now(),n.id).changes)continue;
   try{
    const ack=await send('/api/messages/'+encodeURIComponent(session)+'/'+encodeURIComponent(target+'@s.whatsapp.net')+'/send',
      {method:'POST',data:{message:{text:n.message}}});
    if(ack.status!==true)throw Error('UNCONFIRMED');
    run("UPDATE owner_notices SET status='SENT',updated_at=? WHERE id=?",now(),n.id);
    count++;
   }catch{
    run("UPDATE owner_notices SET status='UNKNOWN',updated_at=?,error=? WHERE id=?",now(),'Confirmar entrega manualmente; não reenviar automaticamente',n.id);
   }
  }
  return count;
 }finally{busy=false;}
}
