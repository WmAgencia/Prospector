// Migração local do projeto legado em D:\Prospector\data.
// Não acessa WhatsApp, não dispara mensagens e não publica dados no Git.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {addLead,one,run,id,now,phone,stage,getThread,addMessage,audit} from './db.mjs';
const input=process.argv[2];
if(!input){console.error('Uso: node dashboard/import-legacy.mjs "D:\\Prospector\\data"');process.exit(2);}
const directory=path.resolve(input);
if(!fs.statSync(directory,{throwIfNoEntry:false})?.isDirectory())throw Error('Pasta de origem inexistente');
const stats={prospects:0,duplicates:0,alreadyContacted:0,suppressions:0,messages:0,skipped:0};
const mapping=new Map();
function lines(name){
 const p=path.join(directory,name);if(!fs.existsSync(p))return [];
 return fs.readFileSync(p,'utf8').split(/\r?\n/).filter(Boolean).flatMap(s=>{try{return [JSON.parse(s)];}catch{stats.skipped++;return [];}});
}
function normalize(p){return phone(p);}
function existingByPhone(p){const n=normalize(p);return n?one('SELECT * FROM leads WHERE phone=?',n):null;}
function obtain(s){
 const oldId=s.prospect_id||s.id||null;
 let lead=(oldId&&mapping.get(String(oldId)))||existingByPhone(s.to||s.whatsapp||s.phone);
 if(lead)return lead;
 const p=normalize(s.to||s.whatsapp||s.phone);
 if(!p)return null;
 try{return addLead({business:s.empresa||s.lead_nome||s.business||p,phone:p,source:'LEGACY_IMPORT'}).lead;}
 catch{return existingByPhone(p);}
}
// Contatos conhecidos entram primeiro, sem disparar nada.
for(const item of lines('prospects.jsonl')){
 try{
  const result=addLead(item);if(result.created)stats.prospects++;else stats.duplicates++;
  if(item.id)mapping.set(String(item.id),result.lead);
  if(item.status==='INTERESSADO'||item.status==='INTERESTED')stage(result.lead.id,'INTERESTED','migração');
 }catch(e){stats.skipped++;console.warn('Lead ignorado:',e.message);}
}
// Qualquer mensagem legada enviada impede uma nova primeira abordagem.
for(const sent of lines('sent.jsonl')){
 const lead=obtain(sent);if(!lead||!lead.phone){stats.skipped++;continue;}
 const existing=one('SELECT lead_id FROM initial_contacts WHERE phone=? OR lead_id=?',lead.phone,lead.id);
 if(!existing){
  try{
   const jid=id();
   run("INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,'SENT',?,?)",lead.id,lead.phone,jid,now());
   stats.alreadyContacted++;
  }catch(e){stats.skipped++;console.warn('Ledger já existente:',e.message);}
 }
 if(lead.stage==='DISCOVERED')stage(lead.id,'CONTACTED','mensagem legada');
 if(sent.text){
  try{
   const thread=getThread(lead.id);
   const msg=addMessage({threadId:thread.id,providerId:sent.message_id||null,direction:'out',type:'text',body:sent.text,status:'legacy'});
   if(msg)stats.messages++;
  }catch(e){stats.skipped++;}
 }
}
// Bloqueios do usuário: preservar a lista do bot antigo.
let dnc=[];try{dnc=JSON.parse(fs.readFileSync(path.join(directory,'do-not-contact.json'),'utf8'));}catch{}
for(const item of (Array.isArray(dnc)?dnc:[])){
 const p=normalize(typeof item==='string'?item:item.phone||item.to);
 if(!p)continue;
 run('INSERT OR IGNORE INTO suppressions(phone,reason,created_at) VALUES(?,?,?)',p,item.motivo||item.reason||'LEGACY_DNC',now());stats.suppressions++;
 const lead=existingByPhone(p);if(lead)stage(lead.id,'NO_INTEREST','lista legada de não contato');
}
for(const item of lines('optout.jsonl')){
 const p=normalize(item.phone||item.from);
 if(!p)continue;
 run('INSERT OR IGNORE INTO suppressions(phone,reason,created_at) VALUES(?,?,?)',p,item.categoria||'LEGACY_OPT_OUT',now());stats.suppressions++;
 const lead=existingByPhone(p);if(lead)stage(lead.id,'NO_INTEREST','opt-out legado');
}
// Mensagens recebidas históricas: somente os vínculos identificáveis por número.
for(const item of lines('inbox.jsonl')){
 const lead=existingByPhone(item.jidAlt||item.from);
 if(!lead)continue;
 try{
  const thread=getThread(lead.id);
  const msg=addMessage({threadId:thread.id,providerId:item.id||null,direction:'in',type:item.type||'text',body:item.text||'',status:'legacy'});
  if(msg)stats.messages++;
 }catch{stats.skipped++;}
}
audit('LEGACY_IMPORT',null,stats);
console.log(JSON.stringify(stats,null,2));
