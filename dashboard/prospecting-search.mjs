// Operator-initiated OpenStreetMap discovery. Best effort; never claims exhaustive coverage.
import {one,all,run,id,now,addLead,phone} from "./db.mjs";
import {recordOrigin} from "./discovery.mjs";
import {resolveLocation} from "./osm-discovery.mjs";
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const map=[
 [/oficina|mecanica|automotiva|auto center|auto.?eletric/,["shop","car_repair"]],
 [/dentista|odontolog/,["amenity","dentist"]],
 [/advogad|juridic/,["office","lawyer"]],
 [/contabil|contador|contabilidade/,["office","accountant"]],
 [/psicolog|psicoterapia/,["healthcare","psychotherapist"]],
 [/nutricion/,["healthcare","dietitian"]],
 [/academia|musculacao|ginastica/,["leisure","fitness_centre"]],
 [/restauran|alimentacao/,["amenity","restaurant"]],
 [/padaria|panific/,["shop","bakery"]],
 [/veterinari/,["amenity","veterinary"]],
 [/pet.?shop/,["shop","pet"]],
 [/estetica|beleza/,["shop","beauty"]],
 [/barbearia|barbeiro/,["shop","hairdresser"]],
 [/farmacia|drogaria/,["amenity","pharmacy"]],
 [/imobiliari|corretor de imov/,["office","estate_agent"]],
 [/arquiteto|arquitetura/,["office","architect"]],
 [/lavanderia/,["shop","laundry"]],
 [/eletricista/,["craft","electrician"]],
 [/encanador|hidraulica/,["craft","plumber"]],
 [/marcenar|carpint/,["craft","carpenter"]],
 [/floricultura|florist/,["shop","florist"]],
 [/loja de roupa|vestuario/,["shop","clothes"]],
 [/hotel|hospedagem/,["tourism","hotel"]],
 [/escola|colegio/,["amenity","school"]],
 [/tatuador|tatuagem/,["shop","tattoo"]],
 [/construtor|construcao/,["craft","builder"]]
];
function instagramFrom(tags){
 const raw=String(tags?.["contact:instagram"]||tags?.instagram||"").trim();
 const m=raw.match(/(?:instagram\.com\/|^@?)([a-z0-9._]{2,30})(?:\/?(?:\?.*)?)?$/i);
 return m?m[1].toLowerCase():null;
}
function phoneFrom(tags){for(const key of ["contact:whatsapp","contact:phone","phone"]){const hits=String(tags?.[key]||"").split(/[;,]/);for(const hit of hits){const p=phone(hit);if(p)return p;}}return null;}
function category(niche){return map.find(([re])=>re.test(norm(niche)))?.[1]||null;}
function valid(v){return typeof v==="string"&&v.length>=2&&v.length<=85&&!/[\r\n<>\\]/.test(v);}
export function prospectingList({niche="",city="",status="uncontacted",limit=500}={}){
 const allRows=all("SELECT l.id,l.business,l.phone,l.city,l.segment,l.website,l.instagram,l.contact_permission,l.stage,l.source,l.website_status,l.created_at,l.notes, EXISTS(SELECT 1 FROM initial_contacts ic WHERE ic.lead_id=l.id) AS previously_contacted, EXISTS(SELECT 1 FROM threads t JOIN messages m ON m.thread_id=t.id WHERE t.lead_id=l.id AND m.direction='out') AS sent_message, EXISTS(SELECT 1 FROM suppressions s WHERE s.phone=l.phone) AS suppressed FROM leads l ORDER BY l.created_at DESC LIMIT 6000");
 const words=norm(niche).split(/\s+/).filter(w=>w.length>=4),targetCity=norm(city),cat=category(niche);
 const matches=allRows.filter(l=>{
  const loc=!targetCity||norm(l.city).includes(targetCity);
  const nicheOK=!words.length||words.some(w=>[l.segment,l.business,l.notes].some(v=>norm(v).includes(w)))||(cat&&l.segment===cat[1]);
  return loc&&nicheOK;
 });
 const contacted=matches.filter(l=>l.previously_contacted||l.sent_message||l.stage!=="DISCOVERED"||l.suppressed);
 const uncontacted=matches.filter(l=>!l.previously_contacted&&!l.sent_message&&!l.suppressed&&l.stage==="DISCOVERED");
 const selected=status==="contacted"?contacted:status==="all"?matches:uncontacted;
 const max=Math.min(Math.max(1,Number(limit)||500),500);
 return {total:matches.length,uncontacted:uncontacted.length,contacted:contacted.length,returned:Math.min(selected.length,max),results:selected.slice(0,max).map(({previously_contacted,sent_message,suppressed,notes,...x})=>({
  ...x,contacted:!!(previously_contacted||sent_message||suppressed||x.stage!=="DISCOVERED"),
  selectable:!!x.phone&&!suppressed&&!previously_contacted&&!sent_message&&x.stage==="DISCOVERED",
  // Links open for operator review. Google Maps search is used when the source
  // does not provide a verified place URL; no fake place ID is invented.
  maps_url:(String(notes||"").match(/https:\/\/(?:www\.)?google\.[a-z.]+\/maps[^\s|]*/i)||[])[0]||'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(x.business+' '+(x.city||'')),
  instagram_url:(()=>{const m=new RegExp('^https?://(?:www[.])?instagram[.]com/([a-z0-9._]{2,30})(?:/|$)','i').exec(x.website||'');const user=/^[a-z0-9._]{2,30}$/i.test(x.instagram||'')?x.instagram:m?.[1];return user?'https://www.instagram.com/'+user+'/':null;})(),
  needs_permission:x.contact_permission!==1
 })),partial:allRows.length===6000,source:"Base do Prospector",note:"Não contatada significa sem envio registrado, desconsiderando números bloqueados. O sistema não conhece contatos feitos fora do Prospector."};
}
async function locate(city){
 const known=resolveLocation(city);if(known)return {lat:known.lat,lon:known.lon};
 const url=new URL("https://nominatim.openstreetmap.org/search");
 url.searchParams.set("q",city+", Brasil");url.searchParams.set("format","jsonv2");url.searchParams.set("addressdetails","1");url.searchParams.set("limit","1");
 const res=await fetch(url,{headers:{"User-Agent":"ConsecomProspector/2.0 (contact: wmagenciasuporte@gmail.com)","Accept":"application/json","Accept-Language":"pt-BR"},signal:AbortSignal.timeout(12000)});
 if(!res.ok)throw Error("Geocodificação indisponível: HTTP "+res.status);
 const x=(await res.json())[0];if(!x||x.address?.country_code!=="br")throw Error("Cidade não encontrada no Brasil");
 return {lat:Number(x.lat),lon:Number(x.lon)};
}
// Two independent hosts, not multiple aliases for the same overloaded provider.
// The total deadline is bounded so the dashboard is not held waiting for a minute.
export async function remoteQuery(q){
 let failure;
 const providers=["https://overpass.private.coffee/api/interpreter","https://overpass-api.de/api/interpreter","https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
 for(const endpoint of providers){
  try{
   const res=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded; charset=utf-8","User-Agent":"ConsecomProspector/2.1 (business research; contact: wmagenciasuporte@gmail.com)","Accept":"application/json"},body:new URLSearchParams({data:q}),signal:AbortSignal.timeout(15000)});
   if(res.ok){
    const data=await res.json();
    if(data?.remark||!Array.isArray(data?.elements))throw Error("A fonte OSM não concluiu a consulta");
    return data;
   }
   failure=Error("Fonte pública OSM respondeu HTTP "+res.status);
   // Honor provider throttling; retry only transient upstream availability errors.
   if(![502,503,504].includes(res.status))break;
  }catch(e){failure=e;}
 }
 const detail=failure?.name==="TimeoutError"||failure?.name==="AbortError"?"Tempo excedido nos servidores OSM":String(failure?.message||"Fonte pública indisponível");
 throw Error(detail+". Os registros já salvos permanecem disponíveis.");
}
let busy=false;
export async function prospectingSearch({niche,city}={}){
 if(!valid(niche)||!valid(city))throw Error("Informe um nicho e cidade válidos (até 85 caracteres)");
 if(busy)throw Error("Já existe uma pesquisa em andamento");
 const query="prospector:v2:"+norm(niche)+":"+norm(city);
 const last=one("SELECT at,status,found FROM discoveries WHERE query=? ORDER BY at DESC LIMIT 1",query);
 const age=last?Date.now()-Date.parse(last.at):Infinity;
 if(age<20*60_000&&last?.status==="COMPLETE")return {ok:true,cached:true,added:0,source:"OpenStreetMap",note:"Consulta recente; exibindo dados já salvos.",...prospectingList({niche,city})};
 if(age<2*60_000&&last?.status==="FAILED")throw Error("A fonte falhou recentemente. Confira a base já salva e tente novamente em instantes.");
 busy=true;
 const marker=id();run("INSERT INTO discoveries(id,query,found,at,status,details) VALUES(?,?,?,?,?,?)",marker,query,0,now(),"RUNNING","{}");
 try{
  const place=await locate(city),tag=category(niche);
  const escaped=norm(niche).replace(/[^a-z0-9 áéíóúãõâêôç-]/g,"").slice(0,60);
  const filter=tag?'["'+tag[0]+'"="'+tag[1]+'"]':'["name"~"'+escaped+'",i]';
  const q='[out:json][timeout:24];(nwr'+filter+'["name"](around:4000,'+place.lat+','+place.lon+'););out center 100;';
  const data=await remoteQuery(q),found=Array.isArray(data.elements)?data.elements:[];
  let added=0,skipped=0;
  for(const item of found){
   const tags=item.tags||{},name=String(tags.name||"").trim();if(!name)continue;
   const osmUrl="https://www.openstreetmap.org/"+item.type+"/"+item.id;
   try{
    const r=addLead({business:name.slice(0,150),phone:phoneFrom(tags),instagram:instagramFrom(tags),city:city.trim(),segment:niche.trim().slice(0,90),website:String(tags.website||tags["contact:website"]||"").slice(0,450)||undefined,website_status:"UNCERTAIN",source:"osm",osm_id:osmUrl,contact_permission:false,notes:"OSM: "+osmUrl});
    if(r.created)added++;
    recordOrigin(r.lead.id,"osm",{identity:osmUrl,query:niche,city,provider:"Overpass"},false);
   }catch{skipped++;}
  }
  run("UPDATE discoveries SET found=?,status='COMPLETE',details=? WHERE id=?",added,JSON.stringify({examined:found.length,skipped,source:"OpenStreetMap"}),marker);
  return {ok:true,added,examined:found.length,partial:true,source:"OpenStreetMap/Overpass",note:tag?"Limite de 100 registros por consulta e raio de 4 km; cobertura parcial.":"Nicho livre buscado por nome comercial; cobertura parcial.",...prospectingList({niche,city})};
 }catch(e){
  run("UPDATE discoveries SET status='FAILED',details=? WHERE id=?",JSON.stringify({reason:String(e.message).slice(0,120)}),marker);
  throw e;
 }finally{busy=false;}
}
