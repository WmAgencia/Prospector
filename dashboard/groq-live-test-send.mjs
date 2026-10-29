// A single, explicitly authorized WhatsApp QA approach to the operator-owned
// number 5515981817336. Fail closed. Never uses the prospecting campaign queue.
import {db,one,run,now,addLead,getThread,addMessage,audit} from './db.mjs';
import {waControlStatus,waIdentityStatus,selectedWaSession,waRequest} from './waakg-control.mjs';
import {TEST_RECIPIENT,testModeAllowed,testGreeting} from './groq-live-test-guard.mjs';

export const LIVE_TEST_ID='consecom-7336-2026-10-29-one-shot';
db.exec("CREATE TABLE IF NOT EXISTS controlled_qa_sends(id TEXT PRIMARY KEY,phone TEXT NOT NULL,state TEXT NOT NULL,at TEXT NOT NULL,accepted_at TEXT)");
export async function runLive7336Greeting(deps={}){
 const gate=process.env.RUN_7336_APPROACH_ONCE==='true'&&
  process.env.RUN_TEST_7336_QUALITY_PASSED==='true'&&testModeAllowed(TEST_RECIPIENT)&&
  String(process.env.PROSPECTOR_HOT_LEAD_PHONE||'').replace(/\D/g,'')===TEST_RECIPIENT &&
  process.env.AI_CONVERSATION_AUTOSEND==='false';
 if(!gate)return {ok:false,state:'DISABLED'};
 if(one('SELECT id FROM controlled_qa_sends WHERE id=?',LIVE_TEST_ID))return {ok:false,state:'ALREADY_ATTEMPTED'};
 if(one('SELECT phone FROM suppressions WHERE phone=?',TEST_RECIPIENT))return {ok:false,state:'OPT_OUT'};
 const getStatus=deps.getStatus||waControlStatus,getIdentity=deps.getIdentity||waIdentityStatus;
 const transport=deps.transport||waRequest;
 const status=await getStatus(),identity=await getIdentity();
 if(!status?.connected||!status?.sessionId||!identity?.connected||
  !identity?.numberSuffix||identity.numberSuffix==='7336')return {ok:false,state:'NO_SAFE_CONNECTION'};
 const session=status.sessionId;
 let hooked=false;
 try{
  const h=await transport('/api/webhooks/'+encodeURIComponent(session));
  hooked=Array.isArray(h.data)&&h.data.some(w=>w.isActive!==false&&
   w.url==='https://prospector-operacional-production.up.railway.app/api/wa-akg/webhook'&&
   Array.isArray(w.events)&&w.events.includes('message.received'));
 }catch{return {ok:false,state:'WEBHOOK_CHECK_FAILED'};}
 if(!hooked)return {ok:false,state:'WEBHOOK_MISSING'};
 const at=now();
 // Durable reservation happens before transport. Never auto-retry ambiguous sends.
 run('INSERT OR IGNORE INTO controlled_qa_sends(id,phone,state,at) VALUES(?,?,?,?)',LIVE_TEST_ID,TEST_RECIPIENT,'UNKNOWN',at);
 const message=testGreeting();
 try{
  const ack=await transport('/api/messages/'+encodeURIComponent(session)+'/'+encodeURIComponent(TEST_RECIPIENT+'@s.whatsapp.net')+'/send',
   {method:'POST',data:{message:{text:message}}});
  if(ack.status!==true)return {ok:false,state:'UNKNOWN',requestAccepted:false};
  run("UPDATE controlled_qa_sends SET state='ACCEPTED',accepted_at=? WHERE id=?",now(),LIVE_TEST_ID);
  const lead=addLead({business:'Teste controlado 7336',phone:TEST_RECIPIENT,source:'OPERATOR_TEST',contact_permission:true}).lead;
  const thread=getThread(lead.id,TEST_RECIPIENT+'@s.whatsapp.net');
  addMessage({threadId:thread.id,providerId:'qa-greeting:'+LIVE_TEST_ID,direction:'out',body:message,status:'accepted'});
  audit('CONTROLLED_7336_GREETING_ACCEPTED',lead.id,{safe:true,runId:LIVE_TEST_ID});
  return {ok:true,state:'ACCEPTED',requestAccepted:true,displayVerified:false,
   recipientSuffix:'7336',senderSuffix:identity.numberSuffix};
 }catch(e){return {ok:false,state:'UNKNOWN',requestAccepted:false,errorType:e?.name||'ERROR'};}
}
