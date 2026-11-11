// Consecom owner-approved call scheduling. Never book a meeting without a real customer yes.
// One persistent state per lead, immutable transport reservations and owner-only commands.
import {db,one,all,run,id,now,addMessage,audit} from './db.mjs';
import {ownerPitchStatus} from './owner-pitch-sequence.mjs';
import {verifiedOwnerPhone,classifyContact} from './whatsapp-roles.mjs';
import {isManagedSession,leadSession} from './waakg-session-registry.mjs';
import {selectedWaSession,waControlStatus,waRequest} from './waakg-control.mjs';

const TZ='America/Sao_Paulo';
const GROUP=()=>String(process.env.PROSPECTOR_GROUP_IMPORT_JID||'').trim();
const validGroup=()=>/^\d{8,24}@g\.us$/.test(GROUP());
const pathFor=(session,jid,kind)=>'/api/messages/'+encodeURIComponent(session)+'/'+encodeURIComponent(jid)+'/'+kind;
const timeParts=(date)=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
const dateAt=(p,h,m)=>new Date(Date.UTC(p.year,p.month-1,p.day,h+3,m)).toISOString();
const hhmm=(iso)=>new Intl.DateTimeFormat('pt-BR',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));
const dayKey=(iso)=>{const p=timeParts(new Date(iso));return [p.year,String(p.month).padStart(2,'0'),String(p.day).padStart(2,'0')].join('-');};
const dayToday=()=>dayKey(new Date().toISOString());
const validSlot=(iso,at=Date.now())=>typeof iso==='string'&&Number.isFinite(Date.parse(iso))&&dayKey(iso)===dayKey(new Date(at).toISOString())&&Date.parse(iso)>=at+20*60000&&(()=>{const p=timeParts(new Date(iso));return p.hour>=10&&p.hour*60+p.minute<=17*60+30&&p.minute%30===0;})();
const positive=t=>/^(?:sim|claro|pode|com certeza|beleza|bora|vamos|fechado|combinado|top|ok|pode ser|tenho sim|consigo sim|tenho|tenho tempo|tenho disponibilidade|pode me ligar|me liga|quero sim)(?:[.!?,\s]|$)/i.test(String(t||'').trim());
const negative=t=>/^(?:n[aã]o|nao|nesse hor[aá]rio n[aã]o|nao consigo|não consigo|n[aã]o posso|outro hor[aá]rio|hoje n[aã]o)(?:[.!?,\s]|$)/i.test(String(t||'').trim());
const groupOrOwner=()=>validGroup()?GROUP():(verifiedOwnerPhone()?verifiedOwnerPhone()+'@s.whatsapp.net':null);

db.exec("CREATE TABLE IF NOT EXISTS call_scheduling (id TEXT PRIMARY KEY,lead_id TEXT NOT NULL UNIQUE REFERENCES leads(id),session_id TEXT NOT NULL,phone TEXT NOT NULL,state TEXT NOT NULL,slots_json TEXT NOT NULL DEFAULT '[]',proposed_at TEXT,customer_text TEXT,customer_send_state TEXT NOT NULL DEFAULT 'NONE',notice_state TEXT NOT NULL DEFAULT 'PENDING',reminder_state TEXT NOT NULL DEFAULT 'PENDING',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS call_scheduling_decisions (provider_id TEXT PRIMARY KEY,flow_id TEXT NOT NULL,at TEXT NOT NULL)");
run("UPDATE call_scheduling SET customer_send_state='UNKNOWN' WHERE customer_send_state='SENDING'");
run("UPDATE call_scheduling SET notice_state='UNKNOWN' WHERE notice_state='SENDING'");
run("UPDATE call_scheduling SET reminder_state='UNKNOWN' WHERE reminder_state='SENDING'");

