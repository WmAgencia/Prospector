// Independent deterministic flow state machine. No WhatsApp transport or owner workflow writes.
const messages=new Set(['text','audio','video','image','document']);
export const normalizedNiche=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
export function selectProject(projects,segment){
 const niche=normalizedNiche(segment);
 if(!niche)return null;
 const matches=projects.filter(p=>!p.protected&&p.enabled===true&&p.publishedVersion&&normalizedNiche(p.niche)===niche);
 if(matches.length!==1)return null;
 return matches[0];
}
// Smooth weighted round robin, with deterministic tie breaking. Counters are
// persisted by the caller in the same transaction as assignment.
export function assignVariant(variants,counts={}){
 if(!Array.isArray(variants)||!variants.length)throw Error('Etapa sem variantes');
 const totalWeight=variants.reduce((sum,v)=>sum+v.weight,0);
 const n=variants.reduce((sum,v)=>sum+(counts[v.id]||0),0);
 const sorted=variants.map((v,i)=>({v,i,score:(n+1)*v.weight/totalWeight-(counts[v.id]||0)})).sort((a,b)=>b.score-a.score||a.i-b.i);
 return sorted[0].v;
}
export function newExecution(definition,at=0){
 if(!definition?.steps?.length)throw Error('Fluxo vazio');
 return {cursor:0,state:'READY',enteredAt:at,dueAt:null,assignments:{},lastInboundId:null,history:[]};
}
export function reduceExecution(definition,execution,event,{at=0,choose=variants=>variants[0]}={}){
 const next=structuredClone(execution),s=definition.steps[next.cursor];
 if(['COMPLETE','CANCELLED','HUMAN','REVIEW'].includes(next.state))return next;
 const log=(type,detail={})=>next.history.push({type,stepId:s?.id||null,at,...detail});
 if(event.type==='optout'||event.type==='refusal'||event.type==='takeover'){
  next.state=event.type==='takeover'?'HUMAN':'CANCELLED';log(event.type);return next;
 }
 const advance=()=>{next.cursor++;next.state=next.cursor>=definition.steps.length?'COMPLETE':'READY';next.enteredAt=at;next.dueAt=null;};
 if(!s){next.state='COMPLETE';return next;}
 if(messages.has(s.kind)){
  if(event.type==='start'&&next.state==='READY'){
   const v=choose(s.variants);if(!s.variants.some(x=>x.id===v?.id))throw Error('Variante inválida');
   next.assignments[s.id]=v.id;next.state='RESERVED';log('reserved',{variantId:v.id});return next;
  }
  if(event.type==='accepted'&&next.state==='RESERVED'){
   if(!event.providerId){next.state='REVIEW';log('uncertain');return next;}
   next.state='WAIT_PROOF';next.providerId=event.providerId;log('accepted',{providerId:event.providerId});return next;
  }
  if(event.type==='uncertain'&&['RESERVED','WAIT_PROOF'].includes(next.state)){next.state='REVIEW';log('uncertain');return next;}
  if(event.type==='proof'&&next.state==='WAIT_PROOF'&&event.providerId===next.providerId&&['SENT','DELIVERED','READ'].includes(event.status)){
   log('confirmed',{providerId:event.providerId,status:event.status});delete next.providerId;advance();
  }
  return next;
 }
 if(s.kind==='delay'){
  if(event.type==='start'&&next.state==='READY'){next.state='WAIT_TIME';next.dueAt=at+s.seconds*1000;log('wait');}
  if(event.type==='tick'&&next.state==='WAIT_TIME'&&at>=next.dueAt){log('elapsed');advance();}
  return next;
 }
 if(['reply','condition'].includes(s.kind)){
  if(event.type==='start'&&next.state==='READY'){next.state='WAIT_REPLY';log('wait_reply');}
  if(event.type==='inbound'&&next.state==='WAIT_REPLY'&&event.id&&event.id!==next.lastInboundId&&at>=next.enteredAt){
   next.lastInboundId=event.id;
   if(event.automatic===true){log('automatic_reply');return next;}
   if(s.kind==='condition'&&s.condition==='permission'&&event.intent!=='permission'){log('await_permission');return next;}
   if(s.kind==='condition'&&s.condition==='interest'&&event.intent!=='interest'){log('await_interest');return next;}
   log('inbound',{id:event.id});advance();
  }
  return next;
 }
 if(event.type==='start'&&next.state==='READY'){
  if(s.kind==='handoff'||s.kind==='ai'){next.state='HUMAN';log(s.kind==='ai'?'ai_requires_adapter':'handoff');}
  else{next.state='REVIEW';log('unsupported');}
 }
 return next;
}
