// Consulta automatica da API oficial Google Places (New) APENAS em modo IDs.
// Place IDs podem ser guardados; nomes, telefones, enderecos e sites nao sao
// copiados para a base independente do Prospector.
// A API necessita GOOGLE_PLACES_API_KEY e faturamento habilitado pelo titular.
import {db,all,one,run,id,now,getSetting,audit} from './db.mjs';
import {LOCATIONS,SEGMENTS} from './osm-discovery.mjs';
import {daySP,hourSP} from './radar.mjs';
db.exec("CREATE TABLE IF NOT EXISTS google_place_index(place_id TEXT PRIMARY KEY,city_query TEXT NOT NULL,segment_query TEXT NOT NULL,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS google_research_runs(id TEXT PRIMARY KEY,city TEXT NOT NULL,segment TEXT NOT NULL,at TEXT NOT NULL,status TEXT NOT NULL,found INTEGER NOT NULL DEFAULT 0,added INTEGER NOT NULL DEFAULT 0,requests INTEGER NOT NULL DEFAULT 0,error TEXT)");
db.exec("CREATE INDEX IF NOT EXISTS idx_google_research_runs_at ON google_research_runs(at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_google_place_city_segment ON google_place_index(city_query,segment_query)");
const MIN_GAP=30*60*1000,MAX_QUERIES=20;
let busy=false;
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const selectedCities=()=>[...new Set(String(getSetting('cities','Sorocaba,Votorantim,Campinas')).split(',').map(x=>LOCATIONS[normalize(x)]?.label).filter(Boolean))];
const selectedSegments=()=>[...new Set(String(getSetting('segments','dentista,nutricionista,psicologo')).split(',').map(x=>{
 const k=normalize(x);return SEGMENTS[k]?.label||Object.entries(SEGMENTS).find(([id])=>k.includes(id))?.[1]?.label;
}).filter(Boolean))];
export function googleIndexStatus(at=new Date()){
 const key=!!process.env.GOOGLE_PLACES_API_KEY;
 const day=daySP(at),runs=all('SELECT status,at,requests,found,added FROM google_research_runs WHERE at>=? ORDER BY at DESC LIMIT 150',new Date(at.getTime()-48*3600000).toISOString()).filter(x=>daySP(new Date(x.at))===day);
 const requests=runs.reduce((sum,x)=>sum+Number(x.requests||0),0);
 return {enabled:getSetting('google_places_auto_enabled',true)!==false&&getSetting('discovery_sources',{}).google_places!==false,keyConfigured:key,
  placeIdsIndexed:one('SELECT COUNT(*) n FROM google_place_index').n,queriesToday:runs.length,requestsToday:requests,
  dailyQueryCap:Math.max(1,Math.min(MAX_QUERIES,Number(getSetting('google_daily_queries',6))||6)),
  citiesAvailable:selectedCities().length,nichesAvailable:selectedSegments().length,
  lastRun:runs[0]||null,storedFields:['place_id','city_query','segment_query','first_seen','last_seen'],
  note:'Google Places: armazenados somente IDs e a origem da consulta. Detalhes apresentados sob demanda pela API oficial. IDs nao equivalem a contatos para CRM.'};
}
export function chooseGoogleResearch(){
 const cities=selectedCities(),segments=selectedSegments();
 if(!cities.length||!segments.length)return null;
 const prior=new Map(all('SELECT city,segment,MAX(at) last FROM google_research_runs GROUP BY city,segment').map(x=>[x.city+'|'+x.segment,Date.parse(x.last)||0]));
 const options=[];for(const city of cities)for(const segment of segments)options.push({city,segment,last:prior.get(city+'|'+segment)||0});
 options.sort((a,b)=>a.last-b.last||a.city.localeCompare(b.city)||a.segment.localeCompare(b.segment));
 return options[0];
}
export async function searchGoogleIds(city,segment,{fetcher=fetch}={}){
 if(!process.env.GOOGLE_PLACES_API_KEY)throw Error('GOOGLE_PLACES_API_KEY nao configurada');
 const query=String(segment).slice(0,80)+' em '+String(city).slice(0,80)+', Brasil';
 let pageToken='',requests=0,seen=new Set();
 for(let page=0;page<3;page++){
  const payload={textQuery:query,pageSize:20,languageCode:'pt-BR',regionCode:'BR'};
  if(pageToken)payload.pageToken=pageToken;
  const response=await fetcher('https://places.googleapis.com/v1/places:searchText',{
   method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':process.env.GOOGLE_PLACES_API_KEY,'X-Goog-FieldMask':'places.id,nextPageToken'},
   body:JSON.stringify(payload),signal:AbortSignal.timeout(18000)});
  requests++;
  if(!response.ok)throw Error('Google Places HTTP '+response.status+' (tentativa '+requests+')');
  const data=await response.json();
  if(!Array.isArray(data.places))throw Error('Google Places retornou formato inesperado');
  for(const place of data.places){if(typeof place.id==='string'&&/^[A-Za-z0-9_-]{6,180}$/.test(place.id))seen.add(place.id);}
  pageToken=typeof data.nextPageToken==='string'?data.nextPageToken:'';
  if(!pageToken)break;
 }
 return {ids:[...seen],requests};
}
export async function googleResearchTick(at=new Date(),options={}){
 if(busy)return {status:'BUSY'};
 if(getSetting('google_places_auto_enabled',true)===false||getSetting('discovery_sources',{}).google_places===false)return {status:'DISABLED'};
 if(!process.env.GOOGLE_PLACES_API_KEY)return {status:'NEEDS_API_KEY'};
 const hour=hourSP(at),start=Number(getSetting('discovery_start_hour',5));
 if(hour<start)return {status:'BEFORE_START'};
 const progress=googleIndexStatus(at);
 if(progress.queriesToday>=progress.dailyQueryCap)return {status:'DAILY_QUERY_CAP',...progress};
 const previous=one('SELECT at FROM google_research_runs ORDER BY at DESC LIMIT 1');
 if(previous&&at.getTime()-Date.parse(previous.at)<MIN_GAP)return {status:'COOLDOWN',nextAt:new Date(Date.parse(previous.at)+MIN_GAP).toISOString()};
 const next=chooseGoogleResearch();
 if(!next)return {status:'NO_SUPPORTED_CITY_OR_NICHE'};
 const runId=id();
 busy=true;
 try{
  run("INSERT INTO google_research_runs(id,city,segment,at,status) VALUES(?,?,?,?,'RUNNING')",runId,next.city,next.segment,at.toISOString());
  const result=await searchGoogleIds(next.city,next.segment,options);
  let added=0;
  for(const placeId of result.ids){
   const r=run('INSERT OR IGNORE INTO google_place_index(place_id,city_query,segment_query,first_seen,last_seen) VALUES(?,?,?,?,?)',placeId,next.city,next.segment,now(),now());
   if(r.changes)added++;
   else run('UPDATE google_place_index SET last_seen=? WHERE place_id=?',now(),placeId);
  }
  run("UPDATE google_research_runs SET status='COMPLETE',found=?,added=?,requests=? WHERE id=?",result.ids.length,added,result.requests,runId);
  audit('GOOGLE_IDS_RESEARCH',null,{city:next.city,segment:next.segment,found:result.ids.length,added,requests:result.requests});
  return {status:'COMPLETE',city:next.city,segment:next.segment,found:result.ids.length,added,requests:result.requests};
 }catch(error){
  run("UPDATE google_research_runs SET status='FAILED',error=?,requests=1 WHERE id=?",String(error.message).slice(0,150),runId);
  return {status:'SOURCE_ERROR',message:String(error.message).slice(0,150)};
 }finally{busy=false;}
}
