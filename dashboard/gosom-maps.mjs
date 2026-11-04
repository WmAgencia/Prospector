// Async Gosom Google Maps integration. All provider calls remain server-side.
// Jobs are never mistaken for completed results; importing requires explicit user action.
import {db,one,all,run,id,now,addLead,audit,getSetting,setSetting} from './db.mjs';
import {daySP,hourSP} from './radar.mjs';
import {recordOrigin} from './discovery.mjs';
import {prospectingList} from './prospecting-search.mjs';
db.exec("CREATE TABLE IF NOT EXISTS maps_scraper_jobs(id TEXT PRIMARY KEY,provider_id TEXT UNIQUE NOT NULL,niche TEXT NOT NULL,city TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,imported_at TEXT,added INTEGER NOT NULL DEFAULT 0,processed INTEGER NOT NULL DEFAULT 0,error TEXT)");
if(!db.prepare('PRAGMA table_info(maps_scraper_jobs)').all().some(x=>x.name==='auto_discovery'))
 db.exec('ALTER TABLE maps_scraper_jobs ADD COLUMN auto_discovery INTEGER NOT NULL DEFAULT 0');
// Keep the private Railway worker as the preferred route when configured.
// Render remains a backward-compatible default for manually created jobs.
const DEFAULT_MAPS_BASE='https://consecom-prospector-maps.onrender.com';
function workerBase(){
 const candidate=String(process.env.PROSPECTOR_MAPS_BASE_URL||DEFAULT_MAPS_BASE).trim().replace(/\/$/,'');
 const parsed=new URL(candidate);
 const privateRailway=parsed.protocol==='http:' && parsed.hostname.endsWith('.railway.internal') && parsed.port==='10000';
 if(!(parsed.protocol==='https:'||privateRailway)||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)
  throw Error('URL privada do Maps inválida');
 return candidate;
}

const configured=()=>Boolean(process.env.PROSPECTOR_MAPS_KEY);
if(process.env.RUN_MAPS_SMOKE==='true'){
 setTimeout(async()=>{
  try{
   const response=await fetch(workerBase()+'/api/v1/jobs',{headers:{'X-Prospector-Maps-Key':process.env.PROSPECTOR_MAPS_KEY||''},signal:AbortSignal.timeout(25000)});
   let list=[];if(response.ok)list=await response.json().catch(()=>[]);
   console.info('[maps-smoke]',JSON.stringify({http:response.status,authenticated:response.ok,jobs:Array.isArray(list)?list.length:null}));
  }catch(e){console.info('[maps-smoke]',JSON.stringify({error:e?.name||'NETWORK_ERROR'}));}
 },1000).unref();
}

const valid=x=>typeof x==='string'&&x.trim().length>=2&&x.length<=85&&!/[\r\n<>]/.test(x);
function jobStatus(s){const v=String(s||'').toLowerCase();return ['ok','completed','complete','done','finished','success','succeeded'].includes(v)?'COMPLETED':['failed','error','cancelled','canceled'].includes(v)?'FAILED':['pending','queued','created'].includes(v)?'PENDING':'RUNNING';}
async function request(path,{method='GET',payload=null,expect='json'}={}){
 if(!configured())throw Error('Serviço Google Maps não configurado');
 if(!/^\/api\/v1\/jobs(?:\/[a-f0-9-]{36}(?:\/download)?)?$/.test(path))throw Error('Rota de scraper inválida');
 // Render instances may need a cold start. Bound the wait, especially for
 // queued jobs, without treating a network timeout as a failed scrape.
 let response;
 try{
  response=await fetch(workerBase()+path,{method,headers:{'X-Prospector-Maps-Key':process.env.PROSPECTOR_MAPS_KEY,Accept:expect==='json'?'application/json':'text/csv',...(payload!==null?{'Content-Type':'application/json'}:{})},body:payload!==null?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(method==='POST'?45000:60000)});
 }catch(error){
  if(error?.name==='TimeoutError'||error?.name==='AbortError')throw Error('O serviço Gosom não respondeu dentro do prazo. A tarefa foi preservada; tente consultar novamente.');
  throw Error('Não foi possível conectar ao serviço Gosom; a tarefa foi preservada.');
 }
 if(!response.ok){if(response.status===401)throw Error('Chave interna do Maps recusada');throw Error('Scraper HTTP '+response.status);}
 return response;
}
function row(idValue){return one('SELECT * FROM maps_scraper_jobs WHERE id=?',idValue);}
export function scraperStatus(){return {provider:'gosom/google-maps-scraper',configured:configured(),hosting:'Render',async:true,automaticSend:false,autoResearchEnabled:process.env.PROSPECTOR_AUTO_MAPS_DISCOVERY_ENABLED==='true',privateAPI:true,source:'Google Maps (termos aplicáveis)',jobs:all('SELECT id,niche,city,status,added,processed,created_at,updated_at,error,auto_discovery FROM maps_scraper_jobs ORDER BY created_at DESC LIMIT 10')};}

