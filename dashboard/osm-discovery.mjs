// Busca pública local — licença ODbL, © OpenStreetMap contributors.
// Não infere consentimento, não presume ausência de site e não envia mensagens.
// Apenas 1 consulta automática ao dia; consultas manuais são limitadas e registradas.
import {one,all,run,id,now,phone,addLead,getSetting,audit} from './db.mjs';
import {recordOrigin} from './discovery.mjs';

export const LOCATIONS={
  sorocaba:{label:'Sorocaba',lat:-23.5015,lon:-47.4526,radius:9500},
  votorantim:{label:'Votorantim',lat:-23.5448,lon:-47.4388,radius:7000},
  campinas:{label:'Campinas',lat:-22.9056,lon:-47.0608,radius:10000},
  'sao paulo':{label:'São Paulo',lat:-23.5505,lon:-46.6333,radius:8500}
};
export const SEGMENTS={
  dentista:{label:'Dentistas',filter:'amenity',value:'dentist'},
  psicologo:{label:'Psicólogos',filter:'healthcare',value:'psychotherapist'},
  clinica:{label:'Clínicas',filter:'amenity',value:'clinic'},
  estetica:{label:'Estética',filter:'shop',value:'beauty'},
  cabeleireiro:{label:'Cabeleireiros',filter:'shop',value:'hairdresser'},
  advogado:{label:'Advogados',filter:'office',value:'lawyer'},
  arquiteto:{label:'Arquitetos',filter:'office',value:'architect'},
  marceneiro:{label:'Marcenarias',filter:'craft',value:'carpenter'},
  academia:{label:'Academias',filter:'leisure',value:'fitness_centre'},
  restaurante:{label:'Restaurantes',filter:'amenity',value:'restaurant'},
  oficina:{label:'Oficinas',filter:'shop',value:'car_repair'}
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
let busy=false;
export async function discoverLocal(payload={},automatic=false){
 const locationName=String(payload.city||'Sorocaba');
 const segmentName=String(payload.segment||'dentista');
 const location=resolveLocation(locationName),segment=resolveSegment(segmentName);
 if(!location||!segment)throw Error('Cidade ou segmento não atendido pela busca local. Selecione uma das opções disponíveis.');
 if(busy)throw Error('Há uma pesquisa local em andamento. Aguarde.');
 const searchKey='osm:'+normalize(location.label)+':'+segment.filter+':'+segment.value;
 const recent=one("SELECT at FROM discoveries WHERE query=? ORDER BY at DESC LIMIT 1",searchKey);
 if(recent&&Date.now()-Date.parse(recent.at)<(automatic?23*3600_000:45*60_000))
  return {source:'osm',city:location.label,segment:segment.label,added:0,examined:0,cached:true,info:'Pesquisa já realizada recentemente. Aguarde para não sobrecarregar o OpenStreetMap.'};
 const today=new Date().toISOString().slice(0,10);
 const attempts=all("SELECT at FROM discoveries WHERE query LIKE 'osm:%'").filter(x=>String(x.at||'').startsWith(today)).length;
 if(attempts>=8)throw Error('Limite diário de pesquisas públicas atingido. Tente amanhã.');
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
  const data=await response.json();
  if(data.remark)throw Error('A API pública não concluiu a pesquisa: '+String(data.remark).slice(0,120));
  if(!Array.isArray(data.elements))throw Error('A fonte não retornou uma lista válida');
  let added=0,examined=0,withPhone=0,withoutSiteClaimed=0;
  for(const item of data.elements.slice(0,70)){
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
   const result=addLead({business,phone:p,instagram,osm_id:url,source:'osm',segment:segment.label,city:location.label,
    website:safeWebsite,website_status:safeWebsite?'HAS_WEBSITE':'UNCERTAIN',contact_permission:false,
    notes:'Fonte: © OpenStreetMap contributors (ODbL). Cadastro público não autoriza mensagens. '+url});
   recordOrigin(result.lead.id,'osm',{url,city:location.label,segment:segment.label,phonePublished:!!p,hasWebsiteTag:!!safeWebsite});
   if(result.created)added++;
  }
  run('UPDATE discoveries SET status=?,found=?,details=? WHERE id=?','COMPLETE',added,JSON.stringify({examined,withPhone,automatic}),attemptId);
  audit('DISCOVER_OSM',null,{city:location.label,segment:segment.label,examined,added,withPhone,automatic});
  return {source:'osm',city:location.label,segment:segment.label,examined,added,withPhone,
   info:'Contatos públicos sem autorização de envio; a ausência de site no cadastro não comprova que a empresa não tem site.',
   attribution:'© OpenStreetMap contributors, ODbL',url:'https://www.openstreetmap.org/copyright'};
 }catch(error){
  run("UPDATE discoveries SET status='FAILED',details=? WHERE query=? AND status='RUNNING'",JSON.stringify({error:String(error.message).slice(0,180)}),searchKey);
  audit('DISCOVER_OSM_ERROR',null,{city:location.label,segment:segment.label,error:String(error.message).slice(0,120)});
  throw error;
 }finally{busy=false;}
}
let autoBusy=false;
export async function dailyLocalDiscovery(){
 if(autoBusy||getSetting('discovery_auto_enabled',true)===false||getSetting('discovery_sources',{}).osm===false)return null;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const last=getSetting('osm_last_auto_day','');
 if(last===today)return null;
 // 1 search per São Paulo day; no API-key, no aggressive collection.
 const candidatesCity=String(getSetting('cities','Sorocaba')).split(',').map(x=>resolveLocation(x.trim())).filter(Boolean);
 const candidatesSegment=String(getSetting('segments','dentista')).split(',').map(x=>resolveSegment(x.trim())).filter(Boolean);
 const cities=candidatesCity.length?candidatesCity:[LOCATIONS.sorocaba];
 const segments=candidatesSegment.length?candidatesSegment:[SEGMENTS.dentista];
 const epoch=Math.floor(Date.parse(today+'T12:00:00Z')/86400000);
 const city=cities[epoch%cities.length],segment=segments[(Math.floor(epoch/cities.length))%segments.length];
 autoBusy=true;
 try{
  const out=await discoverLocal({city:city.label,segment:Object.keys(SEGMENTS).find(k=>SEGMENTS[k]===segment)},true);
  if(out?.cached||out?.source==='osm')run("INSERT INTO settings(key,value) VALUES('osm_last_auto_day',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(today));
  return out;
 }catch(error){
  // Não repita agressivamente em caso de erro de serviço comunitário.
  run("INSERT INTO settings(key,value) VALUES('osm_last_auto_day',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(today));
  return {error:error.message};
 }finally{autoBusy=false;}
}
