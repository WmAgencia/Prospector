// Read-only verification of historical messages sent before durable receipts
// existed. Never sends to a lead, never interprets missing history as failure.
// Exact outbound text+timestamp or unique video caption is required.
import {db,all,one,run,now,audit} from './db.mjs';
import {waRequest,waOperationalStatus} from './waakg-control.mjs';
import {isManagedSession,leadSession} from './waakg-session-registry.mjs';
import {loadProspectorHistory,findSentTextInHistory} from './prospecting-chat-history.mjs';
import {matchPitchHistory} from './pitch-delivery-verification.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS prospecting_legacy_proof_checks(
 lead_id TEXT NOT NULL, greeting_id TEXT NOT NULL,
 kind TEXT NOT NULL, checked_at TEXT NOT NULL,
 result TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(lead_id,greeting_id,kind))`);
const age=value=>Date.parse(value||'')||0;
const validId=v=>/^[A-Za-z0-9_-]{5,150}$/.test(String(v||''));
const messageId=m=>String(m?.keyId||m?.key?.id||'');
const statusOf=m=>{
 const raw=String(m?.status||'').toUpperCase();
 return !raw||raw==='PENDING'?'SENT':['SENT','DELIVERED','READ','FAILED'].includes(raw)?raw:null;
};
const readOnlyCandidates=since=>{
 const texts=all(`SELECT 'INTRO' AS kind,p.lead_id,p.greeting_id,p.session_id,p.phone,
  m.body AS expected,m.at AS attempted_at
  FROM prospecting_introductions p
  JOIN messages m ON m.provider_id=('intro:'||p.greeting_id) AND m.direction='out'
  LEFT JOIN prospecting_text_receipts r ON r.lead_id=p.lead_id
   AND r.greeting_id=p.greeting_id AND r.kind='INTRO'
  WHERE r.lead_id IS NULL AND m.at>=?
   AND p.stage IN ('SENT','VOICE_SENT','CONVERSING')
  ORDER BY m.at DESC LIMIT 250`,since);
 const greeting=all(`SELECT 'GREETING' AS kind,b.lead_id,b.id AS greeting_id,
  COALESCE(p.session_id,'') AS session_id,b.phone,m.body AS expected,
  m.at AS attempted_at
  FROM prospecting_batch_items b
  JOIN messages m ON m.provider_id=('prospect-queue:'||b.id) AND m.direction='out'
  LEFT JOIN prospecting_introductions p ON p.lead_id=b.lead_id AND p.greeting_id=b.id
  LEFT JOIN prospecting_text_receipts r ON r.lead_id=b.lead_id
   AND r.greeting_id=b.id AND r.kind='GREETING'
  WHERE r.lead_id IS NULL AND b.status='SENT' AND m.at>=?
  ORDER BY m.at DESC LIMIT 250`,since);
 const video=all(`SELECT 'VIDEO' AS kind,p.lead_id,p.greeting_id,p.session_id,p.phone,
  '' AS expected,p.followup_sent_at AS attempted_at
  FROM prospecting_introductions p
  LEFT JOIN pitch_delivery_receipts r ON r.lead_id=p.lead_id
   AND r.greeting_id=p.greeting_id AND r.kind='VIDEO'
  WHERE r.lead_id IS NULL AND p.followup_status='SENT'
   AND p.followup_sent_at>=?
  ORDER BY p.followup_sent_at DESC LIMIT 250`,since);
 return [...texts,...greeting,...video].sort((a,b)=>age(b.attempted_at)-age(a.attempted_at));
};
let working=false;
export async function reconcileLegacyProspectingReceipts({
 fetchChat=waRequest,checkGateway=waOperationalStatus,limit=6,at=new Date()
}={}){
 if(working)return {state:'BUSY'};
 working=true;
 try{
  // Do not use missing/unreadable WhatsApp history as grounds to retry.
  const gateway=await checkGateway().catch(()=>({connected:false}));
  if(!gateway?.connected)return {state:'GATEWAY_OFFLINE',checked:0,verified:0};
  const ms=new Date(at).getTime(),cutoff=new Date(ms-14*86400000).toISOString();
  const candidates=readOnlyCandidates(cutoff);
  const eligible=candidates.filter(c=>{
   const prior=one('SELECT checked_at FROM prospecting_legacy_proof_checks WHERE lead_id=? AND greeting_id=? AND kind=?',
    c.lead_id,c.greeting_id,c.kind);
   return !prior||ms-age(prior.checked_at)>6*3600000;
  });
  let checked=0,verified=0,ambiguous=0,notFound=0;
  for(const c of eligible.slice(0,Math.max(1,Math.min(12,Number(limit)||6)))){
   const sid=c.session_id||leadSession(c.lead_id),jid=c.phone+'@s.whatsapp.net';
   if(!isManagedSession(sid)||leadSession(c.lead_id)!==sid||
      !/^\d{10,15}@s\.whatsapp\.net$/.test(jid)||!age(c.attempted_at))continue;
   const history=await loadProspectorHistory({sessionId:sid,jid,fetchChat});
   // A temporary gateway error is not evidence and should be checked again.
   if(history.state!=='AVAILABLE')continue;
   let matched;
   if(c.kind==='VIDEO')
    matched=matchPitchHistory({kind:'VIDEO',provider_id:null,attempted_at:c.attempted_at},history.messages);
   else matched=findSentTextInHistory({messages:history.messages,
    expectedText:c.expected,attemptedAt:c.attempted_at,spanMs:3*60000});
   const success=c.kind==='VIDEO'?matched.state==='EXACT_CAPTION':matched.state==='UNIQUE_CONTENT';
   const proof=matched.message,mid=messageId(proof);
   const exact=success&&validId(mid)&&statusOf(proof)&&
    (!proof.remoteJid||String(proof.remoteJid)===jid);
   let outcome=matched.state;
   if(exact){
    const state=statusOf(proof);
    const table=c.kind==='VIDEO'?'pitch_delivery_receipts':'prospecting_text_receipts';
    const inserted=run(`INSERT OR IGNORE INTO ${table}(
     lead_id,greeting_id,kind,session_id,jid,attempted_at,provider_id,status,
     confirmed_at,delivered_at,read_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
     c.lead_id,c.greeting_id,c.kind,sid,jid,c.attempted_at,mid,state,now(),
     ['DELIVERED','READ'].includes(state)?now():null,state==='READ'?now():null).changes;
    if(inserted){
     verified++;
     audit('PROSPECT_LEGACY_STEP_VERIFIED',c.lead_id,{kind:c.kind,
      source:'whatsapp_unique_history',status:state,deviceDelivered:['DELIVERED','READ'].includes(state)});
    }
    outcome=inserted?'VERIFIED':'ALREADY_RECORDED';
   }else if(['AMBIGUOUS','POSSIBLE','EXACT_CAPTION','UNIQUE_CONTENT'].includes(matched.state)){
    ambiguous++;
    outcome='NEEDS_MANUAL_REVIEW';
   }else notFound++;
   run(`INSERT INTO prospecting_legacy_proof_checks(lead_id,greeting_id,kind,checked_at,result,attempts)
    VALUES(?,?,?,?,?,1) ON CONFLICT(lead_id,greeting_id,kind)
    DO UPDATE SET checked_at=excluded.checked_at,result=excluded.result,attempts=attempts+1`,
    c.lead_id,c.greeting_id,c.kind,now(),outcome);
   checked++;
  }
  return {state:'OK',candidates:candidates.length,eligible:eligible.length,
   checked,verified,ambiguous,notFound,unproven:candidates.length-verified};
 }finally{working=false;}
}
