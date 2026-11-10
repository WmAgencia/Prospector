// Durable terminal state for Consecom outbound conversations. Once the
// assistant has sent its polite final goodbye, no later inbound restarts AI.
// Manual owner messages and client tenants remain independently controlled.
import {db,one,all,run,now,audit} from './db.mjs';
import {leadSession} from './waakg-session-registry.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS prospect_terminal_conversations (
 lead_id TEXT PRIMARY KEY REFERENCES leads(id),
 session_id TEXT NOT NULL,
 trigger_provider_id TEXT,
 closed_at TEXT NOT NULL,
 reason TEXT NOT NULL
)`);

const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export function isFinalGoodbye(text=''){
 const s=norm(text);
 // Deliberately require BOTH clear acceptance/closure AND an invitation for
 // FUTURE contact; a normal sales CTA ("posso te mostrar?") is NOT terminal.
 return /^(?:entendido|compreendo|sem problemas?|tudo bem|certo|perfeito)(?:[,! .]|$)/.test(s)&&
  /(?:caso|se) (?:precis[ae]|quiser|tiver|surgir|desejar)|(?:quando|no futuro)/.test(s)&&
  /(?:e so chamar|pode chamar|estamos a disposicao|fico a disposicao|so entrar em contato)/.test(s);
}
const ownerOnly=()=>!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true';
export function finishConversation({leadId,sessionId,providerId='',body='',reason='POLITE_FINAL'}={}){
 if(!ownerOnly()||!leadId||!sessionId||!isFinalGoodbye(body))return false;
 if(leadSession(leadId)!==sessionId)return false;
 const saved=run('INSERT OR IGNORE INTO prospect_terminal_conversations(lead_id,session_id,trigger_provider_id,closed_at,reason) VALUES(?,?,?,?,?)',
  leadId,sessionId,String(providerId||'').slice(0,190),now(),reason);
 if(saved.changes){
  // Even already queued turns must be drained, not retried.
  run("UPDATE groq_auto_events SET state='CLOSED',error='CONVERSATION_FINISHED' WHERE provider_id IN (SELECT i.provider_id FROM waakg_inbox i WHERE i.lead_id=?) AND state IN ('PENDING','PROCESSING')",leadId);
  audit('PROSPECT_CONVERSATION_FINISHED',leadId,{sessionId,reason,providerId:String(providerId||'').slice(0,190)});
 }
 return true;
}
export function conversationFinished(leadId,sessionId){
 if(!ownerOnly()||!leadId||!sessionId||leadSession(leadId)!==sessionId)return false;
 const prior=one('SELECT 1 FROM prospect_terminal_conversations WHERE lead_id=? AND session_id=?',leadId,sessionId);
 if(prior)return true;
 // Heal conversations closed by the assistant before this feature existed.
 const messages=all(`SELECT m.body,m.provider_id FROM messages m JOIN threads t ON t.id=m.thread_id
  WHERE t.lead_id=? AND m.direction='out' AND m.status NOT IN ('UNKNOWN','FAILED','PENDING')
    AND (m.provider_id LIKE 'groq:%' OR m.provider_id LIKE 'intro:%')
  ORDER BY m.at DESC,m.rowid DESC LIMIT 30`,leadId);
 const earlier=messages.find(m=>isFinalGoodbye(m.body));
 return earlier?finishConversation({leadId,sessionId,providerId:earlier.provider_id,body:earlier.body,reason:'HISTORICAL_POLITE_FINAL'}):false;
}
export function forgetTerminatedForNewAuthorizedCampaign({leadId,newGreetingId}={}){
 // Called only on a separately authorized, new campaign after the existing
 // 3-month recontact rule. Not triggered by an ordinary inbound message.
 const prior=one('SELECT trigger_provider_id FROM prospect_terminal_conversations WHERE lead_id=?',leadId);
 if(!prior||!newGreetingId)return false;
 return run('DELETE FROM prospect_terminal_conversations WHERE lead_id=?',leadId).changes===1;
}