if(process.env.RUN_MAPS_CREATE_SMOKE==='true'){
 setTimeout(async()=>{
  try{
   const data=await startMapsScrape({niche:'oficinas mecânicas',city:'Sorocaba'});
   console.info('[maps-create-smoke]',JSON.stringify({status:data.status,created:!!data.id,reused:!!data.reused,error:null}));
  }catch(e){console.info('[maps-create-smoke]',JSON.stringify({error:String(e?.message||'').slice(0,180)}));}
 },3500).unref();
}

export async function startMapsScrape({niche,city}={}){
 if(!valid(niche)||!valid(city))throw Error('Informe nicho e cidade com até 85 caracteres');
 const recent=one("SELECT * FROM maps_scraper_jobs WHERE niche=? AND city=? AND status IN ('RUNNING','PENDING') ORDER BY created_at DESC LIMIT 1",niche.trim(),city.trim());
 if(recent)return {id:recent.id,status:recent.status,reused:true};
 const payload={name:'Prospector: '+niche.trim()+' / '+city.trim(),keywords:[niche.trim()+' em '+city.trim()+', Brasil'],lang:'pt',zoom:15,depth:1,max_time:240,fast_mode:false,radius:10000,email:false};
 const response=await request('/api/v1/jobs',{method:'POST',payload});
 const result=await response.json();
 if(!/^[a-f0-9-]{36}$/i.test(result.id||''))throw Error('Scraper não retornou ID de tarefa válido');
 const internal=id(),at=now();
 run("INSERT INTO maps_scraper_jobs(id,provider_id,niche,city,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",internal,result.id,niche.trim(),city.trim(),'PENDING',at,at);
 audit('MAPS_SCRAPER_STARTED',null,{jobId:internal,niche:niche.trim(),city:city.trim()});
 return {id:internal,status:'PENDING',source:'Gosom Google Maps',note:'Pesquisa iniciada. Os resultados aparecem após o processamento, que pode levar alguns minutos.'};
}

if(process.env.RUN_MAPS_POLL_SMOKE==='true'){
 setTimeout(async()=>{
  const recent=one('SELECT id FROM maps_scraper_jobs ORDER BY created_at DESC LIMIT 1');
  if(!recent)return;
  try{const state=await pollMapsScrape(recent.id);console.info('[maps-poll-smoke]',JSON.stringify({status:state.status,idPresent:!!state.id,processed:state.processed}));}
  catch(e){console.info('[maps-poll-smoke]',JSON.stringify({error:String(e?.message||'').slice(0,160)}));}
 },1500).unref();
}

