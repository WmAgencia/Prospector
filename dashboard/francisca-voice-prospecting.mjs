// Verified-owner, per-call prospecting: search a niche/city, preview ALL saved
// results, and queue only leads with documented opt-in after verbal approval.
// The existing queue worker owns pacing, consent, campaign and no-retry safety.
import {classifyContact,verifiedOwnerPhone} from './whatsapp-roles.mjs';
import {prospectingSearch,prospectingList} from './prospecting-search.mjs';
import {prepareApproaches} from './prospecting-approach.mjs';
import {enqueueApprovedApproaches,approachQueueStatus} from './prospecting-queue.mjs';
import {audit} from './db.mjs';

const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const startRequest=/\b(?:inici\w*|comec\w*|ativ\w*|coloc\w*|execut\w*|dispar\w*|abord\w*)\b/;
const searchRequest=/\b(?:pesquis\w*|busc\w*|procur\w*|encontr\w*|levant\w*|localiz\w*)\b/;
const cancel=/^(?:nao|não|cancela|cancelar|deixa pra la|deixa para la|desiste|esquece|nao inicia|não inicia)[.!?\s]*$/i;
const approval=/^(?:sim[,.!\s]*(?:pode\s+)?(?:iniciar|começar|comecar|ativar|prosseguir|inicia|começa|comeca)|pode\s+(?:iniciar|comecar|começar|selecionar\s+todos\s+e\s+iniciar)|inicia(?:\s+a\s+abordagem)?|iniciar(?:\s+a\s+abordagem)?|comec(?:a|ar)(?:\s+a\s+abordagem)?|autorizo(?:\s+a\s+abordagem)?|confirmo(?:\s+a\s+abordagem)?|pode\s+prosseguir)[.!?\s]*$/i;
const cityTail=/\s+(?:e\s+)?(?:pode\s+|depois\s+|agora\s+)?(?:selecion\w*|inici\w*|comec\w*|abord\w*|coloc\w*|ativ\w*|envi\w*|mand\w*|mostr\w*|me\s+fal\w*|por\s+favor)\b[\s\S]*$/;
const safeTerm=x=>String(x||'').trim().replace(/^[\s.,:;]+|[\s.,:;]+$/g,'').slice(0,85);
function verified(actor){
 const v=classifyContact(actor||{});
 return v.role==='OWNER'&&v.authorized===true&&v.ownerTools===true&&
  actor?.jid===verifiedOwnerPhone()+'@s.whatsapp.net';
}
export function parseVoiceProspecting(text){
 const raw=norm(text).replace(/\s+/g,' ');
 const wantsSearch=searchRequest.test(raw);
 const wantsStart=startRequest.test(raw)&&/(abord\w*|prospect\w*|fila|selecion\w*)/.test(raw);
 if(!wantsSearch)return {wantsSearch:false,wantsStart};
 // "pesquisa pra mim dentistas na cidade de Sorocaba e pode selecionar todos e iniciar a abordagem"
 const after=raw.replace(/^.*?\b(?:pesquis\w*|busc\w*|procur\w*|encontr\w*|levant\w*|localiz\w*)\b\s*/,'')
  .replace(/^(?:(?:para|pra)\s+mim\s+|(?:uns|umas|os|as|todos|todas)\s+)+/,'');
 const parts=after.match(/^(.+?)\s+(?:na\s+cidade\s+de|no\s+municipio\s+de|em\s+|na\s+|no\s+)\s+(.+)$/);
 if(!parts)return {wantsSearch:true,wantsStart,niche:null,city:null};
 const niche=safeTerm(parts[1].replace(/\s+(?:para|pra)\s+mim$/,''));
 const city=safeTerm(parts[2].replace(cityTail,''));
 if(!/^[\p{L}\s'-]{2,85}$/u.test(niche)||!/^[\p{L}\s'-]{2,85}$/u.test(city))
  return {wantsSearch:true,wantsStart,niche:null,city:null};
 return {wantsSearch:true,wantsStart,niche,city};
}
export function newVoiceProspectingFlow(deps={}){
 const search=deps.search||prospectingSearch;
 const list=deps.list||prospectingList;
 const preview=deps.preview||prepareApproaches;
 const enqueue=deps.enqueue||enqueueApprovedApproaches;
 const status=deps.status||approachQueueStatus;
 let pending=null;
 const ttl=()=>Date.now()+3*60_000;
 async function doSearch(niche,city,requestStart){
  // Source may time out, in which case the assistant transparently reports
  // the failure and still shows previously saved leads, not invented finds.
  let provider='OpenStreetMap',found=0,partial=true,cached=false,failed='';
  try{
   const s=await search({niche,city});
   provider=String(s.source||provider);found=Number(s.added)||0;
   partial=s.partial!==false;cached=!!s.cached;
  }catch(e){failed=String(e.message||e).slice(0,105);}
  const inventory=list({niche,city,status:'all',limit:6000});
  const total=Number(inventory.total)||0;
  const allRows=Array.isArray(inventory.results)?inventory.results:[];
  const selectable=allRows.filter(x=>x?.selectable===true&&x.phone&&x.id);
  // The queue API has an explicit 100-target per-batch hard limit. Do not
  // silently pick an arbitrary subset when user asked for "all".
  const oversized=selectable.length>100;
  const candidateIds=oversized?[]:selectable.map(x=>x.id);
  const evidence=candidateIds.length?preview({leadIds:candidateIds}):null;
  const authorized=evidence?.items?.filter(x=>x.authorized===true).map(x=>x.id)||[];
  const needsPermission=selectable.length-authorized.length;
  pending=authorized.length>0&&!oversized?{niche,city,ids:authorized,expires:ttl(),total,eligible:authorized.length}:null;
  audit('FRANCISCA_VOICE_PROSPECT_SEARCH',null,{niche,city,newLeads:found,savedTotal:total,authorized:authorized.length,sourceFailed:!!failed});
  const lead='Pesquisa de '+niche+' em '+city+': '+total+' empresas cadastradas'+
   (found?' e '+found+' novas encontradas':'')+'.';
  const suffix=failed?' A busca externa falhou: '+failed+'. Usei apenas os contatos já salvos.':
   cached?' A fonte retornou dados de pesquisa recente.':
   partial?' A fonte tem cobertura parcial.':'';
  if(!requestStart)return lead+suffix+
   ' Destas, '+authorized.length+' têm autorização documentada para abordagem. '+
   (authorized.length?'Posso iniciar a fila dos contatos autorizados? Diga pode iniciar.':'Não iniciei mensagens sem permissão documentada.');
  if(oversized)return lead+suffix+' Há mais de cem contatos selecionáveis; preciso dividir em lotes. Nenhuma abordagem foi iniciada.';
  if(!authorized.length)return lead+suffix+
   ' Nenhuma das '+selectable.length+' empresas selecionáveis tem consentimento de abordagem documentado. Salvei os contatos, mas não iniciei mensagens.';
  return lead+suffix+' '+authorized.length+' contatos têm permissão documentada, e '+
   needsPermission+' não têm autorização válida. Posso criar a fila somente para os '+authorized.length+
   ' autorizados? Diga "pode iniciar" para confirmar.';
 }
 return {
  async turn(text,actor){
   if(!verified(actor)){pending=null;return null;}
   if(pending&&Date.now()>pending.expires)pending=null;
   const heard=String(text||'').trim(),parsed=parseVoiceProspecting(heard);
   if(pending){
    if(cancel.test(heard)){pending=null;return 'Certo, cancelei a preparação da fila. Nenhuma abordagem nova foi iniciada.';}
    if(parsed.wantsSearch){pending=null; /* Start a new niche/city search below. */}
    else if(approval.test(norm(heard))){
     const selected=pending;pending=null; // consume first; never retry uncertain enqueue
     if(!verified(actor))return 'Não consegui validar o proprietário. Nenhuma abordagem iniciada.';
     if(status().active)return 'Já existe uma fila de abordagem ativa. Não iniciei outra.';
     try{
      const result=enqueue({leadIds:selected.ids,approve:true});
      if(result.status!==202)return 'Não consegui criar a fila: '+String(result.body?.error||'a operação foi recusada').slice(0,155)+'.';
      const queued=Number(result.body?.queued)||0;
      audit('FRANCISCA_VOICE_PROSPECT_QUEUE_CONFIRMED',null,{niche:selected.niche,city:selected.city,queued,excluded:result.body?.excluded||0});
      return 'Fila criada para '+queued+' contatos autorizados de '+selected.niche+' em '+selected.city+
       '. O Prospector fará as tentativas no ritmo de pelo menos noventa segundos, sujeito à conexão e às regras da campanha. Nenhuma mensagem foi enviada por esta resposta.';
     }catch(e){return 'Não foi possível criar a fila: '+String(e.message||e).slice(0,150)+'.';}
    }else return 'A lista de '+pending.niche+' em '+pending.city+' está pronta com '+
     pending.eligible+' contatos autorizados. Diga "pode iniciar" ou "cancela".';
   }
   if(!parsed.wantsSearch)return null;
   if(!parsed.niche||!parsed.city)return 'Qual é o nicho e a cidade que você quer pesquisar? Por exemplo, dentistas em Sorocaba.';
   return doSearch(parsed.niche,parsed.city,parsed.wantsStart);
  },
  end(){pending=null;},
  get state(){return pending?{niche:pending.niche,city:pending.city,eligible:pending.eligible}:null;}
 };
}
