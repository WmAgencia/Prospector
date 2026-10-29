// Groq assistant for inbound 1:1 conversations only. Hot leads silently
// transfer to the operator; never sends an extra response on handoff.
import {db,one,all,run,id,tx,now,stage,addMessage,audit} from './db.mjs';
import {aiDraft} from './ai-groq.mjs';
import {explicitInterest,qualifyWithGroq} from './groq-interest-check.mjs';
import {queueNotice} from './notifications.mjs';
import {waControlStatus,waRequest,selectedWaSession} from './waakg-control.mjs';
db.exec("CREATE TABLE IF NOT EXISTS groq_auto_events(provider_id TEXT PRIMARY KEY,jid TEXT NOT NULL,state TEXT NOT NULL,at TEXT NOT NULL,error TEXT)");
run("UPDATE groq_auto_events SET state='UNKNOWN',error='Interrupted; verify before retry' WHERE state IN ('PROCESSING','SENDING')");
const digits=s=>String(s||'').replace(/\D/g,'');
const optedOut=s=>/\b(pare|parar|stop|sair|remover|nao me contate|não me contate|sem interesse|nao tenho interesse)\b/i.test(String(s||''));
export function ownerTarget(){const raw=digits(process.env.PROSPECTOR_HOT_LEAD_PHONE);const val=raw.length===11?'55'+raw:raw;return /^55\d{10,11}$/.test(val)?val:null;}
export function agentStatus(){return {enabled:process.env.AI_CONVERSATION_AUTOSEND==='true',ownerConfigured:!!ownerTarget(),ownerLastFour:(ownerTarget()||'').slice(-4),inboundOnly:true};}
export function queueInboundTurn({providerId,jid}={}){
 if(process.env.AI_CONVERSATION_AUTOSEND!=='true'||!providerId||!/^\d{12,15}@s\.whatsapp\.net$/.test(jid||''))return false;
 return run("INSERT OR IGNORE INTO groq_auto_events(provider_id,jid,state,at) VALUES(?,?,?,?)",providerId,jid,'PENDING',now()).changes>0;
}
const active=new Set();
export async function handleSalesTurn(providerId,deps={}){
 const r=one("SELECT e.*,i.body,i.state inbox_state,i.lead_id,i.session_id,l.business,l.phone,l.stage,t.id thread_id,t.manual_takeover FROM groq_auto_events e JOIN waakg_inbox i ON i.provider_id=e.provider_id JOIN leads l ON l.id=i.lead_id JOIN threads t ON t.lead_id=l.id WHERE e.provider_id=? AND e.state='PENDING'",providerId);
 if(!r)return {state:'SKIP'};
 const finish=(status,error='')=>{run('UPDATE groq_auto_events SET state=?,error=? WHERE provider_id=?',status,error,providerId);return {state:status};};
 if(process.env.AI_CONVERSATION_AUTOSEND!=='true')return finish('DISABLED');
 if(r.session_id!==selectedWaSession())return finish('SKIPPED','SESSION');
 if(r.phone===ownerTarget()||r.phone===digits(process.env.GROQ_OWNER_WHATSAPP))return finish('SKIPPED','OWNER');
 if(optedOut(r.body)||one('SELECT phone FROM suppressions WHERE phone=?',r.phone))return finish('SKIPPED','OPTOUT');
 if(['INTERESTED','NO_INTEREST','CLOSED_WON'].includes(r.stage))return finish('SKIPPED','ALREADY_HANDOFF');
 run("UPDATE groq_auto_events SET state='PROCESSING' WHERE provider_id=?",providerId);
 const history=all("SELECT direction,body FROM messages WHERE thread_id=? ORDER BY at DESC LIMIT 8",r.thread_id).reverse().map(m=>(m.direction==='in'?'Cliente: ':'Consecom: ')+String(m.body||'').slice(0,220)).join('\n');
 const qualify=deps.qualify||qualifyWithGroq;
 const interest=await qualify({text:r.body,history});
 if(interest.confirmed){
  tx(()=>{
   if(one('SELECT manual_takeover FROM threads WHERE id=?',r.thread_id)?.manual_takeover!==1){
    stage(r.lead_id,'INTERESTED','GROQ_REAL_INTEREST');
    run('UPDATE threads SET manual_takeover=1 WHERE id=?',r.thread_id);
    queueNotice('groq-hot:'+r.lead_id,'GROQ_HOT_LEAD',
     '⭐ *Interesse real no Prospector*\nEmpresa: '+r.business+'\nConversa: https://wa.me/'+r.phone+'\nTrecho de interesse: '+String(interest.evidence||'Intenção confirmada').slice(0,130)+'\nContinue o atendimento pessoalmente.',r.lead_id);
    audit('GROQ_INTEREST_ALERT_QUEUED',r.lead_id,{model:'groq',confidence:interest.confidence});
   }
  });
  return finish('HOT');
 }
 // An apparent commitment which the model cannot verify is left for review.
 if(explicitInterest(r.body))return finish('REVIEW','UNCERTAIN_INTEREST');
 if(r.inbox_state!=='REVIEW'||r.manual_takeover)return finish('HANDOFF');
 if(one("SELECT provider_id FROM waakg_inbox WHERE jid=? ORDER BY rowid DESC LIMIT 1",r.jid)?.provider_id!==providerId)return finish('SUPERSEDED');
 const wa=deps.status?await deps.status():await waControlStatus(),session=selectedWaSession()||wa.sessionId;
 if(!wa.connected||!session)return finish('REVIEW','WA_OFFLINE');
 const draft=await (deps.draft||aiDraft)({text:r.body,context:history});
 if(!draft.ok||!draft.draft)return finish('REVIEW','GROQ_UNAVAILABLE');
 if(one('SELECT manual_takeover FROM threads WHERE id=?',r.thread_id)?.manual_takeover===1||one('SELECT phone FROM suppressions WHERE phone=?',r.phone))return finish('HANDOFF');
 if(one("SELECT provider_id FROM waakg_inbox WHERE jid=? ORDER BY rowid DESC LIMIT 1",r.jid)?.provider_id!==providerId)return finish('SUPERSEDED');
 run("UPDATE groq_auto_events SET state='SENDING' WHERE provider_id=?",providerId);
 try{
  const send=deps.send||waRequest;
  const ack=await send('/api/messages/'+encodeURIComponent(session)+'/'+encodeURIComponent(r.jid)+'/send',{method:'POST',data:{message:{text:draft.draft}}});
  if(ack.status!==true)return finish('UNKNOWN','UNCONFIRMED');
  addMessage({threadId:r.thread_id,providerId:'groq:'+providerId,direction:'out',body:draft.draft,status:'sent'});
  audit('GROQ_AUTOMATED_INBOUND_REPLY',r.lead_id,{inbound:true});
  return finish('SENT');
 }catch{return finish('UNKNOWN','TRANSPORT_UNCERTAIN');}
}
let workerBusy=false;
export async function tickSalesAgent(deps={}){
 if(workerBusy)return {status:'BUSY'};
 workerBusy=true;
 try{
  const queue=all("SELECT provider_id,jid FROM groq_auto_events WHERE state='PENDING' ORDER BY at LIMIT 12");
  const candidates=queue.filter(x=>!active.has(x.jid)).slice(0,4);
  for(const row of candidates)active.add(row.jid);
  const outcomes=await Promise.all(candidates.map(x=>handleSalesTurn(x.provider_id,deps).catch(()=>({state:'ERROR'})).finally(()=>active.delete(x.jid))));
  return {status:'OK',processed:outcomes.length,states:outcomes.map(x=>x.state)};
 }finally{workerBusy=false;}
}
let notifying=false;
export async function flushInterestAlerts(deps={}){
 const target=ownerTarget();if(!target||notifying)return 0;
 notifying=true;
 try{
  const wa=deps.status?await deps.status():await waControlStatus(),session=selectedWaSession()||wa.sessionId;
  if(!wa.connected||!session)return 0;
  let delivered=0;
  for(const entry of all("SELECT * FROM owner_notices WHERE kind='GROQ_HOT_LEAD' AND status='PENDING' ORDER BY created_at LIMIT 5")){
   if(!run("UPDATE owner_notices SET status='SENDING',updated_at=? WHERE id=? AND status='PENDING'",now(),entry.id).changes)continue;
   try{
    const send=deps.send||waRequest;
    const ack=await send('/api/messages/'+encodeURIComponent(session)+'/'+encodeURIComponent(target+'@s.whatsapp.net')+'/send',{method:'POST',data:{message:{text:entry.message}}});
    if(ack.status!==true)throw Error('UNCONFIRMED');
    run("UPDATE owner_notices SET status='SENT',updated_at=? WHERE id=?",now(),entry.id);
    audit('GROQ_HOT_LEAD_ALERT_SENT',entry.lead_id,{owner:true});delivered++;
   }catch{run("UPDATE owner_notices SET status='UNKNOWN',updated_at=?,error=? WHERE id=?",now(),'Unknown delivery, do not automatically retry',entry.id);}
  }
  return delivered;
 }finally{notifying=false;}
}