export async function pollMapsScrape(jobId){
 const job=row(jobId);if(!job)throw Error('Pesquisa não encontrada');
 if(!['COMPLETED','FAILED','IMPORTED'].includes(job.status)){
  try{
   const res=await request('/api/v1/jobs/'+job.provider_id);
   // Gosom's Go web.Job JSON uses exported `Status` (capital S).
   // Accept both Go-native and API clients using lowercase `status`.
   const detail=await res.json(),status=jobStatus(detail?.status??detail?.Status);
   run("UPDATE maps_scraper_jobs SET status=?,updated_at=?,error=? WHERE id=?",status,now(),status==='FAILED'?'Execução do scraper falhou':null,jobId);
  }catch(error){
   if(String(error?.message||'')!=='Scraper HTTP 404')throw error;
   // A provider-side 404 is not an in-progress job: clear the stuck PENDING/RUNNING
   // state so the operator may explicitly create a replacement search.
   run("UPDATE maps_scraper_jobs SET status='FAILED',error=?,updated_at=? WHERE id=?","Pesquisa não encontrada no Gosom (HTTP 404). Inicie uma nova busca.",now(),jobId);
  }
 }
 const j=row(jobId);
 return {id:j.id,status:j.status,niche:j.niche,city:j.city,added:j.added,processed:j.processed,error:j.error||null,imported:j.status==='IMPORTED',source:'Gosom Google Maps',note:'Dados do Google Maps sujeitos a condições de uso; importação exige confirmação.'};
}
function csvRows(src){
 if(typeof src!=='string'||src.length>3_000_000)throw Error('CSV muito grande');
 const text=src.replace(/^\uFEFF/,'');const lines=[];let quoted=false,field='',record=[];
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
 else if(ch===','&&!quoted){record.push(field);field='';}
 else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;record.push(field);if(record.some(x=>x.trim()))lines.push(record);record=[];field='';}
 else field+=ch;
 if(lines.length>3000)throw Error('Exportação excede limite de 3000 registros');
 }
 record.push(field);if(record.some(x=>x.trim()))lines.push(record);if(quoted)throw Error('CSV malformado');
 const head=(lines.shift()||[]).map(x=>x.trim().toLowerCase());
 return lines.map(v=>Object.fromEntries(head.map((h,i)=>[h,v[i]||''])));
}
function mapUrl(x){
 const str=String(x.link||x.google_maps_url||'');try{const u=new URL(str);if(u.protocol!=='https:')return '';if(!/^(www\.)?google\.[a-z.]+$/.test(u.hostname)&&u.hostname!=='maps.app.goo.gl')return '';if(!u.pathname.startsWith('/maps')&&u.hostname!=='maps.app.goo.gl')return '';return str.slice(0,700);}catch{return '';}
}
export async function importMapsScrape(jobId){
 const job=row(jobId);if(!job)throw Error('Pesquisa não encontrada');
 if(job.status==='IMPORTED')return {ok:true,alreadyImported:true,added:job.added,processed:job.processed};
 if(job.status!=='COMPLETED')throw Error('Pesquisa ainda não concluiu');
 const response=await request('/api/v1/jobs/'+job.provider_id+'/download',{expect:'csv'});
 const csv=await response.text(),items=csvRows(csv);
 let added=0,processed=0,skipped=0;
 for(const x of items){
  const url=mapUrl(x),business=String(x.title||x.name||'').trim().slice(0,150);
  if(!business||!url){skipped++;continue;}
  const cleanCity=s=>String(s||'').split(',')[0].normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const listedCity=String(x.city||x.municipality||x.cidade||'').trim();
  if(listedCity&&cleanCity(listedCity)!==cleanCity(job.city)){skipped++;continue;}
  try{
   // Never confer WhatsApp consent solely from a Maps business listing.
   const saved=addLead({business,phone:x.phone||undefined,city:listedCity||job.city,segment:job.niche,website:String(x.website||'').slice(0,400),maps_id:url,source:'maps_extension',contact_permission:false,notes:'Origem: Gosom Google Maps. Endereço: '+String(x.address||'').slice(0,250)+' | Google Maps: '+url});
   recordOrigin(saved.lead.id,'maps_extension',{identity:url,provider:'gosom',jobId:job.id},false);
   if(saved.created)added++;processed++;
  }catch{skipped++;}
 }
 run("UPDATE maps_scraper_jobs SET status='IMPORTED',added=?,processed=?,imported_at=?,updated_at=? WHERE id=?",added,processed,now(),now(),jobId);
 audit('MAPS_SCRAPER_IMPORTED',null,{jobId,added,processed,skipped});
 return {ok:true,added,processed,skipped,source:'Gosom Google Maps',...prospectingList({niche:job.niche,city:job.city})};
}

/**
 * Refresh existing Gosom job statuses when no dashboard tab is open.
 * Read-only provider polling: importing collected companies always requires approval.
 * Bound both batch size and age so abandoned tasks do not consume an unlimited API quota.
 */
export async function refreshActiveMapsScrapes({limit=2,maxAgeHours=6}={}){
 if(!configured())return [];
 const capped=Math.max(1,Math.min(3,Math.trunc(Number(limit)||2)));
 const hours=Math.max(1,Math.min(24,Number(maxAgeHours)||6));
 const cutoff=Date.now()-hours*3600_000;
 const active=all("SELECT id,status,created_at FROM maps_scraper_jobs WHERE status IN ('PENDING','RUNNING') ORDER BY created_at DESC LIMIT ?",capped);
 const outcomes=[];
 for(const job of active){
  if(!Number.isFinite(Date.parse(job.created_at))||Date.parse(job.created_at)<cutoff)continue;
  try{
   const state=await pollMapsScrape(job.id);
   outcomes.push({id:job.id,status:state.status,changed:state.status!==job.status});
  }catch(error){
   const message=String(error?.message||error).slice(0,140);
   // A temporary outage is diagnostic, not job failure. Keep the provider ID.
   run("UPDATE maps_scraper_jobs SET error=?,updated_at=? WHERE id=? AND status IN ('PENDING','RUNNING')",message,now(),job.id);
   outcomes.push({id:job.id,error:message});
  }
 }
 return outcomes;
}


