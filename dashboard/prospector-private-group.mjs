// One private WhatsApp group for each isolated Prospector customer workspace.
// All API access stays server-side. Only WhatsApp identities authenticated by
// the customer's own managed WA-AKG sessions may enter the group.
import {db,one,run,now,audit} from './db.mjs';
import {waRequest,waSessionList} from './waakg-control.mjs';

export const PROSPECTOR_GROUP_NAME='Meu Prospector';
const GROUP_ID=/^\d{8,30}@g\.us$/;
const SESSION_ID=/^[a-zA-Z0-9_-]{3,70}$/;
const CONNECTED_PHONE=/^55\d{10,11}$/;
const CONNECTED_JID=/^55\d{10,11}@s\.whatsapp\.net$/;
const waitMs=3*60_000;
const inviteCooldownMs=24*60*60_000;

db.exec("CREATE TABLE IF NOT EXISTS prospector_owner_group (singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner_session TEXT NOT NULL, owner_number TEXT NOT NULL, group_jid TEXT, state TEXT NOT NULL, last_attempt_at TEXT, next_attempt_at TEXT, last_error TEXT, updated_at TEXT NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS prospector_group_invite_attempt (group_jid TEXT NOT NULL, number TEXT NOT NULL, requested_at TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(group_jid,number))");

const groupId=value=>GROUP_ID.test(String(value||''))?String(value):'';
const jidNumber=value=>{
 const raw=String(value||'').split('@')[0].split(':')[0].replace(/\D/g,'');
 return CONNECTED_PHONE.test(raw)?raw:'';
};
const customerScope=()=>Boolean(process.env.PROSPECTOR_TENANT_ID)&&process.env.PROSPECTOR_DEMO_MODE!=='true'&&process.env.PROSPECTOR_AUTO_GROUP_ENABLED!=='false';
const nextAt=(date,delay)=>new Date(date.getTime()+delay).toISOString();

