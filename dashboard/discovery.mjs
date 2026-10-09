// Descoberta multi-fonte — somente provedores realmente disponíveis são executados.
import {one,all,run,id,now,getSetting,audit,addLead} from './db.mjs';

export const providerDefinitions=[
 {id:'meta_ads',label:'Biblioteca de Anúncios',supportsSearch:false,note:'Pesquisa comercial ampla não disponibilizada por esta integração. Requer conector oficial autorizado.'},
 {id:'instagram_search',label:'Pesquisa direta no Instagram',supportsSearch:false,note:'Instagram não fornece uma busca geral irrestrita de contas comerciais nesta integração.'},
 {id:'instagram_hashtags',label:'Hashtags',supportsSearch:false,note:'Depende de permissões oficiais e contas profissionais elegíveis.'},
 {id:'instagram_related',label:'Perfis relacionados',supportsSearch:false,note:'Sem endpoint autorizado de recomendações de contas disponível.'},
 {id:'web_search',label:'Pesquisa web complementar',supportsSearch:true,note:'Pesquisa indexada via Brave, quando configurada.'}
];
export const weightsDefault={noWebsite:4,activeAd:3,publicWhatsapp:2,activeBusiness:2,prioritySegment:2,location:1,businessName:1};
export function providerStatus(){
 const key=!!process.env.BRAVE_SEARCH_API_KEY;
 const enabled=getSetting('discovery_sources',{web_search:true})||{};
 return providerDefinitions.map(p=>({...p,enabled:!!enabled[p.id],status:p.id==='web_search'?(key?'READY':'NEEDS_API_KEY'):'NOT_IMPLEMENTED',
  last_run:one('SELECT at,found,status,details FROM discoveries WHERE query LIKE ? ORDER BY at DESC LIMIT 1',p.id+':%')||null
 }));
}
export function scoreLead(lead,origins=[]){
 const w={...weightsDefault,...getSetting('score_weights',{})};
 const reasons=[];
 const add=(key,ok,reason)=>{if(ok){reasons.push({reason,points:Number(w[key])||0});return Number(w[key])||0;}return 0;};
 const ads=origins.some(o=>o.source==='meta_ads'&&o.verified===1);
 let score=0;
 score+=add('noWebsite',lead.website_status==='NO_WEBSITE','Sem site confirmado');
 score+=add('activeAd',ads,'Anúncio ativo confirmado');
 score+=add('publicWhatsapp',!!lead.phone,'WhatsApp comercial');
 score+=add('activeBusiness',!!lead.segment,'Atividade comercial informada');
 const segments=String(getSetting('segments','')).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(',').map(x=>x.trim()).filter(Boolean);
 const normalized=String(lead.segment||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 score+=add('prioritySegment',segments.some(x=>normalized.includes(x)),'Segmento prioritário');
 score+=add('location',!!lead.city,'Localização identificada');
 score+=add('businessName',!!lead.business,'Nome comercial identificado');
 return {score,reasons};
}
export function recordOrigin(leadId,source,details={},verified=false){
 if(!providerDefinitions.some(x=>x.id===source)&&!['MANUAL','LEGACY_IMPORT','WHATSAPP_INBOUND'].includes(source))throw Error('Fonte inválida');
 const identity=String(details.url||details.instagram||source).slice(0,600);
 run('INSERT INTO lead_origins(id,lead_id,source,identity,verified,details,at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(lead_id,source,identity) DO UPDATE SET at=excluded.at',
  id(),leadId,source,identity,verified?1:0,JSON.stringify(details),now());
}
export async function braveSearch(query,count=20){
 const key=process.env.BRAVE_SEARCH_API_KEY;
 if(!key)throw Error('BRAVE_SEARCH_API_KEY ausente. Configure no ambiente local.');
 const uri=new URL('https://api.search.brave.com/res/v1/web/search');
 uri.search=new URLSearchParams({q:query,count:String(Math.min(20,count)),country:'BR',search_lang:'pt'}).toString();
 const response=await fetch(uri,{headers:{'X-Subscription-Token':key,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Erro na API de busca: HTTP '+response.status);
 const data=await response.json();
 return data.web?.results||[];
}
export async function discoverProfiles(payload){
 if(getSetting('discovery_sources',{web_search:true}).web_search===false)throw Error('Pesquisa web desativada nas configurações');
 const q=String(payload.query||'').trim();
 if(q.length<3||q.length>180)throw Error('Consulta inválida');
 const result=await braveSearch('site:instagram.com/ '+q,20);
 let added=0,examined=0;
 const matches=[];
 for(const r of result){
  let url;try{url=new URL(r.url);}catch{continue;}
  if(!/(^|\.)instagram\.com$/.test(url.hostname))continue;
  const parts=url.pathname.split('/').filter(Boolean);
  if(parts.length!==1)continue;
  const username=parts[0].toLowerCase();
  if(!/^[a-z0-9_.]{2,30}$/.test(username)||['p','reel','reels','explore','stories','accounts','direct','about'].includes(username))continue;
  examined++;
  const label=String(r.title||username).split(/[|•]/)[0].trim().slice(0,110)||username;
  const lead=addLead({business:label,instagram:username,source:'web_search',website_status:'UNCERTAIN',
   notes:String(r.description||'').slice(0,500)});
  recordOrigin(lead.lead.id,'web_search',{url:r.url,query:q,title:r.title||'',snippet:String(r.description||'').slice(0,400)});
  if(lead.created)added++;
  matches.push({id:lead.lead.id,instagram:username,business:lead.lead.business,created:lead.created});
 }
 run('INSERT INTO discoveries VALUES(?,?,?,?,?,?)',id(),'web_search:'+q,added,now(),'COMPLETE',JSON.stringify({examined}));
 audit('DISCOVER_WEB',null,{query:q,examined,added});
 return {examined,added,results:matches,source:'web_search'};
}
const excludedHosts=['instagram.com','facebook.com','linktr.ee','beacons.ai','wa.me','whatsapp.com','tiktok.com','youtube.com','doctoralia.com.br','jusbrasil.com.br','google.com','maps.google.com'];
export async function verifyWebsiteCandidate(leadId){
 const lead=one('SELECT * FROM leads WHERE id=?',leadId);
 if(!lead)throw Error('Lead inexistente');
 const name=String(lead.business||'').trim();
 if(!name||name.length>120)throw Error('Nome comercial inválido');
 const q='"'+name.replace(/["']/g,'')+'" '+String(lead.city||'').replace(/[^\p{L}\s]/gu,'').slice(0,40)+' site oficial';
 const results=await braveSearch(q,10);const candidates=[];
 for(const r of results){
  let url;try{url=new URL(r.url);}catch{continue;}
  const hostname=url.hostname.toLowerCase().replace(/^www\./,'');
  if(!['https:','http:'].includes(url.protocol))continue;
  if(excludedHosts.some(host=>hostname===host||hostname.endsWith('.'+host)))continue;
  candidates.push({url:url.toString(),domain:hostname,title:String(r.title||'').slice(0,130),snippet:String(r.description||'').slice(0,300)});
 }
 audit('WEBSITE_REVIEW',leadId,{count:candidates.length});
 return {leadId,status:'NEEDS_REVIEW',candidates:candidates.slice(0,10),explanation:'Busca não comprova ausência de site; confirme manualmente antes de classificar NO_WEBSITE.'};
}