export function availableCallSlots(at=Date.now()){
 const p=timeParts(new Date(at)),minute=p.hour*60+p.minute;
 let start=Math.ceil((minute+30)/30)*30;
 if(minute>=12*60+30)start=Math.max(start,15*60);
 start=Math.max(start,10*60+30);
 const slots=[];
 for(let m=start;m<=17*60+30;m+=30)slots.push(dateAt(p,Math.floor(m/60),m%60));
 return slots.filter(x=>validSlot(x,at));
}
function read(leadId){return one('SELECT * FROM call_scheduling WHERE lead_id=?',leadId);}
const liveCustomer=r=>isManagedSession(r.session_id)&&leadSession(r.lead_id)===r.session_id&&!one('SELECT 1 FROM suppressions WHERE phone=?',r.phone)&&!one('SELECT 1 FROM threads WHERE lead_id=? AND manual_takeover=1',r.lead_id);
const reminderDue=r=>r.state==='CONFIRMED'&&r.proposed_at&&Date.parse(r.proposed_at)-30*60*1000<=Date.now();
const setCustomer=(r,text,state,extra='')=>run("UPDATE call_scheduling SET state=?,customer_text=?,customer_send_state='PENDING',updated_at=? "+extra+" WHERE id=?",state,text,now(),r.id);
const clientConfirm=iso=>'Perfeito, marcado para hoje às '+hhmm(iso)+'! Até lá 😊';
const requestAlternative='Sem problemas! Qual horário fica mais fácil pra você hoje?';

function parseSuggestedTime(text,at=Date.now()){
 if(/\b(?:amanh[aã]|outro dia|semana que vem)\b/i.test(text))return null;
 const found=String(text||'').match(/(?:^|[^\d])(?:[aà]s?\s+|pode ser\s+|por volta d[ae]\s+)?(1[0-7]|[1-9])(?:\s*(?:h|:)\s*(00|30)?|\s*horas?)?(?:\s*(?:da tarde|da manh[aã]))?(?!\d)/i);
 if(!found)return null;
 let h=Number(found[1]),m=found[2]?Number(found[2]):0;
 const p=timeParts(new Date(at)),late=/tarde/i.test(text);
 if(h>=1&&h<=5&&(late||p.hour>=12))h+=12;
 const iso=dateAt(p,h,m);
 return validSlot(iso,at)?iso:null;
}
function reserveMeeting(r,iso){
 if(!validSlot(iso))return false;
 const conflicting=one("SELECT 1 FROM meetings WHERE start_at=? AND status='SCHEDULED'",iso);
 if(conflicting)return false;
 try{
  run("INSERT INTO meetings(id,lead_id,start_at,notes,status,created_at) VALUES(?,?,?,?,'SCHEDULED',?)",id(),r.lead_id,iso,'Chamada via Prospector — aprovação do proprietário',now());
 }catch{return false;}
 run("UPDATE threads SET manual_takeover=1 WHERE lead_id=?",r.lead_id);
 run("UPDATE call_scheduling SET state='CONFIRMED',proposed_at=?,customer_text=?,customer_send_state='PENDING',notice_state='PENDING',reminder_state='PENDING',updated_at=? WHERE id=?",iso,clientConfirm(iso),now(),r.id);
 audit('CALL_BOOKED',r.lead_id,{time:iso,approvedByOwner:true});
 return true;
}

