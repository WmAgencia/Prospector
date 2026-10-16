import {db,one,run,phone} from './db.mjs';
import {personalName,renderTemplate} from './classifier.mjs';
db.exec('CREATE TABLE IF NOT EXISTS whatsapp_peer_aliases(jid TEXT PRIMARY KEY,lead_id TEXT NOT NULL REFERENCES leads(id),verified_at TEXT NOT NULL)');
db.exec('CREATE TABLE IF NOT EXISTS whatsapp_peer_names(jid TEXT PRIMARY KEY,name TEXT NOT NULL,source TEXT NOT NULL)');
export function captureContactNames(contacts){
 for(const contact of contacts||[]){
  const savedName=personalName(contact.name),name=savedName||personalName(contact.notify);
  if(!name)continue;
  for(const jid of new Set([contact.id,contact.jid,contact.lid].filter(Boolean))){
   if(!/^\d+(?::\d+)?@(?:lid|s\.whatsapp\.net)$/.test(jid))continue;
   const previous=one('SELECT source FROM whatsapp_peer_names WHERE jid=?',jid);
   if(!savedName&&previous?.source==='WHATSAPP_CONTACT')continue;
   run('INSERT OR REPLACE INTO whatsapp_peer_names VALUES(?,?,?)',jid,name,savedName?'WHATSAPP_CONTACT':'WHATSAPP_PROFILE');
  }
 }
}
export function applyKnownContactName(leadId){
 const lead=one('SELECT * FROM leads WHERE id=?',leadId);if(!lead)return null;
 if(personalName(lead.name))return lead;
 const candidate=one(`SELECT n.name FROM whatsapp_peer_names n WHERE n.jid=?
  OR n.jid IN (SELECT jid FROM whatsapp_peer_aliases WHERE lead_id=?)
  ORDER BY CASE WHEN n.source='WHATSAPP_CONTACT' THEN 0 ELSE 1 END LIMIT 1`,lead.phone+'@s.whatsapp.net',lead.id);
 const name=personalName(candidate?.name,lead.business);
 if(name){run('UPDATE leads SET name=? WHERE id=?',name,lead.id);return {...lead,name};}
 return lead;
}
export function resolveLead(message){
 const key=message.key||{},from=key.remoteJid||'';
 const sender=[key.remoteJidAlt,key.senderPn,from].find(jid=>jid?.endsWith('@s.whatsapp.net'));
 const number=sender?phone(sender.split(':')[0].split('@')[0]):null;
 const byPhone=number?one('SELECT * FROM leads WHERE phone=?',number):null;
 const byAlias=one('SELECT l.* FROM whatsapp_peer_aliases a JOIN leads l ON l.id=a.lead_id WHERE a.jid=?',from);
 // A conflicting identity is not safe to route automatically.
 if(byPhone&&byAlias&&byPhone.id!==byAlias.id)return {conflict:true};
 const lead=byPhone||byAlias||null;
 if(lead&&byPhone&&from.endsWith('@lid'))registerPeerAlias(lead.id,from);
 return {lead,number,from};
}
export function registerPeerAlias(leadId,jid){
 if(!/^\d+(?::\d+)?@(?:lid|s\.whatsapp\.net)$/.test(String(jid)))return false;
 const existing=one('SELECT lead_id FROM whatsapp_peer_aliases WHERE jid=?',jid);
 if(existing&&existing.lead_id!==leadId)throw Error('Identificador WhatsApp já vinculado a outro contato');
 run('INSERT OR REPLACE INTO whatsapp_peer_aliases VALUES(?,?,?)',jid,leadId,new Date().toISOString());
 return true;
}

export function verifiedDeliveryAddress(lead){
 const lid=one("SELECT jid FROM whatsapp_peer_aliases WHERE lead_id=? AND jid LIKE '%@lid' ORDER BY verified_at DESC LIMIT 1",lead.id);
 return lid?.jid||(lead.phone?lead.phone+'@s.whatsapp.net':null);
}

export function refreshInitialGreeting(job,lead){
 const updated=applyKnownContactName(lead.id)||lead;
 if(job.step_index===0&&job.execution_id&&job.type==='message'){
  const execution=one('SELECT steps FROM executions WHERE id=?',job.execution_id);
  const first=execution?JSON.parse(execution.steps)[0]:null;
  if(first?.type==='message'){
   const text=renderTemplate(first.text,updated);
   if(text!==job.text){run('UPDATE jobs SET text=? WHERE id=?',text,job.id);job.text=text;}
  }
 }
 return updated;
}
