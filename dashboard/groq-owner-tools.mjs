import crypto from 'node:crypto';
import {db,one,all,run,now,id,getSetting,setSetting,stage,addLead,phone,audit,stopLead} from './db.mjs';
import {prospectingList,prospectingSearch} from './prospecting-search.mjs';
import {waControlStatus} from './waakg-control.mjs';
import {remoteChats,remoteMessages} from './waakg-conversations.mjs';

// This is a deliberately restricted, auditable interface to real CRM operations.
// Never grant raw SQL, arbitrary HTTP fetches, code execution, credential reads, or bulk sends.
db.exec("CREATE TABLE IF NOT EXISTS groq_owner_approvals(code TEXT PRIMARY KEY,jid TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,expires INTEGER NOT NULL)");
const obj=props=>({type:'object',properties:props,additionalProperties:false});
const string=(description)=>({type:'string',description});
const flag=(description)=>({type:'boolean',description});
function tool(name,description,properties={},required=[]){
 return {type:'function',function:{name,description,parameters:{...obj(properties),...(required.length?{required}:{})}}};
}
const stages=['DISCOVERED','CONTACTED','REPLIED','INTERESTED','NO_INTEREST','CLOSED_WON'];
export const agentTools=[
 tool('system_status','Read operational health, safe overview metrics, campaign pause state and WA connection'),
 tool('system_diagnostics','Inspect pending jobs, delivery errors, discovery statuses and recent non-secret events'),
 tool('list_prospects','List saved prospects filtered by niche and city and contacted status',{niche:string('Industry'),city:string('City'),status:{type:'string',enum:['all','uncontacted','contacted']},limit:{type:'integer',minimum:1,maximum:40}}),
 tool('search_leads','Find businesses by name, telephone, niche or city; IDs needed for specific edits',{query:string('Name, partial phone, segment or location'),limit:{type:'integer',minimum:1,maximum:40}},['query']),
 tool('get_lead','Read full saved non-secret details, last 12 messages and meetings of one lead',{lead_id:string('Exact ID returned by search_leads or list_prospects')},['lead_id']),
 tool('list_conversations','List recent saved WhatsApp conversations with names and last message times',{limit:{type:'integer',minimum:1,maximum:35}}),
 tool('read_conversation','Read last 25 messages from a specific saved conversation',{thread_id:string('Exact conversation ID returned by list_conversations')},['thread_id']),
 tool('whatsapp_status','Check real connection status of the WA-AKG session'),
 tool('list_meetings','Show upcoming or recent meetings',{limit:{type:'integer',minimum:1,maximum:30}}),
 tool('read_audit_log','Read recent changes and operations (without secret configuration)',{limit:{type:'integer',minimum:1,maximum:30}}),
 tool('discovery_history','Check history of niche/city lookups, errors and discovered counts',{limit:{type:'integer',minimum:1,maximum:25}}),
 tool('safe_settings','Read only safe operational settings, NEVER any credentials'),
 tool('create_lead','Add one business, without granting WhatsApp marketing consent',{business:string('Company name'),phone:string('Business phone with DDD or country code'),instagram:string('Public Instagram username if no telephone'),city:string('City'),segment:string('Industry'),notes:string('Short internal notes')},['business']),
 tool('update_lead','Edit a known business name, city, industry, website, notes, or lifecycle stage. Only provided fields change',{lead_id:string('Exact lead ID'),business:string('New business name'),city:string('City'),segment:string('Industry'),website:string('Public website URL'),notes:string('Internal notes'),stage:{type:'string',enum:stages}},['lead_id']),
 tool('set_pause','Pause or unpause Prospector operations. Does NOT activate automated marketing',{paused:flag('True to pause; false to resume manual operation')},['paused']),
 tool('create_meeting','Create a meeting record for an existing lead (no Google Calendar invitations)',{lead_id:string('Exact lead ID'),start_at:string('ISO 8601 date with timezone offset, in the future'),notes:string('Optional meeting topic')},['lead_id','start_at']),
 tool('block_contact','Stop future outreach to an existing lead and cancel any pending tasks',{lead_id:string('Exact lead ID'),reason:string('Reason for stopping contact')},['lead_id']),
 tool('search_businesses','Run a live, rate-limited public OpenStreetMap niche/city search and save found businesses; coverage incomplete',{niche:string('Industry, e.g. oficinas mecânicas'),city:string('Brazilian city, e.g. Sorocaba')},['niche','city']),
 tool('prepare_message','Prepare ONE WhatsApp reply to a contact who has already messaged the business; requires a confirmation code',{phone:string('Recipient phone with DDD'),text:string('Exact message, no bulk sends')},['phone','text'])
];
const requiredText=(v,max=300,min=1)=>{
 if(typeof v!=='string'||v.trim().length<min||v.length>max)throw Error('Valor inválido (texto ou tamanho)');
 return v.trim();
};
function limit(v,max=30,defaultSize=12){return Number.isInteger(v)&&v>0?Math.min(v,max):defaultSize;}
function leadId(v){return requiredText(v,80,8);}
const getLead=x=>one('SELECT * FROM leads WHERE id=?',leadId(x));
const cleanLead=x=>x?({id:x.id,business:x.business,name:x.name,phone:x.phone,instagram:x.instagram,segment:x.segment,city:x.city,website:x.website,website_status:x.website_status,stage:x.stage,contact_permission:x.contact_permission===1,notes:x.notes,source:x.source,last_activity_at:x.last_activity_at,created_at:x.created_at}):null;
const safeSettings=['paused','auto_initial','automation_enabled','discovery_auto_enabled','discovery_target_daily','discovery_start_hour','daily_limit','business_start','business_end','owner_notifications_enabled','owner_report_hour','decision_engine_enabled','discovery_sources'];
function safeSettingsRead(){return Object.fromEntries(safeSettings.map(k=>[k,getSetting(k,null)]));}
function permittedRecipient(number){
 const row=one('SELECT id,contact_permission FROM leads WHERE phone=?',number);
 if(!row||one('SELECT 1 FROM suppressions WHERE phone=?',number))return false;
 return row.contact_permission===1||!!one("SELECT 1 FROM threads t JOIN messages m ON m.thread_id=t.id WHERE t.lead_id=? AND m.direction='in' LIMIT 1",row.id);
}
function updateLead(a){
 const found=getLead(a.lead_id);if(!found)throw Error('Empresa não encontrada');
 const updates={};
 for(const key of ['business','city','segment','website','notes']){
  if(a[key]===undefined)continue;
  if(key==='business')updates.business=requiredText(a.business,140,2);
  else if(key==='notes')updates.notes=typeof a.notes==='string'&&a.notes.length<=1800?a.notes: (()=>{throw Error('Observação muito longa')})();
  else if(key==='website'){
   const v=String(a.website||'').trim();
   if(v){let u;try{u=new URL(v);}catch{throw Error('Website inválido');}
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('Website inválido');
    updates.website=u.href.slice(0,350);
   }else updates.website=null;
  }else updates[key]=requiredText(a[key],95);
 }
 if(a.stage!==undefined&&!stages.includes(a.stage))throw Error('Etapa inválida');
 if(!Object.keys(updates).length&&a.stage===undefined)throw Error('Informe o que deseja alterar');
 const modified=[];
 for(const [key,value] of Object.entries(updates)){run('UPDATE leads SET '+key+'=? WHERE id=?',value,found.id);modified.push(key);}
 if(a.stage&&a.stage!==found.stage){stage(found.id,a.stage,'GROQ_OWNER');modified.push('stage');}
 audit('GROQ_OWNER_LEAD_UPDATED',found.id,{fields:modified,previousStage:found.stage,newStage:a.stage||found.stage});
 return {updated:true,fields:modified,lead:cleanLead(getLead(found.id))};
}
function getLeadDetails(a){
 const lead=getLead(a.lead_id);if(!lead)throw Error('Empresa não encontrada');
 const thread=one('SELECT * FROM threads WHERE lead_id=?',lead.id);
 const messages=thread?all('SELECT direction,type,body,status,at FROM messages WHERE thread_id=? ORDER BY at DESC LIMIT 12',thread.id).reverse():[];
 const meetings=all('SELECT id,start_at,notes,status FROM meetings WHERE lead_id=? ORDER BY start_at DESC LIMIT 15',lead.id);
 const jobs=all('SELECT id,status,created_at,updated_at FROM jobs WHERE lead_id=? ORDER BY created_at DESC LIMIT 8',lead.id);
 return {lead:cleanLead(lead),thread:{id:thread?.id||null,manual_takeover:Boolean(thread?.manual_takeover),unread:thread?.unread_count||0},messages,meetings,jobs};
}
export async function runAgentTool(name,a={}){
 if(!a||typeof a!=='object'||Array.isArray(a))throw Error('Argumentos inválidos');
 if(name==='system_status'){
  const wa=await waControlStatus();
  return {leads:one('SELECT COUNT(*) n FROM leads')?.n||0,uncontacted:one("SELECT COUNT(*) n FROM leads WHERE stage='DISCOVERED'")?.n||0,threads:one('SELECT COUNT(*) n FROM threads')?.n||0,meetings:one("SELECT COUNT(*) n FROM meetings WHERE status='SCHEDULED' AND start_at>?",now())?.n||0,settings:safeSettingsRead(),whatsapp:{connected:wa.connected,status:wa.status,hasSession:wa.hasSession},automatedOutreach:false};
 }
 if(name==='system_diagnostics'){
  const jobs=all('SELECT status,COUNT(*) n FROM jobs GROUP BY status').map(x=>({status:x.status,count:x.n}));
  const discoveries=all('SELECT status,COUNT(*) n FROM discoveries WHERE at>datetime("now","-7 days") GROUP BY status').map(x=>({status:x.status,count:x.n}));
  const failed=all("SELECT at,query,status,details FROM discoveries WHERE status='FAILED' ORDER BY at DESC LIMIT 4").map(x=>({at:x.at,query:x.query,details:String(x.details||'').slice(0,200)}));
  return {jobs,discoveries,failed,paused:getSetting('paused',true),automaticSendsEnabled:false};
 }
 if(name==='list_prospects'){const x=prospectingList({city:String(a.city||'').slice(0,80),niche:String(a.niche||'').slice(0,80),status:a.status||'uncontacted',limit:limit(a.limit,40,20)});return {...x,results:x.results.slice(0,limit(a.limit,40,20))};}
 if(name==='search_leads'){
  const term='%'+requiredText(a.query,95,2).replace(/[%_]/g,x=>'\\'+x)+'%';
  const found=all("SELECT * FROM leads WHERE business LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\' OR segment LIKE ? ESCAPE '\\' ORDER BY last_activity_at DESC,created_at DESC LIMIT ?",term,term,term,term,limit(a.limit,40,15));
  return {totalReturned:found.length,leads:found.map(cleanLead)};
 }
 if(name==='get_lead')return getLeadDetails(a);
 if(name==='list_conversations'){
  const t=all("SELECT t.id,t.jid,t.unread_count,t.manual_takeover,t.last_message_at,l.business,l.phone,l.id AS lead_id,(SELECT substr(body,1,160) FROM messages WHERE thread_id=t.id ORDER BY at DESC LIMIT 1) AS preview FROM threads t JOIN leads l ON l.id=t.lead_id ORDER BY t.last_message_at DESC LIMIT ?",limit(a.limit,35,15));
  return {conversations:t};
 }
 if(name==='read_conversation'){
  const thread=one('SELECT t.id,t.jid,l.business,l.phone FROM threads t JOIN leads l ON l.id=t.lead_id WHERE t.id=?',requiredText(a.thread_id,80,8));if(!thread)throw Error('Conversa não encontrada');
  return {thread,messages:all('SELECT direction,body,type,status,at FROM messages WHERE thread_id=? ORDER BY at DESC LIMIT 25',thread.id).reverse()};
 }
 if(name==='whatsapp_status'){const wa=await waControlStatus();return {connected:wa.connected,status:wa.status,hasSession:wa.hasSession,totalSessions:wa.totalSessions};}
 if(name==='list_meetings')return {meetings:all("SELECT m.id,m.start_at,m.notes,m.status,l.business,l.phone,l.id AS lead_id FROM meetings m JOIN leads l ON l.id=m.lead_id ORDER BY m.start_at DESC LIMIT ?",limit(a.limit,30,15))};
 if(name==='read_audit_log')return {recent:all('SELECT at,action,lead_id,detail FROM audit ORDER BY at DESC LIMIT ?',limit(a.limit,30,15)).map(x=>({at:x.at,action:x.action,lead_id:x.lead_id,details:String(x.detail||'').slice(0,350)}))};
 if(name==='discovery_history')return {recent:all('SELECT at,query,status,found,details FROM discoveries ORDER BY at DESC LIMIT ?',limit(a.limit,25,12)).map(x=>({...x,details:String(x.details||'').slice(0,220)}))};
 if(name==='safe_settings')return {settings:safeSettingsRead(),note:'Credenciais e segredos não estão disponíveis para a IA'};
 if(name==='create_lead'){
  const business=requiredText(a.business,140,2),contact=String(a.phone||'').trim(),ig=String(a.instagram||'').replace(/^@/,'').trim();
  if(!phone(contact)&&!ig)throw Error('Para cadastrar, informe telefone com DDD ou Instagram');
  if(ig&&!/^[A-Za-z0-9._]{2,30}$/.test(ig))throw Error('Instagram inválido');
  const r=addLead({business,phone:contact||undefined,instagram:ig||undefined,city:a.city?requiredText(a.city,95):undefined,segment:a.segment?requiredText(a.segment,95):undefined,notes:a.notes?requiredText(a.notes,900):undefined,contact_permission:false,source:'GROQ_OWNER'});
  audit('GROQ_OWNER_LEAD_CREATED',r.lead.id,{new:r.created});
  return {created:r.created,lead:cleanLead(r.lead),contactPermission:false};
 }
 if(name==='update_lead')return updateLead(a);
 if(name==='set_pause'){if(typeof a.paused!=='boolean')throw Error('Use true ou false');setSetting('paused',a.paused);audit('GROQ_OWNER_PAUSE',null,{paused:a.paused});return {paused:a.paused,automaticSends:false};}
 if(name==='create_meeting'){
  const l=getLead(a.lead_id);if(!l)throw Error('Empresa não encontrada');
  const stamp=requiredText(a.start_at,55,14),date=new Date(stamp);
  if(!/(?:Z|[+-]\d\d:\d\d)$/.test(stamp)||!Number.isFinite(date.getTime())||date.getTime()<=Date.now()+60000)throw Error('Data futura deve conter fuso horário, por exemplo 2026-11-03T15:00:00-03:00');
  const notes=a.notes===undefined?'':requiredText(a.notes,700);
  const meetingId=id();
  run('INSERT INTO meetings(id,lead_id,start_at,notes,status,created_at) VALUES(?,?,?,?,?,?)',meetingId,l.id,date.toISOString(),notes,'SCHEDULED',now());
  audit('GROQ_OWNER_MEETING_CREATED',l.id,{meetingId,at:date.toISOString()});
  return {created:true,meetingId,leadId:l.id,startAt:date.toISOString(),notes,calendarInviteCreated:false};
 }
 if(name==='block_contact'){
  const l=getLead(a.lead_id);if(!l)throw Error('Empresa não encontrada');
  const reason=a.reason?requiredText(a.reason,160):'Owner asked to stop contact';
  stopLead(l.id,'GROQ_OWNER_'+reason.slice(0,70));
  audit('GROQ_OWNER_CONTACT_BLOCKED',l.id,{reason:reason.slice(0,160)});
  return {blocked:true,id:l.id,recipientSuffix:String(l.phone||'').slice(-4),pendingTasksCancelled:true};
 }
 if(name==='search_businesses'){
  const niche=requiredText(a.niche,85,2),city=requiredText(a.city,85,2);
  const result=await prospectingSearch({niche,city});
  audit('GROQ_OWNER_PROSPECT_SEARCH',null,{niche,city,added:result.added||0});
  return {source:result.source,added:result.added||0,total:result.total,uncontacted:result.uncontacted,returned:Math.min(result.results?.length||0,15),results:(result.results||[]).slice(0,15),partial:true,note:result.note};
 }
 if(name==='prepare_message'){
  const number=phone(a.phone),body=requiredText(a.text,1200,1);
  if(!number)throw Error('Telefone inválido');
  if(!permittedRecipient(number))throw Error('Somente contatos que autorizaram ou iniciaram conversa, sem opt-out');
  const code=String(crypto.randomInt(100000,1000000));
  run('INSERT INTO groq_owner_approvals VALUES(?,?,?,?,?)',code,number+'@s.whatsapp.net',body,'PENDING',Date.now()+600000);
  audit('GROQ_OWNER_MESSAGE_PREPARED',null,{recipientSuffix:number.slice(-4)});
  return {requiresConfirmation:true,code,recipientSuffix:number.slice(-4),preview:body,instruction:'Envie CONFIRMAR '+code+' em até 10 minutos. Não foi enviado.'};
 }
 throw Error('Ferramenta indisponível: '+String(name).slice(0,60));
}
export function claimApproval(code){
 const pending=one("SELECT * FROM groq_owner_approvals WHERE code=? AND state='PENDING' AND expires>?",String(code),Date.now());
 if(!pending||!permittedRecipient(pending.jid.split('@')[0]))return null;
 run("UPDATE groq_owner_approvals SET state='UNKNOWN' WHERE code=? AND state='PENDING'",code);
 return pending;
}
export function markApproval(code){run("UPDATE groq_owner_approvals SET state='SENT' WHERE code=? AND state='UNKNOWN'",code);}
