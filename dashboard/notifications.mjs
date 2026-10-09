// Owner-only WhatsApp notices. No message to leads is sent from this module.
import {one,all,run,id,now,getSetting,audit,phone} from './db.mjs';
const TZ='America/Sao_Paulo';
export function localDay(ts=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ts));}
export function localHour(ts=new Date()){return Number(new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'2-digit',hour12:false}).format(new Date(ts)))%24;}
const valid=s=>{const p=phone(s);return p&&p.startsWith('55')&&p.length>=12&&p.length<=13?p:null;};
export function targetNumber(connectedId) {
 const a=valid(getSetting('owner_phone_a','')),b=valid(getSetting('owner_phone_b',''));
 const active=valid(String(connectedId||'').split(':')[0].split('@')[0]);
 if(!a||!b||a===b||!active)return null;
 if(active===a)return b;
 if(active===b)return a;
 return null;
}
export function queueNotice(key,kind,message,leadId=null){
 if(!key||!message)return false;
 const result=run("INSERT OR IGNORE INTO owner_notices(id,unique_key,kind,lead_id,message,status,created_at,updated_at) VALUES(?,?,?,?,?,'PENDING',?,?)",id(),String(key),kind,leadId,message,now(),now());
 return result.changes>0;
}
function localFilter(rows,key,date){return rows.filter(x=>localDay(x[key])===date);}
export function dailyReport(day=localDay()){
 const sent=localFilter(all("SELECT lead_id,updated_at FROM jobs WHERE status='SENT' AND step_index=0 AND execution_id IS NOT NULL"),'updated_at',day);
 const replies=localFilter(all("SELECT t.lead_id,m.at FROM messages m JOIN threads t ON t.id=m.thread_id WHERE m.direction='in'"),'at',day);
 const stageRows=localFilter(all("SELECT lead_id,at,detail FROM audit WHERE action='STAGE'"),'at',day);
 const byStage=(s)=>new Set(stageRows.filter(x=>{try{return JSON.parse(x.detail).to===s;}catch{return false;}}).map(x=>x.lead_id)).size;
 const requests=localFilter(all("SELECT lead_id,accepted_at FROM production_requests WHERE accepted_at IS NOT NULL"),'accepted_at',day);
 return {day,approached:new Set(sent.map(x=>x.lead_id)).size,responded:new Set(replies.map(x=>x.lead_id)).size,
 interested:byStage('INTERESTED'),notInterested:byStage('NO_INTEREST'),
 requested:new Set(requests.map(x=>x.lead_id)).size,closed:byStage('CLOSED_WON')};
}
export function reportText(s){
 return ['📊 *Prospector Consecom — relatório diário*', '📅 '+s.day+' (Brasília)','',
 '📨 Abordagens: '+s.approached,'💬 Responderam: '+s.responded,
 '⭐ Interessados: '+s.interested,'🚫 Sem interesse: '+s.notInterested,
 '🖥️ Pediram exemplo: '+s.requested,'✅ Fecharam: '+s.closed,
 '','Os números contam leads únicos em cada métrica no dia.'].join('\n');
}
export function scheduleReport(nowDate=new Date()){
 if(!getSetting('owner_notifications_enabled',false))return false;
 const hour=Number(getSetting('owner_report_hour',20));
 if(localHour(nowDate)<hour)return false;
 const day=localDay(nowDate);
 return queueNotice('daily:'+day,'DAILY_REPORT',reportText(dailyReport(day)));
}
export async function flushNotices(sock){
 if(!getSetting('owner_notifications_enabled',false)||!sock?.user?.id)return 0;
 const number=targetNumber(sock.user.id);
 if(!number)return 0;
 let count=0;
 for(const msg of all("SELECT * FROM owner_notices WHERE status='PENDING' ORDER BY created_at LIMIT 5")){
  const reserved=run("UPDATE owner_notices SET status='SENDING',updated_at=? WHERE id=? AND status='PENDING'",now(),msg.id);
  if(!reserved.changes)continue;
  try{
   const ack=await sock.sendMessage(number+'@s.whatsapp.net',{text:msg.message});
   if(!ack?.key?.id)throw Error('Provedor não confirmou identificador');
   run("UPDATE owner_notices SET status='SENT',updated_at=? WHERE id=?",now(),msg.id);
   audit('OWNER_NOTICE_SENT',msg.lead_id,{kind:msg.kind});count++;
  }catch(e){
   // Could have been accepted by WhatsApp: never retry blindly.
   run("UPDATE owner_notices SET status='UNKNOWN',error=?,updated_at=? WHERE id=?",String(e.message).slice(0,280),now(),msg.id);
   audit('OWNER_NOTICE_UNKNOWN',msg.lead_id,{kind:msg.kind});
  }
 }
 return count;
}
