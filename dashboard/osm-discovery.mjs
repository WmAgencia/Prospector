// Busca pública local — licença ODbL, © OpenStreetMap contributors.
// Não infere consentimento, não presume ausência de site e não envia mensagens.
// Buscas diárias graduais até a meta, respeitando as cotas da fonte comunitária.
import {one,all,run,id,now,phone,addLead,getSetting,audit} from './db.mjs';
import {recordOrigin} from './discovery.mjs';
import {upsertBusinessMeta} from './lead-catalog.mjs';
import {daySP,hourSP,radarSnapshot} from './radar.mjs';

export const LOCATIONS={
  sorocaba:{label:'Sorocaba',lat:-23.5015,lon:-47.4526,radius:9500},
  votorantim:{label:'Votorantim',lat:-23.5448,lon:-47.4388,radius:7000},
  campinas:{label:'Campinas',lat:-22.9056,lon:-47.0608,radius:10000},
  'sao paulo':{label:'São Paulo',lat:-23.5505,lon:-46.6333,radius:8500},
  itu:{label:'Itu',lat:-23.2642,lon:-47.2993,radius:7500},
  salto:{label:'Salto',lat:-23.2008,lon:-47.2866,radius:6000},
  boituva:{label:'Boituva',lat:-23.2839,lon:-47.6725,radius:6500},
  tatui:{label:'Tatuí',lat:-23.3485,lon:-47.8480,radius:7200},
  'sao roque':{label:'São Roque',lat:-23.5303,lon:-47.1366,radius:7600},
  indaiatuba:{label:'Indaiatuba',lat:-23.0901,lon:-47.2186,radius:8700},
  jundiai:{label:'Jundiaí',lat:-23.1896,lon:-46.8842,radius:9500},
  itapetininga:{label:'Itapetininga',lat:-23.5917,lon:-48.0531,radius:7600},
  piracicaba:{label:'Piracicaba',lat:-22.7253,lon:-47.6492,radius:8500},
  santos:{label:'Santos',lat:-23.9608,lon:-46.3336,radius:7800},
  barueri:{label:'Barueri',lat:-23.5118,lon:-46.8766,radius:7300},
  osasco:{label:'Osasco',lat:-23.5325,lon:-46.7917,radius:8500},
  guarulhos:{label:'Guarulhos',lat:-23.4543,lon:-46.5333,radius:8500},
  'ribeirao preto':{label:'Ribeirão Preto',lat:-21.1775,lon:-47.8103,radius:9500}
};
export const SEGMENTS={
  dentista:{label:'Dentistas',filter:'amenity',value:'dentist'},
  nutricionista:{label:'Nutricionistas',filter:'healthcare',value:'dietitian'},
  massoterapeuta:{label:'Massoterapeutas',filter:'shop',value:'massage'},
  quiropraxista:{label:'Quiropraxistas',filter:'healthcare',value:'chiropractor'},
  esteticista:{label:'Esteticistas',filter:'shop',value:'beauty'},
  personal:{label:'Personal trainers / treino',filter:'leisure',value:'fitness_centre'},
  psicologo:{label:'Psicólogos',filter:'healthcare',value:'psychotherapist'},
  clinica:{label:'Clínicas',filter:'amenity',value:'clinic'},
  estetica:{label:'Estética',filter:'shop',value:'beauty'},
  cabeleireiro:{label:'Cabeleireiros',filter:'shop',value:'hairdresser'},
  advogado:{label:'Advogados',filter:'office',value:'lawyer'},
  arquiteto:{label:'Arquitetos',filter:'office',value:'architect'},
  marceneiro:{label:'Marcenarias',filter:'craft',value:'carpenter'},
  academia:{label:'Academias',filter:'leisure',value:'fitness_centre'},
  restaurante:{label:'Restaurantes',filter:'amenity',value:'restaurant'},
  oficina:{label:'Oficinas',filter:'shop',value:'car_repair'},
  veterinario:{label:'Veterinárias',filter:'amenity',value:'veterinary'},
  petshop:{label:'Pet shops',filter:'shop',value:'pet'},
  farmacia:{label:'Farmácias',filter:'amenity',value:'pharmacy'},
  otica:{label:'Óticas',filter:'shop',value:'optician'},
  imobiliaria:{label:'Imobiliárias',filter:'office',value:'estate_agent'},
  contabilidade:{label:'Contabilidades',filter:'office',value:'accountant'},
  fisioterapia:{label:'Fisioterapia',filter:'healthcare',value:'physiotherapist'},
  lavanderia:{label:'Lavanderias',filter:'shop',value:'laundry'},
  padaria:{label:'Padarias',filter:'shop',value:'bakery'},
  confeitaria:{label:'Confeitarias',filter:'shop',value:'pastry'},
  moda:{label:'Lojas de roupas',filter:'shop',value:'clothes'},
  floricultura:{label:'Floriculturas',filter:'shop',value:'florist'},
  construcao:{label:'Materiais de construção',filter:'shop',value:'doityourself'},
  hotel:{label:'Hotéis',filter:'tourism',value:'hotel'},
  bar:{label:'Bares',filter:'amenity',value:'bar'},
  cafeteria:{label:'Cafeterias',filter:'amenity',value:'cafe'},
  idioma:{label:'Escolas de idiomas',filter:'amenity',value:'language_school'},
  joalheria:{label:'Joalherias',filter:'shop',value:'jewelry'},
  papelaria:{label:'Papelarias',filter:'shop',value:'stationery'},
  hamburgueria:{label:'Fast food',filter:'amenity',value:'fast_food'}
};
const base='https://overpass-api.de/api/interpreter';
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function resolveLocation(s){return LOCATIONS[normalize(s)]||null;}
export function resolveSegment(s){
 const v=normalize(s);if(SEGMENTS[v])return SEGMENTS[v];
 const pair=Object.entries(SEGMENTS).find(([k])=>v.includes(k));
 return pair?.[1]||null;
}
export function extractPhone(tags){
 const raw=String(tags['contact:whatsapp']||tags['contact:phone']||tags.phone||tags['phone:mobile']||'');
 const hit=raw.split(/[;|,]/).map(x=>phone(x.trim())).find(x=>x&&x.startsWith('55')&&(x.length===12||x.length===13));
 return hit||null;
}
export function extractInstagram(tags){
 const raw=String(tags['contact:instagram']||tags.instagram||'').trim();
 const match=raw.match(/(?:instagram\.com\/|^@)([a-z0-9_.]{2,30})/i);
 return match?match[1].toLowerCase():null;
}
export function makeQuery(location,segment){
 return '[out:json][timeout:24];(nwr["'+segment.filter+'"="'+segment.value+'"]["name"](around:'+location.radius+','+location.lat+','+location.lon+'););out center 70;';
}
// Prioriza registros com telefone publicado, sem inventar informações nem omitir
// empresas sem telefone. A amostra por consulta continua limitada para proteger
// o Overpass comunitário; a meta diária é contada apenas em leads únicos.
export function prioritizeOSMResults(elements=[]){
 return [...elements].sort((a,b)=>{
  const ta=a.tags||{},tb=b.tags||{};
  const pa=extractPhone(ta)?1:0,pb=extractPhone(tb)?1:0;
  if(pa!==pb)return pb-pa;
  const ia=extractInstagram(ta)?1:0,ib=extractInstagram(tb)?1:0;
  if(ia!==ib)return ib-ia;
  const wa=!!(ta['contact:website']||ta.website)?1:0,wb=!!(tb['contact:website']||tb.website)?1:0;
  return wb-wa;
 });
}
let busy=false;
export async function discoverLocal(payload={},automatic=false){
 const locationName=String(payload.city||'Sorocaba');
 const segmentName=String(payload.segment||'dentista');
 const location=resolveLocation(locationName),segment=resolveSegment(segmentName);
 if(!location||!segment)throw Error('Cidade ou segmento não atendido pela busca local. Selecione uma das opções disponíveis.');
 if(busy)throw Error('Há uma pesquisa local em andamento. Aguarde.');
 const searchKey='osm:'+normalize(location.label)+':'+segment.filter+':'+segment.value;
 const recent=one("SELECT at,status,found,details FROM discoveries WHERE query=? ORDER BY at DESC LIMIT 1",searchKey);
 const age=recent?Date.now()-Date.parse(recent.at):Infinity;
 if(recent?.status==='COMPLETE'&&age<(automatic?23*3600_000:45*60_000)){
  let details={};try{details=JSON.parse(recent.details||'{}');}catch{}
  return {source:'osm',city:location.label,segment:segment.label,added:0,examined:details.examined||0,cached:true,previouslyAdded:recent.found||0,info:'Pesquisa concluída recentemente; os resultados estão no Kanban.'};
 }
 if(recent?.status==='FAILED'&&age<15*60_000)
  throw Error('A fonte pública apresentou uma falha recente. Aguarde 15 minutos antes de repetir a consulta.');
 const today=daySP();
 const attempts=all("SELECT at FROM discoveries WHERE query LIKE 'osm:%'").filter(x=>daySP(new Date(x.at))===today).length;
 if(attempts>=OSM_DAILY_MAX_SEARCHES)throw Error('Limite diário de pesquisas públicas atingido. Tente amanhã.');
 busy=true;
 try{
  // Registre ANTES da requisição: também conta falhas e protege a API comunitária.
  const attemptId=id();run('INSERT INTO discoveries VALUES(?,?,?,?,?,?)',attemptId,searchKey,0,now(),'RUNNING',JSON.stringify({examined:0,automatic}));
  const response=await fetch(process.env.OVERPASS_ENDPOINT||base,{
   method:'POST',
   headers:{'Content-Type':'application/x-www-form-urlencoded; charset=utf-8','User-Agent':'ConsecomProspector/1.2 (business research; contact: wmagenciasuporte@gmail.com)','Accept':'application/json'},
   body:new URLSearchParams({data:makeQuery(location,segment)}),
   signal:AbortSignal.timeout(38000)
  });
  if(!response.ok)throw Error('Overpass respondeu HTTP '+response.status+(response.status===429?' (limite da API comunitária)':''));
  const raw=await response.text();
  let data;try{data=JSON.parse(raw);}catch{throw Error('A fonte pública não retornou JSON válido (HTTP '+response.status+')');}
  if(data.remark)throw Error('A API pública não concluiu a pesquisa: '+String(data.remark).slice(0,120));
  if(!Array.isArray(data.elements))throw Error('A fonte não retornou uma lista válida');
  let added=0,examined=0,withPhone=0;
  const quota=automatic?Math.max(0,Math.min(150,Number(getSetting('discovery_target_daily',150))||150)-radarSnapshot().foundToday):70;
  const candidates=prioritizeOSMResults(data.elements.slice(0,200));
  for(const item of candidates){
   if(added>=quota)break;
   const tags=item.tags||{};
   const business=String(tags.name||'').trim().slice(0,120);
   if(!business||!['node','way','relation'].includes(item.type)||!Number.isSafeInteger(item.id))continue;
   examined++;
   const url='https://www.openstreetmap.org/'+item.type+'/'+item.id;
   const existing=one("SELECT lead_id FROM lead_origins WHERE source='osm' AND identity=?",url);
   if(existing)continue;
   const p=extractPhone(tags),instagram=extractInstagram(tags);
   if(p)withPhone++;
   const website=String(tags['contact:website']||tags.website||'').trim().slice(0,500);
   let safeWebsite=null;
   try{const u=new URL(website);if(['http:','https:'].includes(u.protocol))safeWebsite=u.href;}catch{}
   const result=addLead({business,name:tags['contact:person']||null,phone:p,instagram,osm_id:url,source:'osm',segment:segment.label,city:location.label,
    website:safeWebsite,website_status:safeWebsite?'HAS_WEBSITE':'UNCERTAIN',contact_permission:false,
    notes:'Fonte: © OpenStreetMap contributors (ODbL). Cadastro público não autoriza mensagens. '+url});
   recordOrigin(result.lead.id,'osm',{url,city:location.label,segment:segment.label,phonePublished:!!p,hasWebsiteTag:!!safeWebsite});
   upsertBusinessMeta(result.lead.id,{businessType:segment.filter});
   if(result.created)added++;
  }
  run('UPDATE discoveries SET status=?,found=?,details=? WHERE id=?','COMPLETE',added,JSON.stringify({examined,withPhone,automatic,matchedTotal:data.elements.length,selectedWithPhoneFirst:true}),attemptId);
  audit('DISCOVER_OSM',null,{city:location.label,segment:segment.label,examined,added,withPhone,automatic});
  return {source:'osm',city:location.label,segment:segment.label,examined,added,withPhone,withoutWebsiteListed:Math.max(0,examined-candidates.filter(x=>Boolean(x.tags?.website||x.tags?.['contact:website'])).length),
   info:'Contatos públicos sem autorização de envio; a ausência de site no cadastro não comprova que a empresa não tem site.',
   attribution:'© OpenStreetMap contributors, ODbL',url:'https://www.openstreetmap.org/copyright'};
 }catch(error){
  run("UPDATE discoveries SET status='FAILED',details=? WHERE query=? AND status='RUNNING'",JSON.stringify({error:String(error.message).slice(0,180)}),searchKey);
  audit('DISCOVER_OSM_ERROR',null,{city:location.label,segment:segment.label,error:String(error.message).slice(0,120)});
  throw error;
 }finally{busy=false;}
}
let autoBusy=false;
export const DISCOVERY_START_HOUR=5;
export const OSM_DAILY_MAX_SEARCHES=12;
export const OSM_COOLDOWN_MS=45*60000;
export function reconcileInterruptedSearches({at=new Date(),minAgeMs=90000}={}){
 const cutoff=new Date(at.getTime()-minAgeMs).toISOString();
 const stale=all("SELECT id,query,at,details FROM discoveries WHERE query LIKE 'osm:%' AND status='RUNNING' AND at<? ORDER BY at LIMIT 100",cutoff);
 let recovered=0;
 for(const item of stale){
  let prior={};try{prior=JSON.parse(item.details||'{}');}catch{}
  const details={...prior,interrupted:true,reason:'Processo ou requisição encerrada antes de concluir',originalStartedAt:item.at};
  const result=run("UPDATE discoveries SET status='INTERRUPTED',details=? WHERE id=? AND status='RUNNING'",JSON.stringify(details),item.id);
  if(result.changes){audit('OSM_INTERRUPTED_SEARCH',null,{searchId:item.id,startedAt:item.at});recovered++;}
 }
 return {recovered,examined:stale.length};
}
export function discoveryWindow(input=new Date(),startHour=DISCOVERY_START_HOUR){
 const hour=hourSP(input),start=Number(startHour);
 return {hour,start,allowed:Number.isInteger(start)&&start>=0&&start<=23&&hour>=start};
}
// Pesquisa progressiva: somente serviços realmente configurados, respeitando limite
// da API comunitária e interrompendo-se ao atingir 150 leads únicos/dia.
export async function dailyLocalDiscovery(input=new Date()){
 if(autoBusy)return {status:'BUSY'};
 if(getSetting('discovery_auto_enabled',true)===false||getSetting('discovery_sources',{}).osm===false)return {status:'DISABLED'};
 const window=discoveryWindow(input,getSetting('discovery_start_hour',DISCOVERY_START_HOUR));
 if(!window.allowed)return {status:'BEFORE_START',startHour:window.start};
 // O horário de envio/pausa não interrompe as pesquisas de empresas.
 // Respeitamos os limites da fonte pública mesmo quando a meta não é alcançada.
 const target=Math.min(150,Math.max(1,Number(getSetting('discovery_target_daily',150))||150));
 const snapshot=radarSnapshot(input);
 if(snapshot.foundToday>=target)return {status:'TARGET_REACHED',foundToday:snapshot.foundToday,target};
 const today=daySP(input);
 const rows=all("SELECT query,at FROM discoveries WHERE query LIKE 'osm:%' ORDER BY at DESC LIMIT 100");
 const attempts=rows.filter(x=>daySP(new Date(x.at))===today);
 if(attempts.length>=OSM_DAILY_MAX_SEARCHES)return {status:'PROVIDER_LIMIT',foundToday:snapshot.foundToday,target,nextAttempt:'TOMORROW'};
 const last=Date.parse(getSetting('osm_last_auto_at','')||'')||0;
 // Espaçamento real de 45 minutos, incluindo tentativas que falharam.
 if(input.getTime()-last<OSM_COOLDOWN_MS)return {status:'COOLDOWN',foundToday:snapshot.foundToday,target,nextAt:new Date(last+OSM_COOLDOWN_MS).toISOString()};
 const cities=String(getSetting('cities','Sorocaba,Votorantim,Campinas')).split(',').map(x=>resolveLocation(x.trim())).filter(Boolean);
 const segments=String(getSetting('segments','psicólogo,nutricionista,massoterapeuta,fisioterapeuta,esteticista')).split(',').map(x=>resolveSegment(x.trim())).filter(Boolean);
 const uniqueCities=[...new Map(cities.map(x=>[x.label,x])).values()];
 const uniqueSegments=[...new Map(segments.map(x=>[x.filter+':'+x.value,x])).values()];
 if(!uniqueCities.length||!uniqueSegments.length)return {status:'NO_SUPPORTED_CITY_OR_SEGMENT'};
 const candidates=[];
 for(const city of uniqueCities)for(const segment of uniqueSegments){
  const key='osm:'+normalize(city.label)+':'+segment.filter+':'+segment.value;
  const latest=rows.find(x=>x.query===key);
  if(latest&&input.getTime()-Date.parse(latest.at)<23*3600000)continue;
  candidates.push({city,segment});
 }
 if(!candidates.length)return {status:'NO_NEW_COMBINATIONS'};
 const choice=candidates[attempts.length%candidates.length];
 autoBusy=true;
 try{
  run("INSERT INTO settings(key,value) VALUES('osm_last_auto_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(input.toISOString()));
  const segmentId=Object.keys(SEGMENTS).find(k=>SEGMENTS[k]===choice.segment);
  const result=await discoverLocal({city:choice.city.label,segment:segmentId},true);
  return {...result,target,foundToday:radarSnapshot().foundToday};
 }catch(e){
  audit('DISCOVERY_AUTO_REVIEW',null,{provider:'osm',message:String(e.message).slice(0,180)});
  return {status:'SOURCE_ERROR',error:String(e.message).slice(0,180)};
 }finally{autoBusy=false;}
}
