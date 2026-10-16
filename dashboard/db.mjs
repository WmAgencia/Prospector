import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {CAMPAIGN_NAME,CAMPAIGN_INTRO,buildConsecomSteps} from './consecom-flow.mjs';
import {personalName} from './classifier.mjs';
import {DatabaseSync} from 'node:sqlite';
const dir=path.resolve(process.env.PROSPECTOR_DATA_DIR||'data');
fs.mkdirSync(dir,{recursive:true});
export const db=new DatabaseSync(path.join(dir,'prospector.sqlite'));
db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
export const id=()=>crypto.randomUUID();
export const now=()=>new Date().toISOString();
export const all=(sql,...p)=>db.prepare(sql).all(...p);
export const one=(sql,...p)=>db.prepare(sql).get(...p);
export const run=(sql,...p)=>db.prepare(sql).run(...p);
export function tx(fn){db.exec('BEGIN IMMEDIATE');try{const a=fn();db.exec('COMMIT');return a;}catch(e){db.exec('ROLLBACK');throw e;}}
export const digits=s=>String(s||'').replace(/\D/g,'');
export function phone(s){const x=digits(s);if(x.length===10||x.length===11)return '55'+x;return x.length>=12&&x.length<=15?x:null;}
export const instagram=s=>String(s||'').trim().replace(/^@/,'').toLowerCase()||null;
const tables=[
'CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)',
'CREATE TABLE IF NOT EXISTS lead_origins(id TEXT PRIMARY KEY,lead_id TEXT NOT NULL REFERENCES leads(id),source TEXT NOT NULL,identity TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 0,details TEXT NOT NULL,at TEXT NOT NULL,UNIQUE(lead_id,source,identity))',
'CREATE TABLE IF NOT EXISTS leads(id TEXT PRIMARY KEY,name TEXT,business TEXT NOT NULL,instagram TEXT UNIQUE,phone TEXT UNIQUE,segment TEXT,city TEXT,website TEXT,website_status TEXT NOT NULL DEFAULT "UNCERTAIN",source TEXT,stage TEXT NOT NULL DEFAULT "DISCOVERED",contact_permission INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,last_activity_at TEXT,notes TEXT DEFAULT "")',
'CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,lead_id TEXT UNIQUE NOT NULL REFERENCES leads(id),jid TEXT UNIQUE,manual_takeover INTEGER NOT NULL DEFAULT 0,unread_count INTEGER NOT NULL DEFAULT 0,last_message_at TEXT,created_at TEXT NOT NULL)',
'CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES threads(id),provider_id TEXT UNIQUE,direction TEXT NOT NULL,type TEXT NOT NULL,body TEXT DEFAULT "",media_id TEXT,status TEXT NOT NULL,at TEXT NOT NULL)',
'CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id,at)',
'CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY,name TEXT NOT NULL,is_default INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,steps TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)',
'CREATE TABLE IF NOT EXISTS executions(id TEXT PRIMARY KEY,lead_id TEXT NOT NULL UNIQUE REFERENCES leads(id),workflow_id TEXT NOT NULL,version INTEGER NOT NULL,steps TEXT NOT NULL,next_step INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL,wake_at TEXT,updated_at TEXT NOT NULL)',
'CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,lead_id TEXT NOT NULL REFERENCES leads(id),execution_id TEXT,step_index INTEGER,type TEXT NOT NULL,text TEXT DEFAULT "",media_id TEXT,key TEXT UNIQUE NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,error TEXT)',
'CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status,created_at)',
'CREATE TABLE IF NOT EXISTS initial_contacts(lead_id TEXT PRIMARY KEY REFERENCES leads(id),phone TEXT UNIQUE NOT NULL,status TEXT NOT NULL,job_id TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL)',
'CREATE TABLE IF NOT EXISTS suppressions(phone TEXT PRIMARY KEY,reason TEXT NOT NULL,created_at TEXT NOT NULL)',
'CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,mime TEXT NOT NULL,filename TEXT NOT NULL,duration REAL,bytes INTEGER NOT NULL,created_at TEXT NOT NULL)',
'CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,at TEXT NOT NULL,action TEXT NOT NULL,lead_id TEXT,detail TEXT NOT NULL)',
'CREATE TABLE IF NOT EXISTS discoveries(id TEXT PRIMARY KEY,query TEXT NOT NULL,found INTEGER NOT NULL,at TEXT NOT NULL,status TEXT NOT NULL,details TEXT)',
'CREATE TABLE IF NOT EXISTS meetings(id TEXT PRIMARY KEY,lead_id TEXT NOT NULL REFERENCES leads(id),start_at TEXT UNIQUE NOT NULL,notes TEXT DEFAULT "",status TEXT NOT NULL DEFAULT "SCHEDULED",created_at TEXT NOT NULL)',
'CREATE TABLE IF NOT EXISTS production_requests(id TEXT PRIMARY KEY,lead_id TEXT NOT NULL UNIQUE REFERENCES leads(id),status TEXT NOT NULL,offer_job_id TEXT UNIQUE,delivery_job_id TEXT UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,accepted_at TEXT,due_at TEXT,site_url TEXT,delivered_at TEXT)',
'CREATE TABLE IF NOT EXISTS owner_notices(id TEXT PRIMARY KEY,unique_key TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,lead_id TEXT,message TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,error TEXT)',
'CREATE TABLE IF NOT EXISTS contact_cadence(phone TEXT PRIMARY KEY,lead_id TEXT NOT NULL REFERENCES leads(id),first_contact_at TEXT NOT NULL,last_contact_at TEXT NOT NULL,next_contact_at TEXT NOT NULL,total_approaches INTEGER NOT NULL DEFAULT 1)',
'CREATE INDEX IF NOT EXISTS idx_cadence_next ON contact_cadence(next_contact_at)'
];
for(const sql of tables)db.exec(sql);
// Migração compatível: múltiplas automações por segmento sem perder fluxos antigos.
const workflowColumns=db.prepare('PRAGMA table_info(workflows)').all().map(c=>c.name);
if(!workflowColumns.includes('segments_json'))db.exec("ALTER TABLE workflows ADD COLUMN segments_json TEXT NOT NULL DEFAULT '[]'");
if(!workflowColumns.includes('enabled'))db.exec('ALTER TABLE workflows ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1');
// Envios interrompidos por queda devem ir para revisão; NUNCA repetir automaticamente.
run("UPDATE jobs SET status='UNKNOWN',error='Processo interrompido',updated_at=? WHERE status='SENDING'",new Date().toISOString());
run("UPDATE executions SET state='NEEDS_REVIEW' WHERE state='SENDING'");
run("UPDATE owner_notices SET status='UNKNOWN',error='Processo interrompido' WHERE status='SENDING'");
run("UPDATE production_requests SET status='NEEDS_REVIEW',updated_at=? WHERE status IN ('OFFER_QUEUED','SEND_QUEUED') AND (offer_job_id IN (SELECT id FROM jobs WHERE status='UNKNOWN') OR delivery_job_id IN (SELECT id FROM jobs WHERE status='UNKNOWN'))",now());
const initialSteps=[{id:'a',type:'message',text:'Olá, {{business_name}}! Tudo bem?'},{id:'b',type:'wait_reply'},{id:'c',type:'end'}];
if(!one('SELECT id FROM workflows LIMIT 1'))run('INSERT INTO workflows(id,name,is_default,version,steps,created_at,updated_at) VALUES(?,?,?,?,?,?,?)','default','Abordagem padrão',1,1,JSON.stringify(initialSteps),now(),now());
export function getSetting(key,fallback=null){const x=one('SELECT value FROM settings WHERE key=?',key);if(!x)return fallback;try{return JSON.parse(x.value);}catch{return fallback;}}
export function setSetting(key,value){run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,JSON.stringify(value));}
for(const [key,value] of Object.entries({paused:true,auto_initial:false,min_minutes:5,daily_limit:150,business_start:8,business_end:18,initial_interval_seconds:240,discovery_target_daily:150,discovery_start_hour:5,autonomous_campaign_id:'',automation_enabled:true,segments:'psicólogo,nutricionista,massoterapeuta,quiropraxista,fisioterapeuta,esteticista,clínica,estética,advogado,arquiteto',cities:'Sorocaba,Votorantim,Campinas',discovery_auto_enabled:true,discovery_sources:{osm:true,web_search:true,cnpj:true,cnes:true,meta_ads:false,instagram_search:false,instagram_hashtags:false,instagram_related:false},discovery_priority:'no_website',discovery_brazil_wide:false,score_weights:{noWebsite:4,activeAd:3,publicWhatsapp:2,activeBusiness:2,prioritySegment:2,location:1,businessName:1},owner_phone_a:'',owner_phone_b:'',owner_notifications_enabled:false,owner_report_hour:20,campaign_offer_expiry:'',campaign_offer_price:350}))if(!one('SELECT key FROM settings WHERE key=?',key))setSetting(key,value);
// O operador solicitou explicitamente o novo teto e janela. Aplicação única e auditável.
if(!getSetting('outreach_200_rollout_applied',false)){
 for(const [key,value] of Object.entries({daily_limit:200,business_start:12,business_end:18,initial_interval_seconds:108}))setSetting(key,value);
 setSetting('outreach_200_rollout_applied',true);
}
// Atualização solicitada em 15/10: mantém estado de pausa, sem iniciar disparos na implantação.
if(!getSetting('prospector_150_rollout_applied',false)){
 for(const [key,value] of Object.entries({daily_limit:150,business_start:8,business_end:18,initial_interval_seconds:240,discovery_target_daily:150,auto_initial:true,autonomous_campaign_id:'',discovery_auto_enabled:true,today_start_override:{day:'2026-10-15',hour:12}}))setSetting(key,value);
 setSetting('prospector_150_rollout_applied',true);
}
// Descoberta a partir das 05h (independente da pausa das abordagens).
// Abordagens continuam das 08h às 18h. Aplica uma vez, preservando pausa do envio.
if(!getSetting('discovery_5am_outreach_8am_v1',false)){
 for(const [key,value] of Object.entries({
  discovery_start_hour:5,discovery_target_daily:150,discovery_auto_enabled:true,
  business_start:8,business_end:18,daily_limit:150,initial_interval_seconds:240,
  today_start_override:null
 }))setSetting(key,value);
 setSetting('discovery_5am_outreach_8am_v1',true);
}
// Rascunho persistente da campanha Consecom; não cria mídias nem inicia envios.
if(!getSetting('consecom_350_seeded_v1',false)){
 const existing=one('SELECT id FROM workflows WHERE name=? ORDER BY updated_at DESC LIMIT 1','Consecom | Site profissional R$ 350 | Áudio + vídeo');
 if(existing){setSetting('consecom_campaign_seed_id',existing.id);}
 else{
  const workflowId=id();
  run('INSERT INTO workflows(id,name,is_default,version,steps,created_at,updated_at,segments_json,enabled) VALUES(?,?,?,?,?,?,?,?,?)',
   workflowId,'Consecom | Site profissional R$ 350 | Áudio + vídeo',0,1,"[{\"id\":\"a\",\"type\":\"message\",\"text\":\"Olá, tudo bem? Aqui é da Consecom, de Sorocaba. A gente conheceu o trabalho de vocês e gostaria de apresentar uma proposta para um site profissional. Posso te enviar um áudio explicando e um vídeo de alguns projetos?\"},{\"id\":\"b\",\"type\":\"wait_reply\"},{\"id\":\"c\",\"type\":\"delay\",\"seconds\":45},{\"id\":\"d\",\"type\":\"audio\",\"media_id\":\"\",\"description\":\"Áudio original gravado pelo Wesley, da Consecom. Apresenta a agência de sites em Sorocaba, seleção de empresas, proposta de site completo por R$ 350 com 80% de desconto, portfólio mediante permissão e entrega em até três dias; pede para ver vídeo e informar se tem interesse.\"},{\"id\":\"e\",\"type\":\"video\",\"media_id\":\"\"},{\"id\":\"f\",\"type\":\"wait_reply\"},{\"id\":\"g\",\"type\":\"decision\",\"context\":\"general_interest\",\"context_description\":\"Após o áudio e o vídeo, o profissional decide se quer contratar o site profissional por R$ 350.\",\"yes_type\":\"message\",\"yes_text\":\"\",\"yes_action\":\"handover\",\"no_type\":\"message\",\"no_text\":\"Sem problemas! Muito obrigado pelo retorno. Ficamos à disposição.\",\"no_action\":\"end\"},{\"id\":\"h\",\"type\":\"end\"}]",now(),now(),'[]',0);
  setSetting('consecom_campaign_seed_id',workflowId);
 }
 setSetting('consecom_350_seeded_v1',true);
}
// V2: atualiza rascunho e campanha ativa para novos contatos, preservando mídias,
// o status ativo/desativado e execuções já em andamento (snapshots históricos).
if(!getSetting('consecom_350_flow_v2',false)){
 const candidates=[getSetting('autonomous_campaign_id',''),getSetting('campaign_bundle_workflow',''),getSetting('consecom_campaign_seed_id','')].filter(Boolean);
 let workflow=null;
 for(const candidate of candidates){
  const item=one('SELECT * FROM workflows WHERE id=?',candidate);
  if(item?.name===CAMPAIGN_NAME){workflow=item;break;}
 }
 if(!workflow)workflow=one('SELECT * FROM workflows WHERE name=? ORDER BY enabled DESC,updated_at DESC LIMIT 1',CAMPAIGN_NAME);
 if(workflow){
  const upgraded=buildConsecomSteps({existingSteps:JSON.parse(workflow.steps)});
  run('UPDATE workflows SET steps=?,version=version+1,updated_at=? WHERE id=?',JSON.stringify(upgraded),now(),workflow.id);
  setSetting('consecom_campaign_seed_id',workflow.id);
 }
 setSetting('consecom_350_flow_v2',true);
}
// V3: altera apenas a abordagem de novas execuções da campanha Consecom.
// Preserva mídias, tempos, seleção, pausa e snapshots das conversas já abertas.
if(!getSetting('consecom_350_intro_v3',false)){
 tx(()=>{
  const candidates=[getSetting('autonomous_campaign_id',''),getSetting('campaign_bundle_workflow',''),getSetting('consecom_campaign_seed_id','')].filter(Boolean);
  let workflow=candidates.map(candidate=>one('SELECT * FROM workflows WHERE id=?',candidate)).find(item=>item?.name===CAMPAIGN_NAME);
  if(!workflow)workflow=one('SELECT * FROM workflows WHERE name=? ORDER BY enabled DESC,updated_at DESC LIMIT 1',CAMPAIGN_NAME);
  if(workflow){
   const steps=JSON.parse(workflow.steps);
   if(steps[0]?.type!=='message')throw Error('Campanha Consecom sem mensagem inicial');
   steps[0].text=CAMPAIGN_INTRO;
   run('UPDATE workflows SET steps=?,version=version+1,updated_at=? WHERE id=?',JSON.stringify(steps),now(),workflow.id);
  }
  setSetting('consecom_350_intro_v3',true);
 });
}
export function audit(action,lead_id=null,detail={}){run('INSERT INTO audit VALUES(?,?,?,?,?)',id(),now(),action,lead_id,JSON.stringify(detail));}
export function addLead(item){
 const p=phone(item.phone||item.whatsapp), ig=instagram(item.instagram||item.instagram_username);
 if(!p&&!ig&&!(String(item.source)==='osm'&&String(item.osm_id||'').startsWith('https://www.openstreetmap.org/'))&&!(['cnpj','cnes'].includes(String(item.source))&&String(item.official_id||'').startsWith(String(item.source)+':')))throw Error('Informe Instagram ou WhatsApp válido');
 const existing=(p?one('SELECT * FROM leads WHERE phone=?',p):null)||(ig?one('SELECT * FROM leads WHERE instagram=?',ig):null)||(item.osm_id?one("SELECT l.* FROM leads l JOIN lead_origins o ON o.lead_id=l.id WHERE o.source='osm' AND o.identity=?",item.osm_id):null)||(item.official_id?one('SELECT l.* FROM leads l JOIN lead_origins o ON o.lead_id=l.id WHERE o.source=? AND o.identity=?',String(item.source),String(item.official_id)):null);
 if(existing){
  const suppliedName=personalName(item.name||item.contato_nome||item.contact_name);
  if(!personalName(existing.name)&&suppliedName){
   run('UPDATE leads SET name=?,last_seen_at=? WHERE id=?',suppliedName,now(),existing.id);
   audit('LEAD_NAME_IDENTIFIED',existing.id,{source:String(item.source||'MANUAL')});
  }else run('UPDATE leads SET last_seen_at=? WHERE id=?',now(),existing.id);
  return {lead:one('SELECT * FROM leads WHERE id=?',existing.id),created:false};
 }
 const leadId=id();
 run('INSERT INTO leads(id,name,business,instagram,phone,segment,city,website,website_status,source,contact_permission,created_at,last_seen_at,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',leadId,item.name||item.contato_nome||item.contact_name||null,String(item.business||item.empresa||item.business_name||ig||p).trim(),ig,p,item.segment||item.segmento||null,item.city||item.cidade||null,item.website||item.site||null,item.website_status||item.status_site||'UNCERTAIN',item.source||item.origem||'MANUAL',item.contact_permission===true?1:0,now(),now(),item.notes||item.observ||'');
 audit('LEAD_CREATED',leadId,{source:item.source||'MANUAL'});
 return {lead:one('SELECT * FROM leads WHERE id=?',leadId),created:true};
}
export function getThread(leadId,jid=null){
 let t=one('SELECT * FROM threads WHERE lead_id=?',leadId);
 if(t){if(jid&&!t.jid)run('UPDATE threads SET jid=? WHERE id=?',jid,t.id);return one('SELECT * FROM threads WHERE id=?',t.id);}
 const tId=id();run('INSERT INTO threads(id,lead_id,jid,created_at) VALUES(?,?,?,?)',tId,leadId,jid,now());return one('SELECT * FROM threads WHERE id=?',tId);
}
export function addMessage({threadId,providerId=null,direction,type='text',body='',mediaId=null,status='received'}){
 if(providerId&&one('SELECT id FROM messages WHERE provider_id=?',providerId))return null;
 const msgId=id(),at=now();
 run('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)',msgId,threadId,providerId,direction,type,body,mediaId,status,at);
 run('UPDATE threads SET last_message_at=?,unread_count=unread_count+? WHERE id=?',at,direction==='in'?1:0,threadId);
 const t=one('SELECT lead_id FROM threads WHERE id=?',threadId);
 run('UPDATE leads SET last_activity_at=? WHERE id=?',at,t.lead_id);
 return one('SELECT * FROM messages WHERE id=?',msgId);
}
export function stage(leadId,to,reason='manual'){run('UPDATE leads SET stage=?,last_activity_at=? WHERE id=?',to,now(),leadId);audit('STAGE',leadId,{to,reason});}
export function suppressed(p){const n=phone(p);return !n||!!one('SELECT phone FROM suppressions WHERE phone=?',n);}
export function stopLead(leadId,reason){
 const lead=one('SELECT * FROM leads WHERE id=?',leadId);if(!lead)return;
 if(lead.phone)run('INSERT OR IGNORE INTO suppressions VALUES(?,?,?)',lead.phone,reason,now());
 run("UPDATE jobs SET status='CANCELLED',updated_at=? WHERE lead_id=? AND status='PENDING'",now(),leadId);
 run("UPDATE executions SET state='CANCELLED',updated_at=? WHERE lead_id=?",now(),leadId);
 stage(leadId,'NO_INTEREST',reason);
}
