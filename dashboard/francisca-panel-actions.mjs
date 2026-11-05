// Controlled customer-panel actions. No messages, purchases, contacts, exports,
// credential changes or access to other customer workers can be triggered here.
import {getSetting,setSetting,audit,now} from './db.mjs';
import {LOCATIONS,SEGMENTS,resolveLocation} from './osm-discovery.mjs';
import {saveScope} from './client-preferences.mjs';
import {daySP,hourSP} from './radar.mjs';

const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function tomorrowSP(input=new Date()){
 const [year,month,day]=daySP(input).split('-').map(Number);
 return new Date(Date.UTC(year,month-1,day+1)).toISOString().slice(0,10);
}
function findCity(words){
 const normalized=norm(words);
 return Object.entries(LOCATIONS).sort((a,b)=>b[0].length-a[0].length)
  .find(([key])=>normalized.includes(key))?.[1]||null;
}
function findNiche(words){
 const normalized=norm(words);
 const aliases={dentistas:'dentista',odontologia:'dentista','consultorios odontologicos':'dentista',oficinas:'oficina',mecanicas:'oficina',advogados:'advogado',restaurantes:'restaurante',academias:'academia',contadores:'contabilidade',contabeis:'contabilidade',imobiliarias:'imobiliaria',petshops:'petshop',veterinarios:'veterinario'};
 for(const [alias,id] of Object.entries(aliases))if(normalized.includes(alias))return id;
 return Object.keys(SEGMENTS).sort((a,b)=>b.length-a.length).find(key=>normalized.includes(key))||'';
}
export function interpretFranciscaAction(text,at=new Date()){
 const input=norm(text);
 if(!/(?:program|agend|configur|ativ|inici|comec|prospect|pesquis|busc|procur|encontr)/.test(input))return null;
 if(!/(?:prospect|pesquis|empresa|nicho|contato|lead)/.test(input))return null;
 const niche=findNiche(input),city=findCity(input);
 // A nationwide request is NOT the same as the finite set of cities supported by OSM.
 if(/(?:todo o pais|pais inteiro|todo o brasil|brasil inteiro|territorio nacional|nivel nacional|todas as cidades do brasil|todo pais)/.test(input))
  return {kind:'unsupported_nationwide'};
 if(/(?:todos os nichos|todos nichos|todas as cidades|todos os segmentos|todos os ramos)/.test(input)&&/amanha|proximo dia/.test(input))return {kind:'schedule_discovery',mode:city?'all-city':'all',niche:'',city:city?.label||'',startDay:tomorrowSP(at)};
 if(!niche||!city)return null; // Never invent or broaden unsupported niches/cities.
 if(/amanha|proximo dia/.test(input))return {kind:'schedule_discovery',mode:'niche-city',niche,city:city.label,startDay:tomorrowSP(at)};
 if(/(?:agora|hoje|a partir de ja|imediatamente)/.test(input))
  return {kind:'configure_discovery',mode:'niche-city',niche,city:city.label};
 return null;
}
export function applyFranciscaAction(action){
 if(action?.kind==='unsupported_nationwide')return {ok:false,action:'coverage_not_supported',
  message:'Posso preparar pesquisas nos nichos e cidades cadastrados no Prospector, mas ainda não tenho cobertura nacional. Não agendei uma pesquisa para todo o Brasil. Se quiser, podemos usar todas as cidades disponíveis.',
  uiAction:{kind:'open_prospecting',label:'Ver cidades disponíveis'}};
 if(!action||!['schedule_discovery','configure_discovery'].includes(action.kind))throw Error('Ação não autorizada');
 if(!['niche-city','all','all-city'].includes(action.mode))throw Error('Abrangência não suportada');
 if(action.mode==='niche-city'&&(!SEGMENTS[action.niche]||!resolveLocation(action.city)))throw Error('Nicho ou cidade não suportado');
 if(action.mode==='all-city'&&!resolveLocation(action.city))throw Error('Cidade não suportada');
 if(action.kind==='schedule_discovery'){
  const today=daySP(),day=action.startDay;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day<=today||day>tomorrowSP(new Date(Date.now()+7*86400000)))throw Error('Data não permitida');
  const saved={...action,status:'SCHEDULED',createdAt:now()};
  setSetting('prospecting_schedule',saved);
  audit('FRANCISCA_DISCOVERY_SCHEDULED',null,{day,niche:action.niche,city:action.city});
  return {ok:true,action:'scheduled_discovery',date:day,message:'Programei a pesquisa de '+(action.mode==='all'?'todos os nichos e cidades cadastrados':action.mode==='all-city'?'todos os nichos em '+action.city:SEGMENTS[action.niche].label.toLowerCase()+' em '+action.city)+' para amanhã, '+day+', a partir das 5h. Isso não autoriza enviar WhatsApps.'};
 }
 const result=saveScope({mode:action.mode,niche:action.niche,city:action.city,enabled:true});
 audit('FRANCISCA_DISCOVERY_ACTIVATED',null,{niche:action.niche,city:action.city});
 return {ok:true,action:'discovery_activated',message:'Configurei a pesquisa de '+SEGMENTS[action.niche].label.toLowerCase()+' em '+action.city+'. A descoberta segue as cotas e a janela das 5h. Nenhum WhatsApp foi enviado.',scope:result.selection};
}
export function processProspectingSchedule(input=new Date()){
 const scheduled=getSetting('prospecting_schedule',null);
 if(!scheduled||scheduled.status!=='SCHEDULED')return {applied:false};
 if(daySP(input)<scheduled.startDay||hourSP(input)<5)return {applied:false,pending:scheduled.startDay};
 try{
  const scope=saveScope({mode:scheduled.mode,niche:scheduled.niche,city:scheduled.city,enabled:true});
  setSetting('prospecting_schedule',{...scheduled,status:'APPLIED',appliedAt:now()});
  audit('FRANCISCA_DISCOVERY_SCHEDULE_APPLIED',null,{day:scheduled.startDay,niche:scheduled.niche,city:scheduled.city});
  return {applied:true,scope:scope.selection};
 }catch(error){
  setSetting('prospecting_schedule',{...scheduled,status:'FAILED',failedAt:now(),reason:String(error.message).slice(0,120)});
  return {applied:false,failed:true};
 }
}
export const currentProspectingSchedule=()=>getSetting('prospecting_schedule',null);