export function privateGroupState(){return one('SELECT * FROM prospector_owner_group WHERE singleton=1')||null;}
function saveGroup({ownerSession,ownerNumber,groupJid=null,state,attemptedAt=null,nextAttemptAt=null,error=null}){
 run("INSERT INTO prospector_owner_group(singleton,owner_session,owner_number,group_jid,state,last_attempt_at,next_attempt_at,last_error,updated_at) VALUES(1,?,?,?,?,?,?,?,?) ON CONFLICT(singleton) DO UPDATE SET owner_session=excluded.owner_session,owner_number=excluded.owner_number,group_jid=excluded.group_jid,state=excluded.state,last_attempt_at=excluded.last_attempt_at,next_attempt_at=excluded.next_attempt_at,last_error=excluded.last_error,updated_at=excluded.updated_at",
  ownerSession,ownerNumber,groupJid,state,attemptedAt,nextAttemptAt,error?String(error).slice(0,120):null,now());
}
function connectedSessions(pool){
 const items=Array.isArray(pool?.items)?pool.items:[];
 const seen=new Set();
 return items.filter(item=>{
  if(item?.connected!==true||!SESSION_ID.test(String(item.sessionId||''))||!CONNECTED_PHONE.test(String(item.number||'')))return false;
  if(seen.has(item.number))return false;
  seen.add(item.number);
  return true;
 }).map(item=>({sessionId:item.sessionId,number:item.number}));
}
const listEntries=response=>Array.isArray(response?.data)?response.data:Array.isArray(response?.groups)?response.groups:[];
function getMembership(entry){
 const participants=Array.isArray(entry?.participants)?entry.participants:null;
 if(!participants)return null;
 const numbers=new Set();
 for(const item of participants){
  const value=typeof item==='string'?item:item?.id||item?.jid||'';
  const number=jidNumber(value);
  if(!number)return {numbers,unknown:true};
  numbers.add(number);
 }
 return {numbers,unknown:false};
}
function findStored(entries,jid){return entries.find(g=>groupId(g?.jid||g?.id)===jid)||null;}
function safeRecovery(entries,ownerNumber,managedNumbers){
 const possible=entries.filter(g=>String(g?.subject||'')===PROSPECTOR_GROUP_NAME&&groupId(g?.jid||g?.id));
 const safe=possible.filter(g=>{
  const membership=getMembership(g);
  if(!membership||membership.unknown||!membership.numbers.has(ownerNumber))return false;
  const registered=managedNumbers;
  return [...membership.numbers].every(n=>registered.has(n));
 });
 // A manual group with the same title could exist. Only recover an exact
 // matching group after our OWN previous creation attempt, and only if unique.
 return safe.length===1?safe[0]:null;
}
function readResultGroup(reply){
 return groupId(reply?.data?.group?.id||reply?.data?.group?.jid||reply?.group?.id||reply?.group?.jid);
}
let busy=false;
export async function reconcilePrivateGroup({getSessions=waSessionList,request=waRequest,at=new Date()}={}){
 if(!customerScope())return {state:'DISABLED'};
 if(busy)return {state:'BUSY'};
 busy=true;
 try{
  const sessions=connectedSessions(await getSessions());
  let saved=privateGroupState();
  if(!sessions.length)return {state:'WAITING_WHATSAPP'};
  const owner=saved?sessions.find(s=>s.sessionId===saved.owner_session):sessions[0];
  if(!owner)return {state:'WAITING_OWNER_WHATSAPP'};
  const ownerSession=saved?.owner_session||owner.sessionId;
  const ownerNumber=saved?.owner_number||owner.number;
  // The session must still belong to its original authenticated number.
  if(owner.number!==ownerNumber)return {state:'OWNER_IDENTITY_CHANGED'};
  const managed=new Set(sessions.map(s=>s.number));
  const path='/api/groups/'+encodeURIComponent(ownerSession);
  let entries=null;
  const fetchGroups=async()=>{
   const reply=await request(path);
   return listEntries(reply);
  };
  if(saved?.group_jid){
   if(!groupId(saved.group_jid))return {state:'INVALID_SAVED_GROUP'};
   try{entries=await fetchGroups();}catch{return {state:'GROUP_LOOKUP_UNAVAILABLE'};}
   const existing=findStored(entries,saved.group_jid);
   if(!existing)return {state:'GROUP_NOT_VISIBLE',groupCreated:true};
   if(String(existing.subject||'')!==PROSPECTOR_GROUP_NAME)return {state:'GROUP_RENAMED',groupCreated:true};
   const membership=getMembership(existing);
   if(!membership)return {state:'MEMBERSHIP_NOT_YET_SYNCED',groupCreated:true};
   if(membership.unknown)return {state:'MEMBERSHIP_REVIEW_REQUIRED',groupCreated:true};
   if(!membership.numbers.has(ownerNumber))return {state:'OWNER_NOT_IN_GROUP',groupCreated:true};
   // No unintended third parties. If somebody manually adds an unknown
   // member, do not automatically grant group access to further numbers.
   const allowed=new Set([...managed,ownerNumber]);
   if([...membership.numbers].some(n=>!allowed.has(n)))
    return {state:'UNEXPECTED_GROUP_MEMBER',groupCreated:true};
   const missing=sessions.filter(s=>!membership.numbers.has(s.number));
   if(!missing.length){
    if(saved.state!=='READY')saveGroup({ownerSession,ownerNumber,groupJid:saved.group_jid,state:'READY',attemptedAt:saved.last_attempt_at});
    return {state:'READY',groupCreated:true,members:membership.numbers.size};
   }
   let attempts=0;
   for(const candidate of missing){
    const recent=one('SELECT requested_at FROM prospector_group_invite_attempt WHERE group_jid=? AND number=?',saved.group_jid,candidate.number);
    if(recent&&Date.parse(recent.requested_at)>at.getTime()-inviteCooldownMs)continue;
    try{
     const reply=await request(path+'/'+encodeURIComponent(saved.group_jid)+'/members',{
      method:'PUT',data:{action:'add',participants:[candidate.number+'@s.whatsapp.net']}
     });
     if(reply?.success!==true&&reply?.status!==true)throw Error('GROUP_INVITE_UNCONFIRMED');
     const result=Array.isArray(reply.result)?reply.result[0]:null;
     const status=result?.status===undefined?'UNKNOWN':String(result.status);
     run('INSERT INTO prospector_group_invite_attempt(group_jid,number,requested_at,result) VALUES(?,?,?,?) ON CONFLICT(group_jid,number) DO UPDATE SET requested_at=excluded.requested_at,result=excluded.result',
      saved.group_jid,candidate.number,at.toISOString(),status);
     attempts++;
     audit('PRIVATE_GROUP_MEMBER_REQUESTED',null,{groupLinked:true,code:status});
    }catch(e){
     run('INSERT INTO prospector_group_invite_attempt(group_jid,number,requested_at,result) VALUES(?,?,?,?) ON CONFLICT(group_jid,number) DO UPDATE SET requested_at=excluded.requested_at,result=excluded.result',
      saved.group_jid,candidate.number,at.toISOString(),'ERROR');
    }
   }
   saveGroup({ownerSession,ownerNumber,groupJid:saved.group_jid,state:'MEMBERSHIP_PENDING',attemptedAt:saved.last_attempt_at});
   return {state:'MEMBERSHIP_PENDING',groupCreated:true,missing:missing.length,attempts};
  }

  // Empty initial members: WhatsApp creates the group with its own creator.
  // The first connected number owns the group; remaining managed numbers are
  // added only after the group ID has been confirmed and persisted.
  if(saved?.next_attempt_at&&Date.parse(saved.next_attempt_at)>at.getTime())
   return {state:saved.state,nextAttemptAt:saved.next_attempt_at};

  // Recover after an interrupted remote creation, but never appropriate an
  // existing unrelated group merely because it shares the title.
  if(saved?.last_attempt_at){
   try{
    entries=await fetchGroups();
    const recovered=safeRecovery(entries,ownerNumber,managed);
    if(recovered){
     const jid=groupId(recovered.jid||recovered.id);
     saveGroup({ownerSession,ownerNumber,groupJid:jid,state:'READY',attemptedAt:saved.last_attempt_at});
     return {state:'RECOVERED',groupCreated:true};
    }
    // An ambiguous same-name group after an uncertain create may be ours.
    // Halt rather than risk creating a second copy or taking over a stranger's group.
    if(entries.some(x=>String(x?.subject||'')===PROSPECTOR_GROUP_NAME))
     return {state:'GROUP_MATCH_AMBIGUOUS',groupCreated:false};
   }catch{return {state:'GROUP_LOOKUP_UNAVAILABLE'};}
   if(saved.state==='CREATING'&&Date.parse(saved.last_attempt_at)>at.getTime()-waitMs)return {state:'CONFIRMING_CREATION'};
  }

  const participants=[];
  saveGroup({ownerSession,ownerNumber,state:'CREATING',attemptedAt:at.toISOString(),nextAttemptAt:nextAt(at,waitMs)});
  try{
   const reply=await request(path+'/create',{method:'POST',data:{subject:PROSPECTOR_GROUP_NAME,participants}});
   const groupJid=readResultGroup(reply);
   if(!groupJid){
    saveGroup({ownerSession,ownerNumber,state:'CONFIRMING_CREATION',attemptedAt:at.toISOString(),nextAttemptAt:nextAt(at,waitMs),error:'No group JID confirmed'});
    return {state:'CONFIRMING_CREATION'};
   }
   saveGroup({ownerSession,ownerNumber,groupJid,state:'MEMBERSHIP_PENDING',attemptedAt:at.toISOString()});
   audit('PRIVATE_GROUP_CREATED',null,{connectedNumbers:sessions.length,groupOnlyOwnNumbers:true});
   return {state:'CREATED',groupCreated:true};
  }catch(e){
   // A WhatsApp failure can still mean an uncertain remote completion. Re-list
   // the group after a cooldown before trying again, to avoid duplicates.
   saveGroup({ownerSession,ownerNumber,state:'CREATION_RETRY',attemptedAt:at.toISOString(),
    nextAttemptAt:nextAt(at,waitMs),error:String(e?.message||e).slice(0,110)});
   return {state:'CREATION_RETRY'};
  }
 }finally{busy=false;}
}
