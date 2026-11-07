// Backend-only, free CNPJ enrichment. No user-facing API, frontend fields or WhatsApp sends.
// A company's registered phone is NEVER the individual shareholder's number.
import {db,all,one,run,now,getSetting,audit} from './db.mjs';
import {braveSearch} from './discovery.mjs';
const TABLE=`CREATE TABLE IF NOT EXISTS lead_decisor_enrichment (
 lead_id TEXT PRIMARY KEY REFERENCES leads(id),
 cnpj TEXT, company_name TEXT, city TEXT, decision_maker TEXT, decision_role TEXT,
 business_phone TEXT, provider TEXT, status TEXT NOT NULL DEFAULT 'PENDING',
 tried_at TEXT, next_attempt_at TEXT, updated_at TEXT NOT NULL, error TEXT)`;
db.exec(TABLE);
db.exec('CREATE INDEX IF NOT EXISTS idx_decisor_retry ON lead_decisor_enrichment(status,next_attempt_at)');
const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
export const cnpjDigits=s=>String(s||'').replace(/\D/g,'');
export function validCnpj(input){
 const x=cnpjDigits(input);
 if(!/^\d{14}$/.test(x)||/^(\d)\1{13}$/.test(x))return false;
 const digit=(length)=>{let sum=0,weight=length-7;for(let i=0;i<length;i++){sum+=Number(x[i])*weight;weight=weight===2?9:weight-1;}const n=sum%11;return n<2?0:11-n;};
 return digit(12)===Number(x[12])&&digit(13)===Number(x[13]);
}
const SERVICE=[
 {name:'opencnpj',url:cnpj=>'https://kitana.opencnpj.com/cnpj/'+cnpj},
 {name:'minhareceita',url:cnpj=>'https://minhareceita.org/'+cnpj}
];
const flat=raw=>raw?.data&&typeof raw.data==='object'&&!Array.isArray(raw.data)?raw.data:raw;
function parseCompany(raw,cnpj,provider){
 const d=flat(raw),found=cnpjDigits(d?.cnpj);
 if(!d||found!==cnpj)return null;
 const socios=Array.isArray(d.socios)?d.socios:Array.isArray(d.qsa)?d.qsa:[];
 const priority=s=>/administrador|titular|propriet|presidente|diretor|socio.administrador/i.test(String(s.descricao||s.qualificacao_socio||s.qualificacao||s.descricao_qualificacao_socio||''));
 const match=socios.find(priority)||socios[0]||{};
 const name=String(match.nomeSocio||match.nome_socio||match.nome||'').trim().slice(0,110);
 const role=String(match.descricao||match.qualificacao_socio||match.qualificacao||match.descricao_qualificacao_socio||'').trim().slice(0,110);
 const city=String(d.municipio||d.nome_municipio||'').trim();
 return {cnpj,provider,company:String(d.razaoSocial||d.razao_social||'').trim(),fantasy:String(d.nomeFantasia||d.nome_fantasia||'').trim(),
   city,uf:String(d.uf||'').trim(),name,role,companyPhone:String(d.telefone||d.ddd_telefone_1||'').trim().slice(0,35)};
}
function matchesLead(company,lead){
 if(!company.company||!lead.business)return false;
 // A CNPJ query must match the actual business name AND municipality,
 // never trust an unverified search snippet as definitive identity.
 const candidate=clean(lead.business),names=[clean(company.company),clean(company.fantasy)].filter(Boolean);
 const exact=names.some(n=>n===candidate);
 const city=clean(lead.city),foundCity=clean(company.city);
 return exact&&!!city&&!!foundCity&&city===foundCity;
}
export function declaredCnpj(leadId){
 const origins=all('SELECT source,identity,details FROM lead_origins WHERE lead_id=? ORDER BY at DESC LIMIT 20',leadId);
 for(const origin of origins){
  let d={};try{d=JSON.parse(origin.details||'{}')}catch{}
  // Official import already binds its CNPJ to this lead. Unverified Maps name
  // matches must not be promoted to known CNPJ.
  const raw=origin.source==='cnpj'?d.reference||origin.identity.replace(/^cnpj:/,''):d.cnpj;
  if(validCnpj(raw))return cnpjDigits(raw);
 }
 return null;
}
async function candidateCnpjs(lead){
 const official=declaredCnpj(lead.id);
 if(official)return [official];
 if(process.env.BRAVE_SEARCH_API_KEY!==undefined&&process.env.BRAVE_SEARCH_API_KEY!==''){
  const query='"'+String(lead.business).replace(/["']/g,'').slice(0,85)+'" "'+String(lead.city).replace(/["']/g,'').slice(0,65)+'" CNPJ';
  const results=await braveSearch(query,5).catch(()=>[]);
  const found=new Set();
  for(const item of results){
   const snippet=String(item.title||'')+' '+String(item.description||'');
   for(const match of snippet.matchAll(/\b\d{2}[.]?\d{3}[.]?\d{3}[/]?\d{4}[-]?\d{2}\b/g))
    if(validCnpj(match[0]))found.add(cnpjDigits(match[0]));
  }
  return [...found].slice(0,3);
 }
 return [];
}
async function queryProvider(cnpj,provider,{fetchImpl=fetch}={}){
 const response=await fetchImpl(provider.url(cnpj),{headers:{Accept:'application/json'},signal:AbortSignal.timeout(8500)});
 if(response.status===404)return null;
 if(!response.ok)throw new Error('HTTP '+response.status);
 return parseCompany(await response.json(),cnpj,provider.name);
}
const busy=new Set();
export async function enrichDecisorLead(leadId,{fetchImpl=fetch}={}){
 if(busy.has(leadId))return {status:'BUSY'};
 const lead=one('SELECT id,business,city,phone,stage FROM leads WHERE id=?',leadId);
 if(!lead)return {status:'MISSING'};
 busy.add(leadId);
 try{
  const candidates=await candidateCnpjs(lead);
  let verified=null,providerFailure=false;
  for(const cnpj of candidates){
   for(const service of SERVICE){
    try{const result=await queryProvider(cnpj,service,{fetchImpl});if(result&&matchesLead(result,lead)){verified=result;break;}}
    catch{providerFailure=true;}
   }
   if(verified)break;
  }
  const status=verified?'ENRICHED':providerFailure?'RETRY':'NO_MATCH';
  const next=status==='RETRY'?new Date(Date.now()+60*60_000).toISOString():new Date(Date.now()+7*86400_000).toISOString();
  run(`INSERT INTO lead_decisor_enrichment (lead_id,cnpj,company_name,city,decision_maker,decision_role,business_phone,provider,status,tried_at,next_attempt_at,updated_at,error)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(lead_id) DO UPDATE SET cnpj=excluded.cnpj,company_name=excluded.company_name,city=excluded.city,
   decision_maker=excluded.decision_maker,decision_role=excluded.decision_role,business_phone=excluded.business_phone,
   provider=excluded.provider,status=excluded.status,tried_at=excluded.tried_at,next_attempt_at=excluded.next_attempt_at,
   updated_at=excluded.updated_at,error=excluded.error`,
   lead.id,verified?.cnpj||null,verified?.company||null,verified?.city||null,verified?.name||null,verified?.role||null,
   verified?.companyPhone||null,verified?.provider||null,status,now(),next,now(),status==='RETRY'?'PROVIDER_UNAVAILABLE':null);
  // Preserve original Maps phone and all existing send eligibility.
  // The QSA lookup identifies a name, not a verified WhatsApp belonging to them.
  audit('DECISOR_ENRICHMENT',lead.id,{status,provider:verified?.provider||null,hasSocio:!!verified?.name});
  return {status,provider:verified?.provider||null,hasSocio:!!verified?.name};
 }finally{busy.delete(leadId);}
}
let workerBusy=false;
export async function tickDecisorEnrichment({maxPerRun=3,at=new Date()}={}){
 if(process.env.PROSPECTOR_DECISOR_ENRICHMENT_ENABLED==='false')return {status:'DISABLED'};
 if(workerBusy)return {status:'BUSY'};
 if(getSetting('discovery_auto_enabled',false)!==true)return {status:'DISABLED'};
 // Run only after discovery starts (midnight São Paulo); never send messages.
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(at));
 if(hour<Number(getSetting('discovery_start_hour',0)))return {status:'BEFORE_START'};
 workerBusy=true;
 try{
  const rows=all(`SELECT l.id FROM leads l LEFT JOIN lead_decisor_enrichment e ON e.lead_id=l.id
   WHERE l.stage IN ('DISCOVERED','NO_INTEREST') AND l.city IS NOT NULL AND l.business IS NOT NULL
   AND (e.lead_id IS NULL OR e.next_attempt_at<=?) ORDER BY l.created_at DESC LIMIT ?`,
   at.toISOString(),Math.max(1,Math.min(10,Math.floor(Number(maxPerRun)||3))));
  let enriched=0;
  for(const row of rows){try{const r=await enrichDecisorLead(row.id);if(r.status==='ENRICHED')enriched++;}catch(e){console.warn('[decisor enrichment]',String(e.message||e).slice(0,100));}}
  return {status:'COMPLETE',processed:rows.length,enriched};
 }finally{workerBusy=false;}
}
