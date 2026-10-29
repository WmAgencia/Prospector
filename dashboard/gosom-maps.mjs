// Async Gosom Google Maps integration. All provider calls remain server-side.
// Jobs are never mistaken for completed results; importing requires explicit user action.
import {db,one,all,run,id,now,addLead,audit} from './db.mjs';
import {recordOrigin} from './discovery.mjs';
import {prospectingList} from './prospecting-search.mjs';
db.exec("CREATE TABLE IF NOT EXISTS maps_scraper_jobs(id TEXT PRIMARY KEY,provider_id TEXT UNIQUE NOT NULL,niche TEXT NOT NULL,city TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,imported_at TEXT,added INTEGER NOT NULL DEFAULT 0,processed INTEGER NOT NULL DEFAULT 0,error TEXT)");
const URL_BASE='https://consecom-prospector-maps.onrender.com';
const configured=()=>Boolean(process.env.PROSPECTOR_MAPS_KEY);
if(process.env.RUN_MAPS_SMOKE==='true'){
 setTimeout(async()=>{
  try{
   const response=await fetch(URL_BASE+'/api/v1/jobs',{headers:{'X-Prospector-Maps-Key':process.env.PROSPECTOR_MAPS_KEY||''},signal:AbortSignal.timeout(25000)});
   let list=[];if(response.ok)list=await response.json().catch(()=>[]);
   console.info('[maps-smoke]',JSON.stringify({http:response.status,authenticated:response.ok,jobs:Array.isArray(list)?list.length:null}));
  }catch(e){console.info('[maps-smoke]',JSON.stringify({error:e?.name||'NETWORK_ERROR'}));}
 },1000).unref();
}

const valid=x=>typeof x==='string'&&x.trim().length>=2&&x.length<=85&&!/[\r\n<>]/.test(x);
function jobStatus(s){const v=String(s||'').toLowerCase();return ['completed','complete','done','finished'].includes(v)?'COMPLETED':['failed','error','cancelled','canceled'].includes(v)?'FAILED':['pending','queued','created'].includes(v)?'PENDING':'RUNNING';}
async function request(path,{method='GET',payload=null,expect='json'}={}){
 if(!configured())throw Error('Serviço Google Maps não configurado');
 if(!/^\/api\/v1\/jobs(?:\/[a-f0-9-]{36}(?:\/download)?)?$/.test(path))throw Error('Rota de scraper inválida');
 // Render instances may need a cold start. Bound the wait, especially for
 // queued jobs, without treating a network timeout as a failed scrape.
 let response;
 try{
  response=await fetch(URL_BASE+path,{method,headers:{'X-Prospector-Maps-Key':process.env.PROSPECTOR_MAPS_KEY,Accept:expect==='json'?'application/json':'text/csv',...(payload!==null?{'Content-Type':'application/json'}:{})},body:payload!==null?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(method==='POST'?45000:60000)});
 }catch(error){
  if(error?.name==='TimeoutError'||error?.name==='AbortError')throw Error('O serviço Gosom não respondeu dentro do prazo. A tarefa foi preservada; tente consultar novamente.');
  throw Error('Não foi possível conectar ao serviço Gosom; a tarefa foi preservada.');
 }
 if(!response.ok){if(response.status===401)throw Error('Chave interna do Maps recusada');throw Error('Scraper HTTP '+response.status);}
 return response;
}
function row(idValue){return one('SELECT * FROM maps_scraper_jobs WHERE id=?',idValue);}
export function scraperStatus(){return {provider:'gosom/google-maps-scraper',configured:configured(),hosting:'Render',async:true,automaticSend:false,privateAPI:true,source:'Google Maps (termos aplicáveis)',jobs:all('SELECT id,niche,city,status,added,processed,created_at,updated_at,error FROM maps_scraper_jobs ORDER BY created_at DESC LIMIT 10')};}

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
   const detail=await res.json(),status=jobStatus(detail.status);
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
  try{
   // Never confer WhatsApp consent solely from a Maps business listing.
   const saved=addLead({business,phone:x.phone||undefined,city:job.city,segment:job.niche,website:String(x.website||'').slice(0,400),maps_id:url,source:'maps_extension',contact_permission:false,notes:'Origem: Gosom Google Maps. Endereço: '+String(x.address||'').slice(0,250)});
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
