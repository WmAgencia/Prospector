import {db,one,all,run,getSetting,setSetting,now} from './db.mjs';
export const validSessionId=id=>/^[a-zA-Z0-9_-]{3,70}$/.test(String(id||''));
export function primarySession(){const id=process.env.WA_AKG_SESSION_ID||getSetting('waakg_primary_session_id','');return validSessionId(id)?id:'';}
db.exec('CREATE TABLE IF NOT EXISTS managed_whatsapp_sessions(session_id TEXT PRIMARY KEY,label TEXT NOT NULL,created_at TEXT NOT NULL)');
db.exec('CREATE TABLE IF NOT EXISTS lead_whatsapp_routes(lead_id TEXT PRIMARY KEY REFERENCES leads(id),session_id TEXT NOT NULL,updated_at TEXT NOT NULL)');
export function managedSessions(){
 const primary=primarySession(),rows=all('SELECT session_id,label FROM managed_whatsapp_sessions ORDER BY rowid');
 return [...(primary?[{session_id:primary,label:'WhatsApp principal'}]:[]),...rows.filter(r=>r.session_id!==primary)];
}
export const isManagedSession=id=>validSessionId(id)&&managedSessions().some(r=>r.session_id===id);
export function registerSession(id,label){
 if(!validSessionId(id))throw Error('Sessão inválida');
 run('INSERT INTO managed_whatsapp_sessions(session_id,label,created_at) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET label=excluded.label',id,String(label||'WhatsApp').trim().slice(0,70),now());
}
const hasTable=name=>!!one("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",name);
export function boundLeadSession(leadId){
 return one('SELECT session_id FROM lead_whatsapp_routes WHERE lead_id=?',leadId)?.session_id||
  (hasTable('prospecting_introductions')?one('SELECT session_id FROM prospecting_introductions WHERE lead_id=?',leadId)?.session_id:'')||
  (hasTable('waakg_inbox')?one('SELECT session_id FROM waakg_inbox WHERE lead_id=? ORDER BY rowid DESC LIMIT 1',leadId)?.session_id:'')||'';
}
export const leadSession=leadId=>boundLeadSession(leadId)||primarySession();
export function bindLeadSession(leadId,sessionId){
 if(!isManagedSession(sessionId))throw Error('Sessão não autorizada');
 run('INSERT INTO lead_whatsapp_routes(lead_id,session_id,updated_at) VALUES(?,?,?) ON CONFLICT(lead_id) DO UPDATE SET session_id=excluded.session_id,updated_at=excluded.updated_at',leadId,sessionId,now());
}
export function nextConnectedSession(order,connected,last){
 const start=order.indexOf(last);
 for(let step=1;step<=order.length;step++){
  const id=order[(start+step)%order.length];
  if(connected.includes(id))return id;
 }
 return '';
}
export const rotationCursor=()=>getSetting('waakg_rotation_last_session_id','');
export const advanceRotation=sessionId=>setSetting('waakg_rotation_last_session_id',sessionId);
