// Verified-owner administrative tools for the Consecom Prospector.
// This file is never an HTTP endpoint; caller must verify the full sender JID/session.
// No arbitrary SQL, shell, credential disclosure or unsanctioned outbound messages.
import crypto from 'node:crypto';
import {db,one,all,run,now,getSetting,setSetting,audit} from './db.mjs';
import {prospectingList} from './prospecting-search.mjs';
import {prepareApproaches} from './prospecting-approach.mjs';
import {approachQueueStatus,enqueueApprovedApproaches,cancelApproachQueue} from './prospecting-queue.mjs';
import {documentedOptIn} from './outreach-queue.mjs';
import {selectedCampaign,activateCampaign,validateCampaignForActivation} from './campaign-selection.mjs';
import {setExistingClientRelationship,verifiedOwnerPhone} from './whatsapp-roles.mjs';

db.exec("CREATE TABLE IF NOT EXISTS groq_owner_confirmations(code TEXT PRIMARY KEY,operation TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,expires INTEGER NOT NULL)");
const string=description=>({type:'string',description});
const number=(description,min,max)=>({type:'integer',description,minimum:min,maximum:max});
const tool=(name,description,properties={},required=[])=>({type:'function',function:{name,description,parameters:{type:'object',properties,additionalProperties:false,...(required.length?{required}:{})}}});
export const ownerAdminTools=[
 tool('read_outreach_queue','Read the consent-gated first-contact queue and its state'),
 tool('preview_outreach','Inspect businesses saved in a niche and city, distinguishing those with documented permission',{
   niche:string('Industry'),city:string('City in Brazil'),limit:number('Maximum items',1,100)},['niche','city']),
 tool('request_start_outreach','Prepare a first-contact WhatsApp queue using only documented opt-in leads. Choose exact lead IDs OR niche/city; requires WhatsApp confirmation before enqueueing',{
   lead_ids:{type:'array',items:{type:'string'},maxItems:100},niche:string('Saved industry'),city:string('Saved city'),limit:number('Maximum leads',1,100)}),
 tool('cancel_outreach','Cancel queued outbound contacts, without retrying sent or unknown attempts'),
 tool('list_media_library','Read available audio/video/image media metadata',{limit:number('Maximum items',1,50)}),
 tool('get_workflow_details','Read the steps of one saved campaign',{workflow_id:string('Exact campaign ID')},['workflow_id']),
 tool('request_select_workflow','Validate and select a campaign with WhatsApp confirmation; pauses prospecting first',{workflow_id:string('Exact campaign ID')},['workflow_id']),
 tool('request_set_existing_client','Mark/unmark an existing customer with operator evidence, blocking marketing where appropriate. Confirmation required',{
   lead_id:string('Exact lead ID'),existing:{type:'boolean'},evidence:string('Contract or operator evidence')},['lead_id','existing']),
 tool('read_owner_settings','Read non-secret operational settings'),
 tool('request_change_setting','Update one non-secret operational setting. Enabling outbound operations requires confirmation; normal consent checks remain enforced',{
  key:{type:'string',enum:['paused','automation_enabled','auto_initial','discovery_auto_enabled','discovery_target_daily','discovery_start_hour','daily_limit','business_start','business_end','initial_interval_seconds','owner_notifications_enabled','decision_engine_enabled']},
  value:{description:'Boolean or integer',anyOf:[{type:'boolean'},{type:'integer'}]}},['key','value']),
 tool('request_cancel_meeting','Cancel an internal CRM meeting; does not edit Google Calendar',{meeting_id:string('Exact meeting ID')},['meeting_id'])
];
export const ownerAdminToolNames=new Set(ownerAdminTools.map(t=>t.function.name));
const validId=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/i.test(x);
function cleanText(x,max=95,min=2){
 if(typeof x!=='string'||x.trim().length<min||x.length>max||/[\r\n]/.test(x))throw Error('Texto inválido');
 return x.trim();
}
const booleans=new Set(['paused','automation_enabled','auto_initial','discovery_auto_enabled','owner_notifications_enabled','decision_engine_enabled']);
const numeric={discovery_target_daily:[0,150],discovery_start_hour:[0,23],daily_limit:[1,150],business_start:[0,23],business_end:[1,24],initial_interval_seconds:[90,3600]};
const settingKeys=[...booleans,...Object.keys(numeric)];
function validateSetting(key,value){
 if(!settingKeys.includes(key))throw Error('Configuração não autorizada pelo WhatsApp');
 if(booleans.has(key)){if(typeof value!=='boolean')throw Error('Esperado true ou false');}
 else if(!Number.isInteger(value)||value<numeric[key][0]||value>numeric[key][1])throw Error('Valor fora do limite');
 if(key==='business_start'&&value>=getSetting('business_end',18))throw Error('Horário inicial deve anteceder final');
 if(key==='business_end'&&value<=getSetting('business_start',8))throw Error('Horário final deve suceder inicial');
 if((key==='auto_initial'||key==='automation_enabled')&&value===true){
  const active=selectedCampaign();if(!active)throw Error('Selecione primeiro uma campanha válida');
  validateCampaignForActivation(one('SELECT * FROM workflows WHERE id=?',active.id));
 }
 return {key,value};
}
function selectedIds(a){
 if(a.lead_ids!==undefined){
  if(!Array.isArray(a.lead_ids)||a.lead_ids.length<1||a.lead_ids.length>100||a.lead_ids.some(x=>!validId(x)))throw Error('IDs de leads inválidos');
  return [...new Set(a.lead_ids)];
 }
 const niche=cleanText(a.niche,85),city=cleanText(a.city,85);
 const max=Number.isInteger(a.limit)?Math.min(100,Math.max(1,a.limit)):20;
 return prospectingList({niche,city,status:'uncontacted',limit:100}).results
   .filter(x=>x.phone&&documentedOptIn(x.id)).slice(0,max).map(x=>x.id);
}
function pending(operation,payload,summary){
 let code='';
 for(let i=0;i<20;i++){
  const proposed=String(crypto.randomInt(100000,1000000));
  const other=one("SELECT name FROM sqlite_master WHERE type='table' AND name='groq_owner_approvals'")?one('SELECT code FROM groq_owner_approvals WHERE code=?',proposed):null;
  if(!one('SELECT code FROM groq_owner_confirmations WHERE code=?',proposed)&&!other){code=proposed;break;}
 }
 if(!code)throw Error('Falha ao gerar confirmação');
 run("INSERT INTO groq_owner_confirmations(code,operation,payload,state,expires) VALUES(?,?,?,'PENDING',?)",code,operation,JSON.stringify(payload),Date.now()+600000);
 audit('GROQ_OWNER_OPERATION_PREPARED',null,{operation});
 return {requiresConfirmation:true,code,preview:summary,expiresMinutes:10,instruction:'Envie CONFIRMAR '+code+' nesta conversa do WhatsApp em até dez minutos.'};
}
export async function runOwnerAdminTool(name,a={}){
 if(!a||typeof a!=='object'||Array.isArray(a))throw Error('Parâmetros inválidos');
 if(name==='read_outreach_queue')return {queue:approachQueueStatus(),paused:getSetting('paused',true)};
 if(name==='preview_outreach'){
  const niche=cleanText(a.niche,85),city=cleanText(a.city,85);
  const max=Number.isInteger(a.limit)?Math.min(Math.max(a.limit,1),100):30;
  const list=prospectingList({niche,city,status:'uncontacted',limit:max});
  const yes=list.results.filter(x=>x.phone&&documentedOptIn(x.id));
  return {niche,city,total:list.total,shown:list.results.length,consented:yes.length,notConsented:list.results.length-yes.length,
   contacts:yes.map(x=>({id:x.id,business:x.business,phoneSuffix:x.phone.slice(-4)})),partial:list.partial,
   note:'Um telefone divulgado publicamente não representa consentimento comercial.'};
 }
 if(name==='request_start_outreach'){
  const ids=selectedIds(a);
  if(ids.length===0)return {eligible:0,requiresConfirmation:false,reason:'Nenhuma empresa possui permissão comercial documentada.'};
  const preview=prepareApproaches({leadIds:ids});
  const ready=preview.items.filter(x=>x.authorized);
  if(ready.length===0)return {eligible:0,requiresConfirmation:false,reason:'Nenhum contato selecionado tem consentimento documentado.'};
  if(approachQueueStatus().active)throw Error('Já existe uma fila ativa');
  return {...pending('START_OUTREACH',{leadIds:ready.map(x=>x.id)},'Fila de '+ready.length+' contatos autorizados, espaçados em pelo menos 90 segundos. Exemplos: '+ready.slice(0,4).map(x=>x.business).join(', ')),
   selected:ids.length,eligible:ready.length,excluded:ids.length-ready.length};
 }
 if(name==='cancel_outreach')return cancelApproachQueue();
 if(name==='list_media_library')return {media:all('SELECT id,name,kind,mime,duration,bytes,created_at FROM media ORDER BY created_at DESC LIMIT ?',Number.isInteger(a.limit)?Math.min(50,Math.max(1,a.limit)):20)};
 if(name==='get_workflow_details'){
  if(!validId(a.workflow_id))throw Error('ID de campanha inválido');
  const w=one('SELECT id,name,steps,version,enabled,is_default,segments_json FROM workflows WHERE id=?',a.workflow_id);
  if(!w)throw Error('Campanha não encontrada');
  return {id:w.id,name:w.name,steps:JSON.parse(w.steps),version:w.version,enabled:!!w.enabled,isDefault:!!w.is_default,segments:JSON.parse(w.segments_json||'[]')};
 }
 if(name==='request_select_workflow'){
  if(!validId(a.workflow_id))throw Error('ID de campanha inválido');
  const workflow=one('SELECT * FROM workflows WHERE id=?',a.workflow_id);
  validateCampaignForActivation(workflow);
  return pending('SELECT_WORKFLOW',{workflowId:workflow.id},'Selecionar campanha '+workflow.name+'; a operação ficará pausada até sua ativação.');
 }
 if(name==='request_set_existing_client'){
  if(!validId(a.lead_id)||typeof a.existing!=='boolean')throw Error('Classificação inválida');
  const l=one('SELECT id,business,phone FROM leads WHERE id=?',a.lead_id);
  if(!l)throw Error('Contato não encontrado');
  if(l.phone===verifiedOwnerPhone())throw Error('Proprietário não pode ser marcado como cliente');
  const evidence=a.existing?cleanText(a.evidence,350,8):'Classificação removida pelo proprietário';
  return pending('SET_EXISTING_CLIENT',{leadId:l.id,existing:a.existing,evidence},(a.existing?'Classificar ':'Desclassificar ')+l.business+' como cliente existente');
 }
 if(name==='read_owner_settings')return {settings:Object.fromEntries(settingKeys.map(k=>[k,getSetting(k,null)])),selectedCampaign:selectedCampaign(),note:'Segredos e tokens nunca são retornados'};
 if(name==='request_change_setting'){
  const {key,value}=validateSetting(a.key,a.value);
  const impactsSending=(['auto_initial','automation_enabled'].includes(key)&&value===true)||(key==='paused'&&value===false&&getSetting('auto_initial',false));
  if(impactsSending)return pending('SET_SETTING',{key,value},'Confirmação para alterar '+key+' para '+String(value));
  setSetting(key,value);audit('GROQ_OWNER_SETTING_CHANGED',null,{key,value});
  return {changed:true,key,value};
 }
 if(name==='request_cancel_meeting'){
  if(!validId(a.meeting_id))throw Error('Reunião inválida');
  const m=one('SELECT id,start_at,status FROM meetings WHERE id=?',a.meeting_id);
  if(!m)throw Error('Reunião não encontrada');
  if(m.status==='CANCELLED')return {alreadyCancelled:true};
  return pending('CANCEL_MEETING',{meetingId:m.id},'Cancelar reunião no CRM em '+m.start_at+' (não altera calendário externo)');
 }
 throw Error('Ferramenta administrativa indisponível');
}
// Called only by executeConfirmedOperation AFTER server-side owner verification.
export function executeOwnerAdminConfirmation(p){
 const args=JSON.parse(p.payload);let outcome;
 if(p.operation==='START_OUTREACH'){
  const r=enqueueApprovedApproaches({leadIds:args.leadIds,approve:true});
  if(r.status!==202)return {ok:false,error:r.body?.error||'Fila não criada'};
  outcome={ok:true,message:'Fila aprovada: '+r.body.queued+' contatos autorizados. O worker agenda envios a cada 90 segundos.',queue:r.body};
 }else if(p.operation==='SELECT_WORKFLOW'){
  setSetting('paused',true);
  const out=activateCampaign(args.workflowId);
  outcome={ok:true,message:'Campanha selecionada: '+out.name+'. Operação continua pausada.'};
 }else if(p.operation==='SET_EXISTING_CLIENT'){
  const out=setExistingClientRelationship({leadId:args.leadId,existing:args.existing,evidence:args.evidence});
  outcome={ok:true,message:args.existing?'Contato marcado como cliente existente e protegido contra prospecção.':'Relação de cliente removida.',relationship:out};
 }else if(p.operation==='SET_SETTING'){
  const {key,value}=validateSetting(args.key,args.value);
  setSetting(key,value);audit('GROQ_OWNER_SETTING_CHANGED',null,{key,value,confirmed:true});
  outcome={ok:true,message:'Configuração '+key+' alterada para '+String(value)};
 }else if(p.operation==='CANCEL_MEETING'){
  const n=run("UPDATE meetings SET status='CANCELLED' WHERE id=? AND status<>'CANCELLED'",args.meetingId).changes;
  audit('GROQ_OWNER_MEETING_CANCELLED',null,{meetingId:args.meetingId});
  outcome={ok:true,message:n?'Reunião interna cancelada.':'Reunião já estava cancelada.'};
 }else return null;
 run("UPDATE groq_owner_confirmations SET state='EXECUTED' WHERE code=? AND state='UNKNOWN'",p.code);
 audit('GROQ_OWNER_OPERATION_CONFIRMED',null,{operation:p.operation});
 return outcome;
}
