// Persistent, idempotent first-greeting / audio-permission text receipts.
// A gateway HTTP 200 only means ACCEPTED; SENT, DELIVERED and READ come
// from the exact WhatsApp message ID or an exact match in gateway history.
// Never infer delivery from an unrelated manual message or resend UNKNOWN.
import {db,one,all,run,now,audit} from './db.mjs';
import {isManagedSession,leadSession} from './waakg-session-registry.mjs';
import {waRequest} from './waakg-control.mjs';
import {queueNotice} from './notifications.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS prospecting_text_receipts(
 lead_id TEXT NOT NULL REFERENCES leads(id),
 greeting_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('GREETING','INTRO')),
 session_id TEXT NOT NULL,
 jid TEXT NOT NULL,
 attempted_at TEXT NOT NULL,
 provider_id TEXT,
 status TEXT NOT NULL,
 checked_at TEXT,
 confirmed_at TEXT,
 delivered_at TEXT,
 read_at TEXT,
 alerted_at TEXT,
 error TEXT,
 PRIMARY KEY(lead_id,greeting_id,kind))`);
db.exec('CREATE INDEX IF NOT EXISTS idx_prospect_text_receipt_status ON prospecting_text_receipts(status,checked_at)');
run("UPDATE prospecting_text_receipts SET status='UNKNOWN',error='Interrupted during network send' WHERE status='SENDING'");
const VALID_ID=/^[\w-]{5,150}$/;
const progressed={SENDING:0,UNKNOWN:0,ACCEPTED:1,SENT:2,DELIVERED:3,READ:4,FAILED:0};
export function textReceipt(leadId,greetingId,kind){
 return one('SELECT * FROM prospecting_text_receipts WHERE lead_id=? AND greeting_id=? AND kind=?',leadId,greetingId,kind)||null;
}
export function reserveTextReceipt({leadId,greetingId,kind,sessionId,jid}={}){
 if(!['GREETING','INTRO'].includes(kind)||!sessionId||!/^\d{10,15}@s\.whatsapp\.net$/.test(jid||'')||
   one('SELECT phone FROM leads WHERE id=?',leadId)?.phone!==jid.split('@')[0]||
   (isManagedSession(sessionId)&&leadSession(leadId)&&leadSession(leadId)!==sessionId))
  throw Error('TEXT_RECEIPT_INVALID_ROUTE');
 if(kind==='GREETING'&&!one("SELECT 1 FROM prospecting_batch_items WHERE id=? AND lead_id=? AND status='SENDING'",greetingId,leadId))
  throw Error('TEXT_GREETING_NOT_RESERVED');
 if(kind==='INTRO'&&!one("SELECT 1 FROM prospecting_introductions WHERE lead_id=? AND greeting_id=? AND stage='SENDING'",leadId,greetingId))
  throw Error('TEXT_INTRO_NOT_RESERVED');
 const inserted=run("INSERT OR IGNORE INTO prospecting_text_receipts(lead_id,greeting_id,kind,session_id,jid,attempted_at,status) VALUES(?,?,?,?,?,?,'SENDING')",
  leadId,greetingId,kind,sessionId,jid,now()).changes;
 if(inserted!==1)throw Error('TEXT_RECEIPT_DUPLICATE_BLOCKED');
 return true;
}
export const extractTextMessageId=response=>{
 const x=response?.data?.key?.id||response?.data?.message?.key?.id||response?.data?.keyId||response?.data?.id||response?.key?.id||'';
 return VALID_ID.test(String(x))?String(x):null;
};
export function acceptTextReceipt({leadId,greetingId,kind,providerId}={}){
 const id=VALID_ID.test(String(providerId||''))?String(providerId):null;
 run("UPDATE prospecting_text_receipts SET provider_id=COALESCE(provider_id,?),status=CASE WHEN status IN ('SENT','DELIVERED','READ') THEN status ELSE 'ACCEPTED' END,error=CASE WHEN ? IS NULL THEN 'Accepted without message ID' ELSE NULL END WHERE lead_id=? AND greeting_id=? AND kind=? AND status IN ('SENDING','UNKNOWN','ACCEPTED','SENT','DELIVERED','READ')",
  id,id,leadId,greetingId,kind);
 return {accepted:true,hasProviderId:!!id};
}
export function unknownTextReceipt({leadId,greetingId,kind,error='TRANSPORT_UNCERTAIN'}={}){
 run("UPDATE prospecting_text_receipts SET status=CASE WHEN status IN ('SENT','DELIVERED','READ') THEN status ELSE 'UNKNOWN' END,error=? WHERE lead_id=? AND greeting_id=? AND kind=?",
  String(error).slice(0,120),leadId,greetingId,kind);
}
function updateReceipt(record,status){
 const next=String(status||'').toUpperCase();
 if(!Object.prototype.hasOwnProperty.call(progressed,next)||next==='SENDING'||next==='ACCEPTED'||next==='UNKNOWN')return false;
 if(progressed[record.status]>=progressed[next]||record.status==='READ')return false;
 // A FAILED status can be transient; retain the record, but never retry.
 const stamp=now();
 run(`UPDATE prospecting_text_receipts SET status=?,confirmed_at=COALESCE(confirmed_at,?),
  delivered_at=CASE WHEN ? IN ('DELIVERED','READ') THEN COALESCE(delivered_at,?) ELSE delivered_at END,
  read_at=CASE WHEN ?='READ' THEN COALESCE(read_at,?) ELSE read_at END,
  error=CASE WHEN ?='FAILED' THEN 'WhatsApp reported FAILED; manual review' ELSE NULL END
  WHERE lead_id=? AND greeting_id=? AND kind=? AND status NOT IN ('READ')`,
  next,stamp,next,stamp,next,stamp,next,record.lead_id,record.greeting_id,record.kind);
 audit('PROSPECT_TEXT_RECEIPT',record.lead_id,{kind:record.kind,status:next,sender:record.session_id});
 return true;
}
export function receiveTextReceiptStatus(payload={}){
 const event=String(payload.event||''),data=payload.data||{};
 if(!['message.sent','message.status'].includes(event))return false;
 const sessionId=String(payload.sessionId||'');
 const msgId=String(data.keyId||data.key?.id||'');
 if(!VALID_ID.test(msgId)||!isManagedSession(sessionId))return false;
 const record=one('SELECT * FROM prospecting_text_receipts WHERE session_id=? AND provider_id=?',sessionId,msgId);
 if(!record)return false;
 const remote=String(data.remoteJid||data.key?.remoteJid||'');
 if(remote&&remote!==record.jid)return false;
 updateReceipt(record,event==='message.sent'?'SENT':data.status);
 return true; // matched echo must not create a false owner manual takeover.
}
function ageMs(t){const n=Number(t);return Number.isFinite(n)&&n>1e11?n:n>1e8?n*1000:(Date.parse(t)||0);}
let reconciling=false;
export async function reconcileTextReceipts({fetchChat=waRequest,limit=5}={}){
 if(reconciling)return {state:'BUSY'};
 reconciling=true;
 try{
  const rows=all("SELECT * FROM prospecting_text_receipts WHERE status NOT IN ('READ') AND attempted_at>=? AND (checked_at IS NULL OR checked_at<?) ORDER BY COALESCE(checked_at,attempted_at) LIMIT ?",
   new Date(Date.now()-7*86400000).toISOString(),new Date(Date.now()-45_000).toISOString(),Math.min(12,Math.max(1,Number(limit)||5)));
  let matched=0,alerts=0;
  for(const r of rows){
   run('UPDATE prospecting_text_receipts SET checked_at=? WHERE lead_id=? AND greeting_id=? AND kind=?',now(),r.lead_id,r.greeting_id,r.kind);
   try{
    if(r.provider_id&&isManagedSession(r.session_id)&&leadSession(r.lead_id)===r.session_id){
     const response=await fetchChat('/api/chat/'+encodeURIComponent(r.session_id)+'/'+encodeURIComponent(r.jid));
     const items=Array.isArray(response?.data)?response.data:[];
     const msg=items.find(x=>x.fromMe===true&&(x.keyId||x.key?.id)===r.provider_id&&String(x.type||'').toUpperCase()==='TEXT');
     if(msg){matched++;if(['SENT','DELIVERED','READ','FAILED'].includes(String(msg.status||'').toUpperCase()))updateReceipt(r,msg.status);}
    }
   }catch{}
   const latest=textReceipt(r.lead_id,r.greeting_id,r.kind)||r;
   const elapsed=Date.now()-ageMs(latest.attempted_at);
   const warn=latest.status==='UNKNOWN'||latest.status==='FAILED'?elapsed>3*60000:
    !['DELIVERED','READ'].includes(latest.status)&&elapsed>15*60000;
   if(!warn||latest.alerted_at)continue;
   const lead=one('SELECT phone,business FROM leads WHERE id=?',r.lead_id);
   if(!lead)continue;
   const message='*Prospector — conferência de '+(r.kind==='GREETING'?'primeira abordagem':'pedido de áudio')+'*\nEmpresa: '+
    String(lead.business).slice(0,90)+'\nTelefone: '+lead.phone+'\nStatus: '+latest.status+
    '\nConversa: https://wa.me/'+lead.phone+
    '\nConfira a mensagem original no WhatsApp. Resultado incerto não autoriza novo disparo.';
   if(queueNotice('text-receipt:'+r.greeting_id+':'+r.kind,'PITCH_DELIVERY_ISSUE',message,r.lead_id)){
    run('UPDATE prospecting_text_receipts SET alerted_at=? WHERE lead_id=? AND greeting_id=? AND kind=?',now(),r.lead_id,r.greeting_id,r.kind);
    alerts++;
   }
  }
  return {state:'OK',checked:rows.length,matched,alerts};
 }finally{reconciling=false;}
}
