// Read-only customer-specific incident audit for the owner's 7336 -> ...7896
// conversation. No writes, messages, media downloads or PII in logs.
import {all,one} from './db.mjs';
import {waRequest} from './waakg-control.mjs';
import {boundLeadSession} from './waakg-session-registry.mjs';
const suffix=x=>String(x||'').replace(/\D/g,'').slice(-4);
const rows=(sql,...params)=>{try{return all(sql,...params)}catch(e){return {error:String(e.message).slice(0,90)}}};
const selected=(xs)=>Array.isArray(xs)?xs.filter(x=>suffix(x.phone)==='7896'):[];

export async function inspectOwner7896(){
 const matches=selected(rows("SELECT id,phone,stage,contact_permission FROM leads WHERE phone LIKE ? ORDER BY created_at DESC LIMIT 50",'%7896'));
 const contacts=[];
 for(const lead of matches.slice(0,4)){
  const key=lead.id,session=boundLeadSession(key);
  const pitch=one('SELECT stage,created_at,updated_at,attempt_at,due_at,audio_sent_at,followup_sent_at,last_error,session_id FROM owner_pitch_sequences WHERE lead_id=?',key);
  const intro=one('SELECT stage,first_reply_at,due_at,attempt_at,sent_at,reason,session_id FROM prospecting_introductions WHERE lead_id=?',key);
  const inbox=rows('SELECT state,received_at,session_id FROM waakg_inbox WHERE lead_id=? ORDER BY received_at DESC LIMIT 8',key);
  const messages=rows("SELECT m.direction,m.status,m.at,m.provider_id FROM messages m JOIN threads t ON m.thread_id=t.id WHERE t.lead_id=? ORDER BY m.at DESC LIMIT 12",key);
  let provider={status:'NOT_CHECKED'};
  if(session==='consecom-principal'){
   try{
    const reply=await waRequest('/api/chat/'+encodeURIComponent(session)+'/'+encodeURIComponent(lead.phone+'@s.whatsapp.net'));
    const msgs=Array.isArray(reply.data)?reply.data:[];
    provider={status:reply.status===false?'ERROR':'OK',count:msgs.length,
     latest:msgs.slice(-12).map(m=>({
      fromMe:m.fromMe===true,type:String(m.type||'').slice(0,24),
      at:m.timestamp||m.createdAt||null,
      isVoice:/audio|voice|ptt/i.test(String(m.type||''))
     }))};
   }catch(err){provider={status:'ERROR',reason:String(err.message).slice(0,110)};}
  }
  contacts.push({suffix:'7896',session,leadStage:lead.stage,consent:lead.contact_permission===1,
   intro,pitch,inbox:Array.isArray(inbox)?inbox:inbox.error,
   messages:Array.isArray(messages)?messages.map(m=>({direction:m.direction,status:m.status,at:m.at,
    kind:/owner-voice/.test(m.provider_id)?'owner-voice':/owner-preview/.test(m.provider_id)?'owner-preview':/intro:/.test(m.provider_id)?'intro':/prospect-queue/.test(m.provider_id)?'initial':'other'})):messages.error,
   provider});
 }
 return {at:new Date().toISOString(),requestedSender:'7336',matches:contacts.length,contacts};
}
