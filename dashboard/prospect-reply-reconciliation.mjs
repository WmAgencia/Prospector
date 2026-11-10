// Read-only WA-AKG history reconciliation, with exact session + JID matching.
// The gateway can store a reply even when a webhook was rate-limited.
// Never fabricate consent, resend unknown deliveries or message an unapproached number.
import {all,one,run,now,audit} from './db.mjs';
import {waRequest} from './waakg-control.mjs';
import {recordInboundTranscript} from './waakg-bridge.mjs';
import {isManagedSession,leadSession} from './waakg-session-registry.mjs';
import {prospectorChatEligible} from './whatsapp-roles.mjs';
import {queueNotice} from './notifications.mjs';

const ms=value=>{
 if(typeof value==='number')return value<1e11?value*1000:value;
 const parsed=Date.parse(String(value||''));
 return Number.isFinite(parsed)?parsed:0;
};
const usableContent=item=>typeof item?.content==='string'?item.content.trim():typeof item?.content?.text==='string'?item.content.text.trim():'';
export function chooseMissedReply(messages,earliest=0){
 const arr=Array.isArray(messages)?messages:[];
 const incoming=arr.filter(x=>x?.fromMe===false&&String(x.type||'TEXT').toUpperCase()==='TEXT'&&
   /^[A-Za-z0-9_-]{5,150}$/.test(String(x.keyId||''))&&usableContent(x).length>0&&
   ms(x.timestamp)>=earliest&&ms(x.timestamp)>Date.now()-3*86400000);
 incoming.sort((a,b)=>ms(b.timestamp)-ms(a.timestamp));
 if(!incoming.length)return {kind:'NO_REPLY'};
 const chosen=incoming[0];
 const laterOutbound=arr.some(x=>x?.fromMe===true&&ms(x.timestamp)>ms(chosen.timestamp)+500);
 return laterOutbound?{kind:'MANUAL_REPLY_SEEN',incoming:chosen}:{kind:'MISSED_REPLY',incoming:chosen};
}
export async function reconcileApproachedReplies({maxContacts=12,request=waRequest}={}){
 const since=new Date(Date.now()-3*86400000).toISOString();
 const priority=(process.env.PROSPECTOR_RECOVERY_PRIORITY_CONTACTS||'').split(',')
  .map(x=>x.trim()).filter(x=>/^55\\d{10,11}$/.test(x)).slice(0,5);
 const candidates=all(`SELECT p.lead_id,p.phone,p.session_id,p.stage,p.created_at
  FROM prospecting_introductions p
  WHERE p.stage IN ('GREETING_SENT','SENT','CONVERSING') AND p.created_at>=?
  ORDER BY p.created_at DESC LIMIT ?`,since,Math.max(1,Math.min(100,maxContacts+priority.length*2)));
 candidates.sort((a,b)=>(priority.includes(b.phone)?1:0)-(priority.includes(a.phone)?1:0));
 candidates.length=Math.min(candidates.length,Math.max(1,Math.min(24,maxContacts)));
 const totals={examined:0,imported:0,alreadyHandled:0,manualReview:0,unavailable:0};
 const examined=[];
 for(const row of candidates){
  const suffix=String(row.phone).slice(-4);
  if(!isManagedSession(row.session_id)||leadSession(row.lead_id)!==row.session_id)continue;
  const jid=row.phone+'@s.whatsapp.net';
  if(!prospectorChatEligible({jid,sessionId:row.session_id}))continue;
  totals.examined++;
  try{
   const response=await request('/api/messages/'+encodeURIComponent(row.session_id)+'/search?jid='+encodeURIComponent(jid)+'&limit=45');
   const messages=Array.isArray(response?.data)?response.data:[];
   // Only trust replies after this exact lead's persisted greeting.
   const selected=chooseMissedReply(messages,Math.max(ms(row.created_at),Date.now()-3*86400000));
   // Never log message text or phone numbers; record only provider evidence.
   if(priority.includes(row.phone)){
    const local=one("SELECT COUNT(*) c FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.lead_id=? AND m.direction='out' AND m.provider_id LIKE 'intro:%'",row.lead_id)?.c||0;
    const fromMe=messages.filter(x=>x.fromMe===true);
    const firstOwnerIntro=fromMe.some(x=>typeof x.content==='string'&&
      x.content.includes('Meu nome é Wesley')&&x.content.includes('fazer uma proposta'));
    const afterLastInbound=messages.some(x=>x.fromMe===true&&ms(x.timestamp)>
     Math.max(0,...messages.filter(x=>x.fromMe===false).map(x=>ms(x.timestamp)))+500);
    console.info('[reply provider evidence]',JSON.stringify({suffix,localIntroCount:local,providerIntro:firstOwnerIntro,
      outboundAfterLastInbound:afterLastInbound,outboundCount:fromMe.length,inboundCount:messages.filter(x=>x.fromMe===false).length}));
   }

   if(selected.kind==='NO_REPLY'){examined.push({suffix,status:'NO_REPLY_IN_GATEWAY'});continue;}
   const inbound=selected.incoming,unique=row.session_id+':'+inbound.keyId;
   if(one('SELECT 1 FROM waakg_inbox WHERE provider_id=?',unique)){
    totals.alreadyHandled++;examined.push({suffix,status:'ALREADY_IMPORTED'});continue;
   }
   if(selected.kind==='MANUAL_REPLY_SEEN'){
    // A human or another automation has replied since the incoming question.
    // Never send a second message. This is a human review only.
    run("UPDATE prospecting_introductions SET stage='CONVERSING',reason='PROVIDER_OUTBOUND_AFTER_INBOUND',due_at=NULL,updated_at=? WHERE lead_id=? AND stage='GREETING_SENT'",now(),row.lead_id);
    audit('INBOUND_RECONCILIATION_MANUAL_CHECK',row.lead_id,{suffix,session:row.session_id});
    queueNotice('gateway-reply-review:'+row.lead_id,'REPLY_REVIEW',
      'Contato '+suffix+' respondeu e já existe mensagem de saída no gateway. Conferir histórico sem reenviar.',row.lead_id);
    totals.manualReview++;examined.push({suffix,status:'MANUAL_REPLY_SEEN'});continue;
   }
   const outcome=recordInboundTranscript({sessionId:row.session_id,jid,unique,content:usableContent(inbound),source:'WA_AKG_RECONCILED'});
   if(outcome.status===200&&outcome.body?.processed){totals.imported++;examined.push({suffix,status:'RECOVERED'});}
   else examined.push({suffix,status:'SKIPPED'});
  }catch(e){
   totals.unavailable++;
   examined.push({suffix,status:'GATEWAY_UNAVAILABLE'});
   if(totals.unavailable>=2)break; // Avoid hammering a 429/503 gateway.
  }
 }
 return {...totals,details:examined};
}
