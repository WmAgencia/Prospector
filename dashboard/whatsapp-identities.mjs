import {db,one,run,phone} from './db.mjs';
db.exec('CREATE TABLE IF NOT EXISTS whatsapp_peer_aliases(jid TEXT PRIMARY KEY,lead_id TEXT NOT NULL REFERENCES leads(id),verified_at TEXT NOT NULL)');
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
