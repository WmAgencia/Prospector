// Catalogo B2B com paginacao e indice por cidade/nicho/tipo. Google Places
// permanece em indice separado com identificadores, nao vira registro permanente.
import {db,all,one,run,now} from './db.mjs';
db.exec("CREATE TABLE IF NOT EXISTS lead_business_meta(lead_id TEXT PRIMARY KEY REFERENCES leads(id),business_type TEXT NOT NULL DEFAULT '',cnae TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL)");
db.exec("CREATE INDEX IF NOT EXISTS idx_leads_catalog_city_segment ON leads(city,segment)");
db.exec("CREATE INDEX IF NOT EXISTS idx_leads_catalog_source_stage ON leads(source,stage)");
db.exec("CREATE INDEX IF NOT EXISTS idx_business_meta_type ON lead_business_meta(business_type)");
const quality="(CASE WHEN l.phone IS NOT NULL AND l.website_status IN ('NO_WEBSITE','NOT_FOUND_AFTER_CHECK','BROKEN_WEBSITE','SOCIAL_ONLY','LINK_AGGREGATOR_ONLY') AND COALESCE(l.segment,'')<>'' AND COALESCE(l.city,'')<>'' THEN 'A' WHEN l.phone IS NOT NULL AND COALESCE(l.business,'')<>'' THEN 'B' ELSE 'C' END)";
const qualityValue="(CASE WHEN l.phone IS NOT NULL THEN 35 ELSE 0 END + CASE WHEN COALESCE(l.segment,'')<>'' THEN 15 ELSE 0 END + CASE WHEN COALESCE(l.city,'')<>'' THEN 10 ELSE 0 END + CASE WHEN l.website_status='NO_WEBSITE' THEN 25 WHEN l.website_status IN ('NOT_FOUND_AFTER_CHECK','BROKEN_WEBSITE','SOCIAL_ONLY','LINK_AGGREGATOR_ONLY') THEN 15 WHEN l.website_status='HAS_WEBSITE' THEN 10 ELSE 0 END + CASE WHEN COALESCE(m.business_type,'')<>'' THEN 5 ELSE 0 END)";
function bounded(s,max=100){return String(s??'').trim().slice(0,max);}
export function upsertBusinessMeta(leadId,{businessType='',cnae=''}={}){
 const type=bounded(businessType,100),c=bounded(cnae,40);
 if(!type&&!c)return false;
 run("INSERT INTO lead_business_meta(lead_id,business_type,cnae,updated_at) VALUES(?,?,?,?) ON CONFLICT(lead_id) DO UPDATE SET business_type=CASE WHEN excluded.business_type<>'' THEN excluded.business_type ELSE lead_business_meta.business_type END,cnae=CASE WHEN excluded.cnae<>'' THEN excluded.cnae ELSE lead_business_meta.cnae END,updated_at=excluded.updated_at",leadId,type,c,now());
 return true;
}
const sources=new Set(['osm','cnpj','cnes','MANUAL','web_search','WHATSAPP_INBOUND','LEGACY_IMPORT']);
export function catalogQuery(filters={}){
 const limit=Math.min(200,Math.max(1,Number.isInteger(Number(filters.limit))?Number(filters.limit):60));
 const offset=Math.min(1000000,Math.max(0,Number.isInteger(Number(filters.offset))?Number(filters.offset):0));
 const conditions=[],params=[];
 const eq=(expr,value)=>{if(bounded(value)){conditions.push(expr+'=?');params.push(bounded(value));}};
 eq('l.city',filters.city);eq('l.segment',filters.segment);eq('m.business_type',filters.businessType);
 if(filters.source&&sources.has(filters.source))eq('l.source',filters.source);
 if(filters.stage&&['DISCOVERED','CONTACTED','REPLIED','INTERESTED','NO_INTEREST','CLOSED_WON'].includes(filters.stage))eq('l.stage',filters.stage);
 if(filters.website&&['UNCERTAIN','NO_WEBSITE','HAS_WEBSITE','NOT_FOUND_AFTER_CHECK','SOCIAL_ONLY','LINK_AGGREGATOR_ONLY','BROKEN_WEBSITE'].includes(filters.website))eq('l.website_status',filters.website);
 if(filters.quality&&['A','B','C'].includes(filters.quality)){conditions.push(quality+'=?');params.push(filters.quality);}
 if(bounded(filters.search,120)){conditions.push("(l.business LIKE ? OR COALESCE(l.name,'') LIKE ?)");params.push('%'+bounded(filters.search,120)+'%','%'+bounded(filters.search,120)+'%');}
 const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
 const from=' FROM leads l LEFT JOIN lead_business_meta m ON m.lead_id=l.id';
 const total=one('SELECT COUNT(*) n'+from+where,...params).n;
 const leads=all("SELECT l.id,l.business,l.name,l.phone,l.city,l.segment,l.website_status,l.source,l.stage,l.created_at,COALESCE(m.business_type,'') AS businessType,COALESCE(m.cnae,'') AS cnae,"+quality+' AS quality,'+qualityValue+' AS qualityScore'+from+where+' ORDER BY l.created_at DESC LIMIT ? OFFSET ?',...params,limit,offset);
 return {total,limit,offset,nextOffset:offset+leads.length<total?offset+leads.length:null,leads,qualityMethod:'A: telefone, cidade, segmento e oportunidade de site; B: telefone e empresa identificada; C: registro incompleto. Pontuacao heuristica, sem presumir ausencia de site.'};
}
function facet(column,max=35){
 return all('SELECT '+column+' label,COUNT(*) count FROM leads WHERE '+column+" IS NOT NULL AND TRIM("+column+")<>'' GROUP BY "+column+' ORDER BY count DESC LIMIT ?',max).map(x=>({label:x.label,count:x.count}));
}
export function catalogSummary(){
 const total=one('SELECT COUNT(*) n FROM leads').n;
 const withPhone=one('SELECT COUNT(*) n FROM leads WHERE phone IS NOT NULL').n;
 const sites=all('SELECT website_status status,COUNT(*) count FROM leads GROUP BY website_status');
 const grades=all('SELECT '+quality+' grade,COUNT(*) count FROM leads l GROUP BY '+quality);
 const types=all("SELECT business_type label,COUNT(*) count FROM lead_business_meta WHERE business_type<>'' GROUP BY business_type ORDER BY count DESC LIMIT 30");
 const sources=all('SELECT source label,COUNT(*) count FROM leads GROUP BY source ORDER BY count DESC LIMIT 20');
 return {total,withPhone,withoutPhone:total-withPhone,quality:grades,sites,cities:facet('city'),niches:facet('segment'),types,sources,pagesAvailable:true};
}