// An operator explicitly requested unattended business research, not
// unattended WhatsApp outreach. This opt-in worker only creates internal Maps
// searches and imports *its own* completed jobs into the review list.
// Manually-created jobs retain their explicit import step.
// Limit the scraper to two sequential jobs/day and a 90-minute cooldown.
export const AUTO_MAPS_MAX_JOBS_PER_DAY=2;
export const AUTO_MAPS_COOLDOWN_MS=90*60_000;
export const AUTO_MAPS_NICHES=['oficinas mecânicas','restaurantes','salões de beleza','dentistas','pet shops','contabilidade'];
let autoMapsLocked=false;
export async function automaticMapsDiscovery({at=new Date()}={}){
 if(autoMapsLocked)return {status:'BUSY'};
 if(process.env.PROSPECTOR_AUTO_MAPS_DISCOVERY_ENABLED!=='true')return {status:'DISABLED'};
 if(!configured())return {status:'NOT_CONFIGURED'};
 if(getSetting('discovery_auto_enabled',false)!==true)return {status:'DISABLED_BY_OPERATOR'};
 if(hourSP(at)<5)return {status:'BEFORE_START'};
 autoMapsLocked=true;
 try{
  // Import only explicitly auto-researched data. Do not silently import a
  // manual job whose owner has not reviewed the results.
  const complete=one("SELECT id FROM maps_scraper_jobs WHERE auto_discovery=1 AND status='COMPLETED' ORDER BY created_at ASC LIMIT 1");
  if(complete){
   const result=await importMapsScrape(complete.id);
   audit('MAPS_AUTO_DISCOVERY_IMPORTED',null,{jobId:complete.id,added:result.added,processed:result.processed});
   return {status:'IMPORTED',added:result.added,processed:result.processed};
  }
  const active=one("SELECT id,auto_discovery FROM maps_scraper_jobs WHERE status IN ('PENDING','RUNNING') ORDER BY created_at ASC LIMIT 1");
  if(active){
   if(!active.auto_discovery)return {status:'MANUAL_JOB_RUNNING'};
   const state=await pollMapsScrape(active.id);
   if(state.status==='COMPLETED'){
    const result=await importMapsScrape(active.id);
    audit('MAPS_AUTO_DISCOVERY_IMPORTED',null,{jobId:active.id,added:result.added,processed:result.processed});
    return {status:'IMPORTED',added:result.added,processed:result.processed};
   }
   return {status:state.status,error:state.error||null};
  }
  const today=daySP(at);
  const recent=all("SELECT status,created_at FROM maps_scraper_jobs WHERE auto_discovery=1 ORDER BY created_at DESC LIMIT 50");
  const daily=recent.filter(x=>Number.isFinite(Date.parse(x.created_at))&&daySP(new Date(x.created_at))===today).length;
  if(daily>=AUTO_MAPS_MAX_JOBS_PER_DAY)return {status:'DAILY_CAP',jobsToday:daily};
  const last=Date.parse(getSetting('maps_auto_last_start_at','')||'')||0;
  // A lost job after moving from Render to Railway is not a successful
  // discovery: retry within the *daily attempt cap* without waiting 90min.
  const lastFailed=recent[0]?.status==='FAILED';
  if(!lastFailed&&at.getTime()-last<AUTO_MAPS_COOLDOWN_MS)return {status:'COOLDOWN'};
  const cities=String(getSetting('cities','Sorocaba,Votorantim,Campinas')).split(',').map(x=>x.trim()).filter(x=>x.length>=2&&x.length<=85).slice(0,3);
  if(!cities.length)return {status:'NO_CITY'};
  const cursor=Math.max(0,Math.trunc(Number(getSetting('maps_auto_cursor',0))||0));
  const city=cities[Math.floor(cursor/AUTO_MAPS_NICHES.length)%cities.length];
  const niche=AUTO_MAPS_NICHES[cursor%AUTO_MAPS_NICHES.length];
  const job=await startMapsScrape({city,niche});
  if(job.reused)return {status:'PENDING',reused:true};
  run('UPDATE maps_scraper_jobs SET auto_discovery=1 WHERE id=?',job.id);
  setSetting('maps_auto_cursor',cursor+1);
  setSetting('maps_auto_last_start_at',at.toISOString());
  audit('MAPS_AUTO_DISCOVERY_STARTED',null,{jobId:job.id,city,niche,limit:AUTO_MAPS_MAX_JOBS_PER_DAY});
  return {status:'PENDING',created:true,city,niche};
 }catch(error){
  return {status:'SOURCE_ERROR',error:String(error?.message||error).slice(0,155)};
 }finally{autoMapsLocked=false;}
}
