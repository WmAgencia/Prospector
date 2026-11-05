// Private workspace preference. Discovery does not imply authorization for outreach.
import {getSetting,setSetting} from './db.mjs';
import {LOCATIONS,SEGMENTS,resolveLocation,resolveSegment} from './osm-discovery.mjs';
export const MODES=Object.freeze(['all','niche_all_cities','niche_city']);
const DEFAULT={mode:'all',niche:'',city:''};
export function getProspectingPreferences(){return {...DEFAULT,...getSetting('prospecting_preferences',DEFAULT)};}
export function setProspectingPreferences(input={}){
 const mode=String(input.mode||'');
 if(!MODES.includes(mode))throw Error('Escolha uma das três formas de prospecção');
 let niche='',city='';
 if(mode!=='all'){
  niche=String(input.niche||'').trim().slice(0,85);
  if(!niche||!resolveSegment(niche))throw Error('Nicho não disponível na pesquisa atual. Escolha uma categoria da lista.');
 }
 if(mode==='niche_city'){
  city=String(input.city||'').trim().slice(0,85);
  if(!city||!resolveLocation(city))throw Error('Cidade não disponível na fonte atual. Escolha uma cidade da lista.');
 }
 const next={mode,niche,city};
 setSetting('prospecting_preferences',next);
 return next;
}
export function effectiveDiscoveryScope(preferences=getProspectingPreferences()){
 const cities=preferences.mode==='niche_city'?[resolveLocation(preferences.city)]:Object.values(LOCATIONS);
 const segments=preferences.mode==='all'?Object.values(SEGMENTS):[resolveSegment(preferences.niche)];
 return {cities:[...new Map(cities.filter(Boolean).map(c=>[c.label,c])).values()],
 segments:[...new Map(segments.filter(Boolean).map(s=>[s.filter+':'+s.value,s])).values()]};
}
export function availableDiscoveryOptions(){
 return {cities:Object.values(LOCATIONS).map(c=>c.label),
  segments:[...new Map(Object.values(SEGMENTS).map(s=>[s.label,s.label])).values()],
  limitation:'A pesquisa automática usa cidades e categorias suportadas pela fonte atual; não cobre literalmente todas as cidades do mundo.'};
}
