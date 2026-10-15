// Importador controlado de registros de CNPJ/CNES já obtidos legitimamente.
// Não faz download em massa de bases oficiais nem concede permissão de WhatsApp.
import {addLead,run,id,now,audit,getSetting} from './db.mjs';
import {recordOrigin} from './discovery.mjs';
const SOURCES=new Set(['cnpj','cnes']);
function normalizeHeader(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');}
export function parseCSV(content,maxRows=200){
 const text=String(content||'').replace(/^\uFEFF/,'');
 if(text.length>800000)throw Error('Arquivo CSV excede 800 KB; exporte um lote menor.');
 const delimiter=(text.split(/\r?\n/,1)[0].match(/;/g)||[]).length>=(text.split(/\r?\n/,1)[0].match(/,/g)||[]).length?';':',';
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;continue;}
  if(!quoted&&c===delimiter){row.push(field.trim());field='';continue;}
  if(!quoted&&(c==='\n'||c==='\r')){
   if(c==='\r'&&text[i+1]==='\n')i++;
   row.push(field.trim());if(row.some(Boolean))rows.push(row);row=[];field='';
   if(rows.length>maxRows+1)throw Error('Máximo de 200 registros por importação');continue;
  }
  field+=c;
 }
 if(quoted)throw Error('CSV com aspas não encerradas');
 row.push(field.trim());if(row.some(Boolean))rows.push(row);
 if(rows.length<2)return [];
 const keys=rows[0].map(normalizeHeader);
 if(keys.some(x=>!x)||new Set(keys).size!==keys.length)throw Error('Cabeçalho CSV inválido ou duplicado');
 return rows.slice(1).map(r=>Object.fromEntries(keys.map((k,i)=>[k,r[i]||''])));
}
function field(row,keys){for(const k of keys){const v=row[k];if(v!==undefined&&String(v).trim())return String(v).trim();}return '';}
export function importOfficial(payload){
 const source=String(payload.source||'').toLowerCase();
 if(!SOURCES.has(source))throw Error('Fonte oficial deve ser cnpj ou cnes');
 if(getSetting('discovery_sources',{})[source]===false)throw Error('Fonte desativada nas configurações');
 const data=typeof payload.csv==='string'?parseCSV(payload.csv):payload.records;
 if(!Array.isArray(data)||data.length<1||data.length>200)throw Error('Envie de 1 a 200 registros CSV/JSON');
 let added=0,examined=0,duplicates=0,invalid=0;
 const problems=[];
 for(const raw of data){
  try{
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Registro inválido');
   const v=Object.fromEntries(Object.entries(raw).map(([k,x])=>[normalizeHeader(k),x]));
   const reference=source==='cnpj'?field(v,['cnpj','cnpj_basico_completo','cnpj_completo']):field(v,['cnes','co_cnes','codigo_cnes']);
   const digits=reference.replace(/\D/g,'');
   if(source==='cnpj'&&!/^\d{14}$/.test(digits))throw Error('CNPJ deve conter 14 dígitos');
   if(source==='cnes'&&!/^\d{7}$/.test(digits))throw Error('CNES deve conter 7 dígitos');
   const business=field(v,['nome_fantasia','razao_social','nome_empresarial','nome_estabelecimento','no_fantasia','no_razao_social','nome']);
   if(business.length<3||business.length>120)throw Error('Nome comercial inválido');
   const city=field(v,['municipio','cidade','cidade_nome','nome_municipio','no_municipio']).slice(0,90);
   const identifier=source+':'+digits;
   examined++;
   const lead=addLead({business,city,segment:field(v,['atividade','cnae_descricao','tipo_estabelecimento','segmento']).slice(0,90),
    phone:field(v,['telefone','whatsapp','telefone_1','nu_telefone']),instagram:field(v,['instagram']),
    source,official_id:identifier,contact_permission:false,website_status:'UNCERTAIN',
    notes:'Registro importado de arquivo oficial fornecido pelo operador ('+source.toUpperCase()+'). Verificação e autorização pendentes.'});
   recordOrigin(lead.lead.id,source,{identity:identifier,reference:digits,importMode:'operator_csv',sourceReviewRequired:true});
   if(lead.created)added++;else duplicates++;
  }catch(e){invalid++;if(problems.length<12)problems.push(String(e.message).slice(0,130));}
 }
 run('INSERT INTO discoveries VALUES(?,?,?,?,?,?)',id(),source+':import',added,now(),'COMPLETE',JSON.stringify({examined,duplicates,invalid,source}));
 audit('OFFICIAL_IMPORT',null,{source,examined,added,duplicates,invalid});
 return {source,examined,added,duplicates,invalid,errors:problems,
  info:'Dados oficiais importados para pesquisa. Sem autorização de contato por padrão. Ausência de site deve ser revisada.'};
}
