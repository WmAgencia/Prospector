import {one,all,audit} from './db.mjs';
import {move} from './production.mjs';
const catalog='https://raw.githubusercontent.com/WmAgencia/Prospector/main/studio/projects.json';
let busy=false;
export async function syncPublishedSamples(){
 if(busy)return {checked:0,ready:0,reason:'busy'};
 if(process.env.STUDIO_SYNC_ENABLED!=='1')return {checked:0,ready:0,reason:'disabled'};
 busy=true;
 try{
  const requests=all("SELECT id,lead_id FROM production_requests WHERE status='IN_PROGRESS'");
  if(!requests.length)return {checked:0,ready:0};
  const response=await fetch(catalog,{signal:AbortSignal.timeout(9000),headers:{'Cache-Control':'no-cache'}});
  if(!response.ok)throw Error('Catálogo HTTP '+response.status);
  const data=await response.json();if(!Array.isArray(data.projects))throw Error('Catálogo inválido');
  let ready=0;
  for(const request of requests){
   const entry=data.projects.find(p=>p.production_ref===request.id&&typeof p.slug==='string'&&/^[a-z0-9-]{2,80}$/.test(p.slug));
   if(!entry)continue;
   const check=await fetch('https://raw.githubusercontent.com/WmAgencia/Prospector/main/studio/sites/'+entry.slug+'.html',{method:'HEAD',signal:AbortSignal.timeout(7000)});
   if(!check.ok)continue;
   if(one('SELECT status FROM production_requests WHERE id=?',request.id)?.status!=='IN_PROGRESS')continue;
   move(request.lead_id,'READY','https://prospector-ui-production.up.railway.app/studio/sites/'+entry.slug+'.html');
   audit('SITE_PUBLISHED',request.lead_id,{slug:entry.slug});ready++;
  }
  return {checked:requests.length,ready};
 }finally{busy=false;}
}
