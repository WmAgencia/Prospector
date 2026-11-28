// Read-only transport health; never sends messages or changes outreach.
export function createPulse({list,check,clock=()=>Date.now(),intervalMs=180000}){
 let rows=[],checkedAt=null,pending=null,lastSuccess=new Map();
 const stamp=t=>new Date(t).toISOString();
 function snapshot(){
  const stale=checkedAt===null||clock()-checkedAt>intervalMs*2;
  return {intervalSeconds:intervalMs/1000,checkedAt:checkedAt===null?null:stamp(checkedAt),
   items:rows.map(r=>({...r,state:stale?'UNKNOWN':r.state})),stale,mode:'LIVE_SOCKET_ONLY'};
 }
 async function refresh(){
  if(pending)return pending;
  pending=(async()=>{
   let sessions;
   try{sessions=await list();if(!Array.isArray(sessions))throw Error('INVALID_LIST');}
   catch{rows=rows.map(r=>({...r,state:'UNKNOWN'}));checkedAt=clock();return snapshot();}
   const allowed=new Set(sessions.map(s=>s.session_id));
   for(const k of lastSuccess.keys())if(!allowed.has(k))lastSuccess.delete(k);
   const results=[];
   // Small batches, no parallel checks for the same session.
   for(let i=0;i<sessions.length;i+=4){
    const batch=await Promise.all(sessions.slice(i,i+4).map(async s=>{
     let status;try{status=await check(s.session_id);}catch{status=null;}
     const state=!status?.ok?'UNKNOWN':status.connected===true?'ONLINE':status.transportStale?'UNSTABLE':'OFFLINE';
     if(state==='ONLINE')lastSuccess.set(s.session_id,stamp(clock()));
     return {sessionId:s.session_id,label:String(s.label||'WhatsApp').slice(0,70),state,lastOnlineAt:lastSuccess.get(s.session_id)||null};
    }));
    results.push(...batch);
   }
   rows=results;checkedAt=clock();return snapshot();
  })().finally(()=>{pending=null;});
  return pending;
 }
 return {refresh,snapshot};
}
