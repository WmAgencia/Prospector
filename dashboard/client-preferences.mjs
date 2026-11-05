import {getSetting,setSetting,audit,now} from './db.mjs';
import {LOCATIONS,SEGMENTS,resolveLocation,resolveSegment} from './osm-discovery.mjs';

const allCities=[...new Set(Object.values(LOCATIONS).map(x=>x.label))];
const allSegments=Object.keys(SEGMENTS);
const selectedCity=input=>{
 const text=String(input||'').trim();
 const match=text.match(/^(.+?)\s*(?:\/|,|\s-\s)\s*([a-zA-Z]{2})$/);
 if(match&&match[2].toUpperCase()!=='SP')return null;
 return resolveLocation(match?match[1].trim():text);
};
export const scopeOptions=()=>({cities:allCities,segments:allSegments.map(id=>({id,label:SEGMENTS[id].label})),coverage:'Apenas os nichos e cidades suportados pela fonte OSM configurada. Nenhuma busca garante cobertura nacional.'});
export function currentScope(){return {...getSetting('prospecting_scope_preference',{mode:'all',niche:'',city:'',updatedAt:null}),enabled:getSetting('discovery_auto_enabled',false)===true};}
export function saveScope(input={}){
 const mode=String(input.mode||'');
 if(!['all','niche-all','niche-city','all-city'].includes(mode))throw Error('Escolha a abrangência da pesquisa');
 const city=mode.endsWith('-city')?selectedCity(input.city):null;
 const niche=mode.startsWith('niche-')?resolveSegment(input.niche):null;
 if(mode.endsWith('-city')&&!city)throw Error('Selecione uma cidade disponível na lista');
 if(mode.startsWith('niche-')&&!niche)throw Error('Selecione um nicho disponível na lista');
 const segmentKey=niche?Object.keys(SEGMENTS).find(key=>SEGMENTS[key].filter===niche.filter&&SEGMENTS[key].value===niche.value):'';
 const selectedSegments=segmentKey?[segmentKey]:allSegments;
 const selectedCities=city?[city.label]:allCities;
 // Bound the worker to supported data; arbitrary city names must not silently
 // trigger a different city or appear as a completed search.
 setSetting('segments',selectedSegments.join(','));
 setSetting('cities',selectedCities.join(','));
 setSetting('discovery_brazil_wide',false);
 const enabled=input.enabled===true||input.enabled==='on';
 setSetting('discovery_auto_enabled',enabled);
 const selected={mode,niche:segmentKey,city:city?.label||'',enabled,updatedAt:now(),citiesCovered:selectedCities.length,nichesCovered:selectedSegments.length};
 setSetting('prospecting_scope_preference',selected);
 audit('PROSPECTING_SCOPE_CHANGED',null,{mode,niche:segmentKey||null,city:city?.label||null});
 return {selection:selected,options:scopeOptions()};
}
export const DEFAULT_OUTREACH_HOURS=Object.freeze({start:'08:00',end:'17:30'});
const parse=x=>{const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(x||''));return m?Number(m[1])*60+Number(m[2]):NaN;};
export function getOutreachHours(){return getSetting('client_outreach_hours',DEFAULT_OUTREACH_HOURS);}
export function saveOutreachHours({start,end}={}){
 const a=parse(start),b=parse(end);
 if(!Number.isInteger(a)||!Number.isInteger(b)||a<8*60||b>17*60+30||b<=a)throw Error('Escolha horários entre 08:00 e 17:30, com o início anterior ao término.');
 const value={start,end};
 setSetting('client_outreach_hours',value);
 audit('CLIENT_OUTREACH_HOURS_CHANGED',null,{start,end});
 return value;
}
export function approachWindowMinutes(){
 const v=getOutreachHours(),a=parse(v.start),b=parse(v.end);
 return Number.isInteger(a)&&Number.isInteger(b)&&a>=480&&b<=1050&&a<b?{start:a,end:b}:{start:480,end:1050};
}
