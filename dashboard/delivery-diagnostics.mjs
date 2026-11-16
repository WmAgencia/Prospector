// Read-only delivery verification for operator diagnostics. No message sends,
// reconnects, or changes to contact/queue/consent state.
import {all,one} from './db.mjs';
import {waSessionList,waRequest} from './waakg-control.mjs';
import {boundLeadSession} from './waakg-session-registry.mjs';

function ms(value){const n=Number(value);return Number.isFinite(n)&&n>1e11?n:Number.isFinite(n)&&n>1e8?n*1000:(Date.parse(value)||0);}
const upper=x=>String(x||'').toUpperCase();
const validStatus=['PENDING','SENT','DELIVERED','READ','FAILED'];
export async function inspectGatewayDelivery({max=65}={}){
 const sessions=await waSessionList();
 const sessionInfo=sessions.items.map(s=>({suffix:s.numberSuffix||null,connected:s.connected===true,status:s.status,
  transportStale:s.transportStale===true,hasSession:s.hasSession===true}));
 const start=new Date(Date.now()-48*3600_000).toISOString();
 const batches=all("SELECT i.id,i.lead_id,i.phone,i.attempt_at,i.status FROM prospecting_batch_items i WHERE i.attempt_at>=? AND i.status IN ('SENT','SENDING','UNKNOWN') ORDER BY i.attempt_at DESC LIMIT ?",start,Math.min(100,Math.max(1,max)));
 const statusTotals=all("SELECT status,COUNT(*) AS total FROM prospecting_batch_items WHERE attempt_at>=? GROUP BY status",start);
 const results=[];
 // Four readers max, no metadata or chat content in logs.
 let index=0;
 async function worker(){
  while(index<batches.length){
   const b=batches[index++],sid=boundLeadSession(b.lead_id);
   const sn=sessions.items.find(x=>x.session_id===sid);
   if(!sn){results.push({kind:'UNREGISTERED_SESSION',queue:b.status});continue;}
   const local=one("SELECT body FROM messages WHERE provider_id=?",'prospect-queue:'+b.id);
   if(!local?.body){results.push({kind:'MISSING_LOCAL_SEND_RECORD',queue:b.status,suffix:sn.numberSuffix||null});continue;}
   let remote;
   try{
    const obj=await waRequest('/api/chat/'+encodeURIComponent(sid)+'/'+encodeURIComponent(b.phone+'@s.whatsapp.net'));
    if(!Array.isArray(obj?.data))throw Error('NO_HISTORY');
    remote=obj.data;
   }catch{results.push({kind:'HISTORY_UNAVAILABLE',queue:b.status,suffix:sn.numberSuffix||null});continue;}
   const attempted=ms(b.attempt_at),matches=remote.filter(m=>m.fromMe===true&&String(m.content||'')===String(local.body||'')&&
      Math.abs(ms(m.timestamp)-attempted)<7*60_000);
   if(matches.length===0){results.push({kind:'NO_MATCH_IN_GATEWAY',queue:b.status,suffix:sn.numberSuffix||null});continue;}
   const m=matches.at(-1),remoteStatus=upper(m.status);
   results.push({kind:validStatus.includes(remoteStatus)?remoteStatus:'OTHER_REMOTE_STATUS',
    queue:b.status,suffix:sn.numberSuffix||null,ageMinutes:Math.floor((Date.now()-ms(m.timestamp))/60_000)});
  }
 }
 await Promise.all(Array.from({length:4},()=>worker()));
 const counts={};for(const r of results)counts[r.kind]=(counts[r.kind]||0)+1;
 const bySession={};for(const r of results){
  const k=r.suffix||'UNKNOWN';if(!bySession[k])bySession[k]={};
  bySession[k][r.kind]=(bySession[k][r.kind]||0)+1;
 }
 return {sample:batches.length,queueTotals:Object.fromEntries(statusTotals.map(x=>[x.status,x.total])),
  sessions:sessionInfo,gatewayStatusCounts:counts,bySendingNumber:bySession,
  gatewayAcceptanceIsNotDelivery:true};
}
