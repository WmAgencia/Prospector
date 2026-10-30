import {db,one,run,now} from './db.mjs';
import {verifiedOwnerPhone,hasExistingClientRelationship} from './whatsapp-roles.mjs';
import {documentedOptIn} from './outreach-queue.mjs';
// Operator instruction for one outreach cycle. This table never changes consent.
db.exec('CREATE TABLE IF NOT EXISTS operator_outreach_selections(item_id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,lead_id TEXT NOT NULL,approved_at TEXT NOT NULL)');
if(!db.prepare('PRAGMA table_info(operator_outreach_selections)').all().some(c=>c.name==='offer_type'))db.exec("ALTER TABLE operator_outreach_selections ADD COLUMN offer_type TEXT NOT NULL DEFAULT 'portfolio'");
export function recordOperatorSelection({itemId,batchId,leadId,offerType='portfolio'}){
 run('INSERT INTO operator_outreach_selections(item_id,batch_id,lead_id,approved_at,offer_type) VALUES(?,?,?,?,?)',itemId,batchId,leadId,now(),offerType);
}
export function operatorOffer(leadId){
 if(!one("SELECT name FROM sqlite_master WHERE type='table' AND name='prospecting_batch_items'"))return null;
 return one('SELECT s.offer_type FROM prospecting_batch_items i JOIN operator_outreach_selections s ON s.item_id=i.id WHERE i.lead_id=? ORDER BY i.rowid DESC LIMIT 1',leadId)?.offer_type||null;
}
export function operatorSelected(leadId){
 if(!one("SELECT name FROM sqlite_master WHERE type='table' AND name='prospecting_batch_items'"))return false;
 const latest=one('SELECT rowid,* FROM prospecting_batch_items WHERE lead_id=? ORDER BY rowid DESC LIMIT 1',leadId);
 if(!latest||!['QUEUED','SENDING','SENT'].includes(latest.status))return false;
 return !!one('SELECT 1 FROM operator_outreach_selections WHERE item_id=? AND batch_id=? AND lead_id=?',latest.id,latest.batch_id,leadId);
}
export function conversationAuthorized(leadId,{ignoreTakeover=false}={}){
 const lead=one('SELECT phone,stage FROM leads WHERE id=?',leadId);
 if(!lead||!lead.phone||lead.phone===verifiedOwnerPhone()||hasExistingClientRelationship(lead.phone)||one('SELECT 1 FROM suppressions WHERE phone=?',lead.phone)||(!ignoreTakeover&&one('SELECT 1 FROM threads WHERE lead_id=? AND manual_takeover=1',leadId))||['NO_INTEREST','INTERESTED','CLOSED_WON'].includes(lead.stage))return false;
 if(documentedOptIn(leadId))return true;
 if(!operatorSelected(leadId))return false;
 const latest=one('SELECT * FROM prospecting_batch_items WHERE lead_id=? ORDER BY rowid DESC LIMIT 1',leadId);
 if(latest.status!=='SENT'||latest.phone!==lead.phone)return false;
 const greeting=one("SELECT m.rowid,m.at,m.thread_id FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.lead_id=? AND m.provider_id=? AND m.direction='out'",leadId,'prospect-queue:'+latest.id);
 if(!greeting)return false;
 return !!one("SELECT 1 FROM messages WHERE thread_id=? AND direction='in' AND rowid>? AND at>=? LIMIT 1",greeting.thread_id,greeting.rowid,greeting.at);
}