export function routeCustomerCall({leadId,sessionId,providerId,body}={}){
 if(process.env.PROSPECTOR_TENANT_ID||!leadId||!providerId)return {handled:false};
 const lead=one('SELECT id,phone FROM leads WHERE id=?',leadId);
 if(!lead||sessionId!==leadSession(leadId)||!isManagedSession(sessionId))return {handled:false};
 const r=read(leadId),text=String(body||'').trim();
 if(!r){
  // Only a reply to the immediately preceding, confirmed post-audio invitation can start scheduling.
  if(ownerPitchStatus(leadId)?.stage!=='DONE'||!positive(text))return {handled:false};
  const last=one("SELECT m.provider_id FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.lead_id=? AND m.direction='out' ORDER BY m.rowid DESC LIMIT 1",leadId);
  if(last?.provider_id!=='owner-preview:'+leadId)return {handled:false};
  const slots=availableCallSlots();
  if(!slots.length){audit('CALL_NO_SLOTS_TODAY',leadId,{});return {handled:false};}
  const at=now(),flowId=id();
  run("INSERT INTO call_scheduling(id,lead_id,session_id,phone,state,slots_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",flowId,leadId,sessionId,lead.phone,'WAIT_OWNER_SLOT',JSON.stringify(slots),at,at);
  audit('CALL_OWNER_SLOT_REQUESTED',leadId,{flowId,slots:slots.length});
  return {handled:true,state:'WAIT_OWNER_SLOT'};
 }
 if(!liveCustomer(r))return {handled:false};
 if(r.state==='WAIT_CLIENT_CONFIRM'){
  if(positive(text)){if(reserveMeeting(r,r.proposed_at))return {handled:true,state:'CONFIRMED'};run("UPDATE call_scheduling SET state='REVIEW',notice_state='PENDING',updated_at=? WHERE id=?",now(),r.id);return {handled:true,state:'REVIEW'};}
  if(negative(text)){setCustomer(r,requestAlternative,'WAIT_CLIENT_ALTERNATIVE');return {handled:true,state:'WAIT_CLIENT_ALTERNATIVE'};}
  return {handled:false};
 }
 if(r.state==='WAIT_CLIENT_ALTERNATIVE'){
  const alternative=parseSuggestedTime(text);
  if(alternative){
   run("UPDATE call_scheduling SET state='WAIT_OWNER_ALTERNATIVE',proposed_at=?,slots_json=?,notice_state='PENDING',customer_send_state='NONE',updated_at=? WHERE id=?",alternative,JSON.stringify([alternative]),now(),r.id);
   audit('CALL_CLIENT_ALTERNATIVE_REQUESTED',leadId,{time:alternative});
   return {handled:true,state:'WAIT_OWNER_ALTERNATIVE'};
  }
  if(/\d/.test(text)||/amanh[aã]|outro dia/i.test(text)){run("UPDATE call_scheduling SET state='REVIEW',notice_state='PENDING',updated_at=? WHERE id=?",now(),r.id);return {handled:true,state:'REVIEW'};}
  return {handled:true,state:'AWAITING_TIME'};
 }
 if(['WAIT_OWNER_SLOT','WAIT_OWNER_ALTERNATIVE','CONFIRMED','HANDOFF','REVIEW'].includes(r.state))return {handled:true,state:r.state};
 return {handled:false};
}
function parseOwnerCommand(value){
 const s=String(value||'').trim();
 let m=s.match(/^(?:horario|horário)\s+([a-f0-9-]{36})\s+(\d{1,2})[:h](00|30)$/i);
 if(m)return {id:m[1],action:'SLOT',time:String(Number(m[2])).padStart(2,'0')+':'+m[3]};
 m=s.match(/^reuniao\s+([a-f0-9-]{36})\s+(aceitar|recusar)$/i);
 if(m)return {id:m[1],action:m[2].toUpperCase()};
 m=s.match(/^call:([a-f0-9-]{36}):(slot:\d{2}(?:00|30)|aceitar|recusar)$/i);
 if(m)return {id:m[1],action:m[2].startsWith('slot:')?'SLOT':m[2].toUpperCase(),time:m[2].startsWith('slot:')?m[2].slice(5,7)+':'+m[2].slice(7):null};
 return null;
}
export function routeOwnerCall({jid,sessionId,participant,providerId,text,interactiveId}={}){
 const cmd=parseOwnerCommand(interactiveId)||parseOwnerCommand(text);
 if(!cmd)return {handled:false};
 const group=jid===GROUP()&&validGroup();
 const owner=verifiedOwnerPhone();
 const from=String(participant||'').replace(/:\d+(?=@)/,'');
 const permitted=group?from===owner+'@s.whatsapp.net':classifyContact({jid,sessionId}).ownerTools===true&&jid===owner+'@s.whatsapp.net'&&sessionId===selectedWaSession();
 if(!permitted||!providerId)return {handled:true,ok:false,error:'UNAUTHORIZED'};
 const r=one('SELECT * FROM call_scheduling WHERE id=?',cmd.id);
 if(!r||!isManagedSession(r.session_id)||leadSession(r.lead_id)!==r.session_id)return {handled:true,ok:false,error:'NOT_FOUND'};
 if(one('SELECT provider_id FROM call_scheduling_decisions WHERE provider_id=?',providerId))return {handled:true,ok:false,error:'DUPLICATE'};
 let next=null;
 if(cmd.action==='SLOT'&&r.state==='WAIT_OWNER_SLOT'){
  const slots=JSON.parse(r.slots_json||'[]');
  next=slots.find(s=>hhmm(s)===cmd.time&&validSlot(s)&&!one("SELECT 1 FROM meetings WHERE start_at=? AND status='SCHEDULED'",s));
  if(!next)return {handled:true,ok:false,error:'SLOT_EXPIRED'};
  setCustomer(r,'Legal, tenho um horário disponível às '+hhmm(next)+'. Podemos marcar pra esse horário?','WAIT_CLIENT_CONFIRM',",proposed_at='"+next+"'");
 }else if(['ACEITAR','RECUSAR'].includes(cmd.action)&&r.state==='WAIT_OWNER_ALTERNATIVE'){
  if(cmd.action==='ACEITAR'){
   if(!reserveMeeting(r,r.proposed_at))return {handled:true,ok:false,error:'SLOT_UNAVAILABLE'};
  }else{
   run("UPDATE call_scheduling SET state='HANDOFF',notice_state='PENDING',updated_at=? WHERE id=?",now(),r.id);
   run("UPDATE threads SET manual_takeover=1 WHERE lead_id=?",r.lead_id);
   audit('CALL_OWNER_DECLINED_SILENTLY',r.lead_id,{handoff:true});
  }
 }else return {handled:true,ok:false,error:'STATE_CHANGED'};
 run('INSERT INTO call_scheduling_decisions(provider_id,flow_id,at) VALUES(?,?,?)',providerId,r.id,now());
 audit('CALL_OWNER_DECISION',r.lead_id,{flowId:r.id,action:cmd.action,time:next||r.proposed_at});
 return {handled:true,ok:true,state:cmd.action==='SLOT'?'WAIT_CLIENT_CONFIRM':cmd.action==='RECUSAR'?'HANDOFF':'CONFIRMED'};
}
async function sendingSession(session,dep){const status=await (dep.status||waControlStatus)(session);return status?.connected===true;}
async function sendMessage(r,to,text,deps){const send=deps.send||waRequest;return send(pathFor(r.session_id,to,'send'),{method:'POST',data:{message:{text}}});}
async function businessNumber(deps){
 try{
  const result=await (deps.send||waRequest)('/api/sessions/'+encodeURIComponent(selectedWaSession()));
  const raw=String(result?.data?.me?.id||result?.data?.me?.jid||'');
  return /^\d{10,15}(?::\d+)?@s\.whatsapp\.net$/.test(raw)?raw.split('@')[0].split(':')[0]:'';
 }catch{return '';}
}
const link=(number,text)=>number?'https://wa.me/'+number+'?text='+encodeURIComponent(text):'Comando: '+text;
function noticeText(r,number){
 const lead=one('SELECT business,name FROM leads WHERE id=?',r.lead_id);
 const header='📞 *PROSPECTOR — Agendamento*\nEmpresa: '+(lead?.business||'Cliente')+'\nContato: '+r.phone+'\nAbrir conversa: https://wa.me/'+r.phone+'\n';
 const slots=JSON.parse(r.slots_json||'[]');
 if(r.state==='WAIT_OWNER_SLOT')return header+'\nCliente aceitou conversar. Escolha um horário para HOJE:\n'+slots.map(s=>'• '+hhmm(s)+' — '+link(number,'HORARIO '+r.id+' '+hhmm(s))).join('\n');
 if(r.state==='WAIT_OWNER_ALTERNATIVE')return header+'\nO cliente sugeriu '+hhmm(r.proposed_at)+'. Você aceita?\n✅ '+link(number,'REUNIAO '+r.id+' ACEITAR')+'\n❌ '+link(number,'REUNIAO '+r.id+' RECUSAR');
 if(r.state==='HANDOFF')return header+'\nHorário recusado. A Francisca não responderá mais. Assuma pelo link acima.';
 if(r.state==='REVIEW')return header+'\nHorário não reconhecido, indisponível ou expirado. Assuma a conversa pelo link acima.';
 if(r.state==='CONFIRMED')return header+'\n✅ Reunião confirmada para hoje às '+hhmm(r.proposed_at)+'.';
 return '';
}
let working=false;
export async function flushCallScheduling(deps={}){
 if(working||process.env.PROSPECTOR_TENANT_ID)return {state:'IDLE'};
 working=true;let sent=0;
 try{
  for(const r of all("SELECT * FROM call_scheduling WHERE notice_state='PENDING' ORDER BY created_at LIMIT 3")){
   const dest=groupOrOwner(),session=selectedWaSession();
   if(!dest||!session||!await sendingSession(session,deps))continue;
   const sender=await businessNumber(deps);
   if(!sender)continue; // Keep pending instead of presenting unusable links.
   if(!run("UPDATE call_scheduling SET notice_state='SENDING',updated_at=? WHERE id=? AND notice_state='PENDING'",now(),r.id).changes)continue;
   try{
    const ack=await (deps.send||waRequest)(pathFor(session,dest,'send'),{method:'POST',data:{message:{text:noticeText(r,sender)}}});
    if(ack?.status!==true)throw Error('UNCONFIRMED');
    run("UPDATE call_scheduling SET notice_state='SENT',updated_at=? WHERE id=?",now(),r.id);sent++;
    // Native buttons are best-effort. Group clients may not render them;
    // actionable wa.me links above are the dependable fallback.
    if(validGroup()&&['WAIT_OWNER_SLOT','WAIT_OWNER_ALTERNATIVE'].includes(r.state)){
     const buttons=r.state==='WAIT_OWNER_SLOT'?JSON.parse(r.slots_json).filter(s=>validSlot(s)).map(s=>({type:'quick_reply',displayText:hhmm(s),id:'call:'+r.id+':slot:'+hhmm(s).replace(':','')})):
      [{type:'quick_reply',displayText:'Aceitar',id:'call:'+r.id+':aceitar'},{type:'quick_reply',displayText:'Recusar',id:'call:'+r.id+':recusar'}];
     for(let i=0;i<buttons.length;i+=3){
      try{await (deps.send||waRequest)(pathFor(session,dest,'interactive'),{method:'POST',data:{title:'Agendar chamada',body:'Selecione um dos horários abaixo. Se não aparecer, use os links da mensagem.',footer:'Prospector',buttons:buttons.slice(i,i+3)}});}catch{/* Text links were delivered; no blind retry. */}
     }
    }
   }catch{run("UPDATE call_scheduling SET notice_state='UNKNOWN',updated_at=? WHERE id=?",now(),r.id);}
  }
  for(const r of all("SELECT * FROM call_scheduling WHERE customer_send_state='PENDING' ORDER BY updated_at LIMIT 3")){
   if(!liveCustomer(r)||!await sendingSession(r.session_id,deps))continue;
   if(!run("UPDATE call_scheduling SET customer_send_state='SENDING',updated_at=? WHERE id=? AND customer_send_state='PENDING'",now(),r.id).changes)continue;
   try{
    const ack=await sendMessage(r,r.phone+'@s.whatsapp.net',r.customer_text,deps);
    if(ack?.status!==true)throw Error('UNCONFIRMED');
    run("UPDATE call_scheduling SET customer_send_state='SENT',updated_at=? WHERE id=?",now(),r.id);
    const thread=one('SELECT id FROM threads WHERE lead_id=?',r.lead_id);
    if(thread)addMessage({threadId:thread.id,providerId:'call-flow:'+r.id+':'+r.state,direction:'out',body:r.customer_text,status:'accepted'});
    sent++;
   }catch{run("UPDATE call_scheduling SET customer_send_state='UNKNOWN',updated_at=? WHERE id=?",now(),r.id);}
  }
  for(const r of all("SELECT * FROM call_scheduling WHERE state='CONFIRMED' AND reminder_state='PENDING' ORDER BY proposed_at LIMIT 5")){
   if(!reminderDue(r))continue;
   const remaining=Date.parse(r.proposed_at)-Date.now();
   if(remaining<20*60000){run("UPDATE call_scheduling SET reminder_state='MISSED' WHERE id=?",r.id);continue;}
   const dest=groupOrOwner(),session=selectedWaSession();
   if(!dest||!session||!await sendingSession(session,deps))continue;
   if(!run("UPDATE call_scheduling SET reminder_state='SENDING',updated_at=? WHERE id=? AND reminder_state='PENDING'",now(),r.id).changes)continue;
   try{
    const lead=one('SELECT business FROM leads WHERE id=?',r.lead_id);
    const message='⏰ *PROSPECTOR*\nVocê tem uma reunião daqui a 30 minutos!\n\nEmpresa: '+(lead?.business||'Cliente')+'\nHorário: '+hhmm(r.proposed_at)+'\nAbrir conversa: https://wa.me/'+r.phone;
    const ack=await (deps.send||waRequest)(pathFor(session,dest,'send'),{method:'POST',data:{message:{text:message}}});
    if(ack?.status!==true)throw Error('UNCONFIRMED');
    run("UPDATE call_scheduling SET reminder_state='SENT',updated_at=? WHERE id=?",now(),r.id);sent++;
   }catch{run("UPDATE call_scheduling SET reminder_state='UNKNOWN',updated_at=? WHERE id=?",now(),r.id);}
  }
  return {state:'OK',sent};
 }finally{working=false;}
}
