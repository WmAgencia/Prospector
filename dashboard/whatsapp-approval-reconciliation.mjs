// Read-only WhatsApp search + evidence-based approval reconciliation.
// Messages are never sent, altered, or represented as consent unless an
// outgoing permission question and a later explicit inbound yes both exist.
// A recorded opt-out or a later refusal always wins.
import {all,one} from './db.mjs';
import {waRequest,waSessionList} from './waakg-control.mjs';
import {approveLeadBatch} from './lead-approvals.mjs';
import {isExplicitOptOut,salesEnding} from './sales-policy.mjs';
import {validIndividualConsent} from './verified-consent.mjs';

const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim();
const D14=14*24*60*60*1000;
const D366=366*24*60*60*1000;

export function isPermissionRequest(text){
 const s=norm(text);
 if(s.length<12||s.length>1800)return false;
 const proposal=/\b(?:proposta|oferta|orcamento|site|servico|abordagem|contato comercial|apresentacao|apresentar (?:a |uma )?ideia|mensagem comercial)\b/.test(s);
 const ask=/\b(?:posso|podemos|poderia|autoriza|autorizam|permite|permitem|tudo bem se|voce aceita|voces aceitam|gostaria de saber se|podemos entrar em contato|tem interesse em receber)\b/.test(s);
 const send=/\b(?:enviar|mandar|receber|apresentar|fazer|compartilhar|explicar|contar|mostrar|conversar|contato|abordar|detalhes)\b/.test(s);
 return proposal&&ask&&send&&!/\b(?:nao quero|nao autorizo|remova meu numero)\b/.test(s);
}
export function explicitConsentReply(text){
 const s=norm(text).replace(/^[\s,!.?]+|[\s,!.?]+$/g,'');
 if(!s||s.length>220||isExplicitOptOut(text)||salesEnding(text)==='NO_INTEREST')return false;
 if(/\b(?:nao|nunca|jamais|sem interesse|nao quero|talvez|depois|nao agora|agora nao|por enquanto nao)\b/.test(s))
  return false;
 // This is a direct reply after a real permission question, not permission
 // inferred from general interest or replies to a cold sales pitch.
 return /^(?:sim|ss|s|claro|autorizo|autorizamos|permito|aceito|pode sim|pode mandar|pode enviar|pode falar|pode ser|pode|ok|okay|beleza|blz|tranquilo|com certeza|ta bom|tudo bem|manda|pode apresentar)(?:\b|[,!.? ]|$)/.test(s);
}
function dt(v){
 const n=typeof v==='number'?(v<1e11?v*1000:v):Date.parse(String(v||''));
 return Number.isFinite(n)?n:NaN;
}
export function findDocumentedWhatsappConsent(messages,{now=Date.now()}={}){
 if(!Array.isArray(messages))return null;
 const items=messages.map(m=>({...m,at:dt(m?.timestamp||m?.messageTimestamp||m?.createdAt)}))
  .filter(m=>Number.isFinite(m.at)&&m.at<=now+300000&&m.at>=now-D366)
  .sort((a,b)=>a.at-b.at);
 let request=null,result=null;
 for(const m of items){
  const body=String(m.content||m.text||'').trim();
  if(m.fromMe===true){
   if(isPermissionRequest(body))request=m;
   continue;
  }
  if(isExplicitOptOut(body)||salesEnding(body)==='NO_INTEREST'){
   result=null;request=null;continue;
  }
  if(!request||m.at<=request.at||m.at-request.at>D14)continue;
  if(explicitConsentReply(body)){
   const key=String(m.keyId||m.id||'').trim();
   if(!key)continue; // cannot document a real provider message without identity
   result={consentAt:new Date(m.at).toISOString(),
    evidence:body.slice(0,1000),evidenceReference:'WA-AKG mensagem '+key.slice(0,180),
    sourceMessageId:key,requestMessageId:String(request.keyId||request.id||'').slice(0,190)};
   request=null;
  }
 }
 return result;
}
const validCursor=s=>s===''||/^[0-9a-f-]{36}$/i.test(s);
function pendingRows(cursor,limit){
 return all("SELECT l.id,l.phone,l.business FROM leads l WHERE l.phone IS NOT NULL AND l.id>?"+
  " AND l.source<>'WA_PAIR_QA' AND l.contact_permission=1"+
  " AND NOT EXISTS(SELECT 1 FROM suppressions s WHERE s.phone=l.phone)"+
  " AND NOT EXISTS(SELECT 1 FROM contact_relationships cr WHERE cr.phone=l.phone AND cr.kind='EXISTING_CLIENT')"+
  " AND EXISTS(SELECT 1 FROM audit a WHERE a.lead_id=l.id AND a.action='CONSENT_UPDATED'"+
  " AND a.rowid=(SELECT MAX(z.rowid) FROM audit z WHERE z.lead_id=l.id AND z.action='CONSENT_UPDATED')"+
  " AND json_extract(a.detail,'$.method')='manual_quick_approval')"+
  " ORDER BY l.id ASC LIMIT ?",cursor,limit);
}
export async function reconcileWhatsappApprovals({cursor='',limit=15,apply=true}={},deps={}){
 if(process.env.PROSPECTOR_TENANT_ID)throw Error('Sincronização disponível somente na conta principal');
 if(!validCursor(cursor))throw Error('Cursor inválido');
 const size=Number(limit);
 if(!Number.isInteger(size)||size<1||size>25)throw Error('Lote precisa ter de 1 a 25 contatos');
 const sessions=await (deps.sessions||waSessionList)();
 const eligible=Array.isArray(sessions.items)?sessions.items.filter(s=>s.connected&&s.numberSuffix==='2994'):[];
 if(eligible.length!==1||!/^55\d{10,11}$/.test(String(eligible[0].number||'')))
  return {status:'SOURCE_UNAVAILABLE',reason:'O WhatsApp 2994 não está conectado ou não tem número confirmado',scanned:0,approved:0,nextCursor:cursor,hasMore:false};
 const session=eligible[0],leads=pendingRows(cursor,size);
 let approved=0,notFound=0,invalid=0,errors=0;
 const provider=deps.request||waRequest,update=deps.approve||approveLeadBatch;
 for(const lead of leads){
  const phone=String(lead.phone||'').replace(/\D/g,'');
  if(!/^55\d{10,11}$/.test(phone)){invalid++;continue;}
  let payload;
  try{
   payload=await provider('/api/messages/'+encodeURIComponent(session.sessionId)+
    '/search?jid='+encodeURIComponent(phone+'@s.whatsapp.net')+'&limit=100&page=1');
  }catch{errors++;continue;}
  if(!Array.isArray(payload.data)){errors++;continue;}
  const proof=findDocumentedWhatsappConsent(payload.data);
  if(!proof){notFound++;continue;}
  const evidence={
   leadId:lead.id,operatorPhone:session.number,channel:'PERSONAL_WHATSAPP',
   consentAt:proof.consentAt,evidence:proof.evidence,
   evidenceReference:proof.evidenceReference
  };
  if(!validIndividualConsent({...evidence,sourcePhone:session.number,permitted:true,method:'manual_batch_curation'})){
   invalid++;continue;
  }
  if(apply){
   try{update({confirmedByOperator:true,items:[evidence]});}
   catch{errors++;continue;}
  }
  approved++;
 }
 const nextCursor=leads.at(-1)?.id||cursor;
 const more=leads.length===size;
 return {status:'SCANNED',sessionSuffix:'2994',scanned:leads.length,approved,
  notFound,invalid,gatewayErrors:errors,nextCursor,hasMore:more,
  applied:apply===true,realMessagesSent:0,permissionSource:'WA-AKG original chat messages'};
}
