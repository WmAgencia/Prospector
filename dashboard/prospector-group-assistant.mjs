// The private WhatsApp group is a shared command room, not a sales lead.
// Authorization is based on the CURRENT WhatsApp group roster (not phone
// ownership, group title, message contents or a cached join event).
import crypto from 'node:crypto';
import {db,one,all,run,now,getSetting,setSetting,audit} from './db.mjs';
import {waRequest} from './waakg-control.mjs';
import {isManagedSession} from './waakg-session-registry.mjs';
import {privateGroupState,PROSPECTOR_GROUP_NAME} from './prospector-private-group.mjs';
import {dailyReport,reportText,localDay} from './notifications.mjs';
import {groqChat} from './groq-models.mjs';
import {safeMediaPath,fetchPrivateAudio} from './waakg-media.mjs';
import {transcribeAudio} from './waakg-audio-inbound.mjs';

db.exec("CREATE TABLE IF NOT EXISTS prospector_group_commands (event_id TEXT PRIMARY KEY, group_jid TEXT NOT NULL, sender_jid TEXT NOT NULL,session_id TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,received_at TEXT NOT NULL,updated_at TEXT NOT NULL,reply TEXT)");
db.exec("CREATE TABLE IF NOT EXISTS prospector_group_audio (event_id TEXT PRIMARY KEY,group_jid TEXT NOT NULL,sender_jid TEXT NOT NULL,session_id TEXT NOT NULL,media_path TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS prospector_group_confirmations (code TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,expires_at INTEGER NOT NULL,requested_by TEXT NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS prospector_group_daily_reports (day TEXT PRIMARY KEY,report_day TEXT NOT NULL,group_jid TEXT NOT NULL,status TEXT NOT NULL,attempted_at TEXT NOT NULL,accepted_id TEXT)");
db.exec("CREATE TABLE IF NOT EXISTS prospector_group_outgoing_guard (id TEXT PRIMARY KEY, group_jid TEXT NOT NULL, hash TEXT NOT NULL,at TEXT NOT NULL)");

const GROUP=/^\d{8,30}@g\.us$/;
const ID=/^[\w-]{5,150}$/;
const PARTICIPANT=/^\d{10,15}@(s\.whatsapp\.net|lid)$/;
const GROUP_ECHO_LOOKBACK=7*86400_000;
// Canonicalize line endings / invisible Unicode / whitespace across devices.
export const canonicalGroupText=value=>String(value??'').normalize('NFKC')
 .replace(/[\u200b-\u200f\u2060\ufeff]/g,'')
 // Cross-device formatting changes tabs/newlines/indentation in quoted text.
 // Treat those as the same outbound reply for loop detection.
 .replace(/\s+/g,' ').trim();
export const groupTextHash=value=>crypto.createHash('sha256').update(canonicalGroupText(value)).digest('hex');
export const looksLikeAutomatedReport=value=>{
 const x=canonicalGroupText(value);
 return /(?:📊\s*)?\*?Prospector\b[\s\S]{0,130}(?:relat[oó]rio di[aá]rio|relatorio diario)/i.test(x)&&
  /(?:Abordagens|Mensagens enviadas|Responderam|Interessados)/i.test(x);
};
// This migration quarantines replies queued by the previously broken
// handler so a process restart does not replay a stale self-message loop.
if(getSetting('prospector_group_echo_quarantine_20261107_v1',false)!==true){
 run("UPDATE prospector_group_commands SET state='REVIEW',updated_at=? WHERE state='PENDING'",now());
 setSetting('prospector_group_echo_quarantine_20261107_v1',true);
}

const normalize=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
const jid=x=>typeof x==='string'?x:String(x?.phoneNumber||x?.phone_number||x?.id||x?.jid||'');
function rosterIdentity(row){
 const values=typeof row==='string'?[row]:[row?.id,row?.jid,row?.phoneNumber,row?.phone_number,row?.phone];
 return values.map(v=>String(v||'')).filter(v=>PARTICIPANT.test(v));
}
const senderIdentities=data=>{
 const values=[data?.key?.participant,data?.sender,data?.participant];
 return [...new Set(values.flatMap(item=>rosterIdentity(item)))];
};
function groupEndpoint(sessionId,groupId){
 return '/api/groups/'+encodeURIComponent(sessionId)+'/'+encodeURIComponent(groupId);
}
export async function verifyGroupMember({sessionId,groupId,sender,request=waRequest}={}){
 if(process.env.PROSPECTOR_AUTO_GROUP_ENABLED==='false')return {ok:false,reason:'GROUP_ASSISTANT_DISABLED'};
 const saved=privateGroupState();
 if(!saved||saved.group_jid!==groupId||!GROUP.test(String(groupId||''))||
  !isManagedSession(sessionId)&&sessionId!==saved.owner_session)return {ok:false,reason:'NOT_MANAGED_GROUP'};
 if(!Array.isArray(sender)||!sender.length||!sender.every(x=>PARTICIPANT.test(x)))return {ok:false,reason:'SENDER_UNVERIFIED'};
 let metadata;
 try{metadata=await request(groupEndpoint(saved.owner_session,groupId));}
 catch{return {ok:false,reason:'GROUP_METADATA_UNAVAILABLE'};}
 if(metadata?.subject!==PROSPECTOR_GROUP_NAME||metadata?.id!==groupId||!Array.isArray(metadata?.participants))
  return {ok:false,reason:'GROUP_METADATA_MISMATCH'};
 const present=metadata.participants.some(p=>rosterIdentity(p).some(x=>sender.includes(x)));
 return {ok:present,reason:present?'CURRENT_MEMBER':'NOT_A_MEMBER'};
}
export function groupOperationSummary(){
 const paused=getSetting('paused',true)===true;
 return {
  prospection:paused?'PAUSADA':'ATIVA',
  discovery:getSetting('discovery_auto_enabled',false)?'LIGADA':'DESLIGADA',
  automatedApproach:getSetting('autonomous_outreach_enabled',false)?'HABILITADA':'DESABILITADA',
  dailyLimit:getSetting('daily_limit',250)
 };
}
function operationsText(){
 const o=groupOperationSummary();
 return ['🧭 *Operação do Prospector*',
  'Prospecção: '+o.prospection,'Descoberta automática: '+o.discovery,
  'Abordagem automática: '+o.automatedApproach,'Limite diário configurado: '+o.dailyLimit,
  'Esta é a operação do Prospector, não campanhas de anúncios.'].join('\n');
}
function previousLocalDay(date=new Date()){
 return localDay(new Date(date.getTime()-24*3600_000));
}
export function reportForGroup(date=localDay()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date)))throw Error('INVALID_DATE');
 return reportText(dailyReport(date));
}
function pendingConfirmation(sender){
 for(let i=0;i<8;i++){
  const code=String(crypto.randomInt(100000,1000000));
  if(one('SELECT 1 FROM prospector_group_confirmations WHERE code=?',code))continue;
  run('INSERT INTO prospector_group_confirmations(code,kind,status,expires_at,requested_by) VALUES(?,?,?,?,?)',
   code,'RESUME','PENDING',Date.now()+10*60_000,sender);
  return code;
 }
 throw Error('CONFIRMATION_UNAVAILABLE');
}
function confirmResume(code){
 const c=one("SELECT * FROM prospector_group_confirmations WHERE code=? AND status='PENDING' AND expires_at>?",code,Date.now());
 if(!c)return 'Código inválido ou expirado. Peça novamente a retomada.';
 // Anyone CURRENTLY in this group can confirm. This function is reachable
 // only after verifyGroupMember on that specific event.
 const changed=run("UPDATE prospector_group_confirmations SET status='USED' WHERE code=? AND status='PENDING'",code);
 if(!changed.changes)return 'Essa confirmação já foi utilizada.';
 setSetting('paused',false);
 audit('PROSPECTOR_GROUP_RESUMED',null,{confirmed:true});
 return '✅ Prospecção retomada. O sistema continuará respeitando os limites e horários de envio.';
}
export async function commandReply(text,{sender,ask=groqChat}={}){
 const raw=String(text||'').trim().slice(0,2200),n=normalize(raw);
 if(!n)return 'Não consegui entender a mensagem.';
 const confirm=n.match(/^confirmar\s+(\d{6})$/);
 if(confirm)return confirmResume(confirm[1]);
 if(/^(?:paus[ae]|par[ae]|interromp[ae]|suspend[ae])\b/.test(n)||
    /^(?:pode|preciso|quero|por favor|favor)\s+(?:paus|par|suspend|interromp)/.test(n)||
    /\b(?:pausa|pausar|parar|suspender)\s+(?:a\s+)?(?:prospeccao|abordagem|campanha|envios)/.test(n)){
  setSetting('paused',true);audit('PROSPECTOR_GROUP_PAUSED',null,{group:true});
  return '⏸️ Prospecção pausada. Nenhuma nova abordagem será iniciada enquanto estiver pausada.';
 }
 if(/\b(?:retomar|retoma|reativar|reativa|continuar\s+os\s+envios|despausar|resume)\b/.test(n)){
  const code=pendingConfirmation(sender);
  return 'Para retomar as abordagens automáticas, confirme no grupo: *CONFIRMAR '+code+'* (válido por 10 minutos).';
 }
 if(/\b(?:relatorio|resumo|balanco|quantas|quantos|resultados?|mensagens enviadas|prospeccoes feitas|interessados)\b/.test(n)){
  const date=/\bontem\b/.test(n)?previousLocalDay():localDay();
  return reportForGroup(date);
 }
 if(/\b(?:status|ativ[ao]s?|operacao|campanhas?|configuracao|rodando|funcionando)\b/.test(n))return operationsText();
 // Freeform language is permitted, but the model sees only these bounded
 // read-only tools, plus pause / request-resume. No lead-send or raw SQL.
 if(!process.env.GROQ_API_KEY)return 'Você pode pedir o relatório de hoje, o relatório de ontem, consultar o status ou pausar a prospecção.';
 const tools=[
  {name:'report',description:'Show daily prospecting counts for today or yesterday',properties:{when:{type:'string',enum:['today','yesterday']}}},
  {name:'status',description:'Read current Prospector operation state',properties:{}},
  {name:'pause',description:'Pause all Prospector outreach',properties:{}},
  {name:'request_resume',description:'Ask for a WhatsApp confirmation code before resuming outreach',properties:{}}
 ].map(x=>({type:'function',function:{name:x.name,description:x.description,parameters:{type:'object',properties:x.properties,additionalProperties:false}}}));
 const messages=[{role:'system',content:
 'Você é a Francisca, assistente do Prospector em um grupo privado com membros verificados. Responda em português brasileiro, com frases curtas. Para informações do sistema, use ferramentas; não invente números. Não exponha dados individuais de clientes nem segredos. Não faça envios para leads nem altere credenciais. Pausar é permitido. Retomar exige código explícito CONFIRMAR 123456. Não diga que uma ação ocorreu sem ferramenta.'
 },{role:'user',content:raw}];
 try{
  let result=await ask({task:'actions',messages,tools,maxTokens:500});
  for(let step=0;step<3&&result.choice?.tool_calls?.length;step++){
   messages.push(result.choice);
   for(const call of result.choice.tool_calls.slice(0,3)){
    let args={};try{args=JSON.parse(call.function?.arguments||'{}')}catch{}
    let reply;
    switch(call.function?.name){
     case 'report': reply=reportForGroup(args.when==='yesterday'?previousLocalDay():localDay());break;
     case 'status':reply=operationsText();break;
     case 'pause':setSetting('paused',true);audit('PROSPECTOR_GROUP_PAUSED',null,{group:true});reply='Prospecção pausada.';break;
     case 'request_resume':reply='Para retomar, envie CONFIRMAR '+pendingConfirmation(sender)+'.';break;
     default:reply='Ferramenta indisponível.';
    }
    messages.push({role:'tool',tool_call_id:call.id,content:reply});
   }
   result=await ask({task:'actions',messages,tools,maxTokens:600});
  }
  return String(result.choice?.content||'Não consegui responder agora.').trim().slice(0,2600)||'Não consegui responder agora.';
 }catch{return 'Não consegui consultar a IA agora. Peça um relatório, consulte o status ou pause a prospecção.';}
}
// All messages authored by the Prospector use WhatsApp's bold marker,
// followed by exactly ONE newline before the message body.
export function formatProspectorGroupReply(text){
 const prefix='*PROSPECTOR*\n';
 let body=String(text??'').trim().replace(/^(?:\*PROSPECTOR\*\s*)+/i,'').trim();
 if(!body)return '';
 return prefix+body.slice(0,3000-prefix.length);
}
export async function sendGroupMessage({sessionId,groupId,text,request=waRequest}={}){
 if(!GROUP.test(String(groupId||'')))return {ok:false};
 const actual=formatProspectorGroupReply(text);
 if(!actual)return {ok:false};
 // Register the reply BEFORE the gateway call. WhatsApp's message.sent webhook
 // may arrive before HTTP acknowledgement; this pre-claim prevents bot loops.
 const hash=groupTextHash(actual);
 run('INSERT INTO prospector_group_outgoing_guard(id,group_jid,hash,at) VALUES(?,?,?,?)',
  crypto.randomUUID(),groupId,hash,now());
 run("DELETE FROM prospector_group_outgoing_guard WHERE at<?",new Date(Date.now()-GROUP_ECHO_LOOKBACK).toISOString());
 const payload=await request('/api/messages/'+encodeURIComponent(sessionId)+'/'+encodeURIComponent(groupId)+'/send',
  {method:'POST',data:{message:{text:actual}}});
 // A positive ack means gateway accepted, not necessarily delivered to every phone.
 return {ok:payload.status===true,acceptedId:String(payload.data?.key?.id||payload.data?.id||'')};
}
let running=false;
export async function receivePrivateGroupWebhook({sessionId,data={},request=waRequest,event='message.received',getSessions}={}){
 const key=data.key||{},groupId=String(key.remoteJid||data.from||'');
 if(!data.isGroup||!GROUP.test(groupId))return {handled:false};
 const fromMe=key.fromMe===true||data.fromMe===true;
 // A message sent by Prospector on session A appears as a normal incoming
 // message on sessions B, C, ... . Check every group webhook, not just
 // fromMe/message.sent, BEFORE authorizing or queueing a new command.
 const body=typeof data.content==='string'?data.content:String(data.content?.text||data.content?.body||data.content?.caption||'');
 if(body){
  const echo=groupTextHash(body);
  if(one('SELECT 1 FROM prospector_group_outgoing_guard WHERE group_jid=? AND hash=? AND at>? LIMIT 1',
    groupId,echo,new Date(Date.now()-GROUP_ECHO_LOOKBACK).toISOString()))
   return {handled:true,accepted:true,ignored:true,reason:'BOT_ECHO_ALL_SESSIONS'};
  // Defensive fallback for reports from the old version, before the hash
  // guard was durable or if the gateway reformats a generated message.
  if(looksLikeAutomatedReport(body))
   return {handled:true,accepted:true,ignored:true,reason:'GENERATED_REPORT'};
 }
 if(event==='message.sent'&&!fromMe)
  return {handled:true,accepted:true,ignored:true,reason:'UNTRUSTED_SENT_EVENT'};
 let actor=senderIdentities(data);
 if(fromMe){
  if(event!=='message.sent')return {handled:true,accepted:true,ignored:true,reason:'FROM_ME_NOT_SENT_EVENT'};
  // The person who connected the very first WhatsApp must also be able to
  // send commands while alone in the group. Verify the current live identity
  // of THAT authenticated session, rather than trusting a supplied sender JID.
  const pool=getSessions?await getSessions():await import('./waakg-control.mjs').then(m=>m.waSessionList());
  const connected=(pool?.items||[]).find(x=>x.sessionId===sessionId&&x.connected===true);
  if(!connected||!/^55\d{10,11}$/.test(String(connected.number||'')))return {handled:true,accepted:false,reason:'SENDER_NOT_CONNECTED'};
  actor=[connected.number+'@s.whatsapp.net'];
  // Echo protection already applies to all sessions above.
 }
 const authorized=await verifyGroupMember({sessionId,groupId,sender:actor,request});
 if(!authorized.ok)return {handled:true,accepted:false,reason:authorized.reason};
 const messageId=String(key.id||data.id||'');
 if(!ID.test(messageId))return {handled:true,accepted:false,reason:'INVALID_MESSAGE_ID'};
 const unique=groupId+':'+messageId;
 if(one('SELECT 1 FROM prospector_group_commands WHERE event_id=?',unique)||
    one('SELECT 1 FROM prospector_group_audio WHERE event_id=?',unique))
  return {handled:true,accepted:true,duplicate:true};
 const media=String(data.type||'').toUpperCase()==='AUDIO';
 if(media){
  if(process.env.AUDIO_TRANSCRIPTION_ENABLED!=='true')return {handled:true,accepted:false,reason:'TRANSCRIPTION_DISABLED'};
  const mediaPath=safeMediaPath(data.fileUrl);
  if(!mediaPath)return {handled:true,accepted:false,reason:'INVALID_AUDIO_URL'};
  run('INSERT INTO prospector_group_audio(event_id,group_jid,sender_jid,session_id,media_path,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
   unique,groupId,actor[0],sessionId,mediaPath,'PENDING',now(),now());
  return {handled:true,accepted:true,audioQueued:true};
 }
 const content=typeof data.content==='string'?data.content:String(data.content?.text||'');
 if(!content.trim())return {handled:true,accepted:true,ignored:true};
 return await queueGroupCommand({unique,sessionId,groupId,sender:actor[0],text:content,request});
}
export async function queueGroupCommand({unique,sessionId,groupId,sender,text,request=waRequest}={}){
 if(process.env.PROSPECTOR_AUTO_GROUP_ENABLED==='false')return {handled:true,accepted:false,reason:'GROUP_DISABLED'};
 const clean=canonicalGroupText(text);
 if(looksLikeAutomatedReport(clean))return {handled:true,accepted:true,ignored:true,reason:'GENERATED_REPORT'};
 const recentMinute=one('SELECT COUNT(*) AS n FROM prospector_group_commands WHERE group_jid=? AND received_at>=?',
   groupId,new Date(Date.now()-60_000).toISOString())?.n||0;
 const recentHour=one('SELECT COUNT(*) AS n FROM prospector_group_commands WHERE group_jid=? AND received_at>=?',
   groupId,new Date(Date.now()-3600_000).toISOString())?.n||0;
 if(recentMinute>=10||recentHour>=50)return {handled:true,accepted:false,reason:'RATE_LIMIT'};
 const nearDuplicate=one('SELECT 1 FROM prospector_group_commands WHERE group_jid=? AND sender_jid=? AND body=? AND received_at>=? LIMIT 1',
  groupId,sender,clean,new Date(Date.now()-15000).toISOString());
 if(nearDuplicate)return {handled:true,accepted:true,duplicate:true,reason:'RECENT_DUPLICATE'};
 const inserted=run('INSERT OR IGNORE INTO prospector_group_commands(event_id,group_jid,sender_jid,session_id,kind,body,state,received_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
 unique,groupId,sender,sessionId,'TEXT',clean.slice(0,2200),'PENDING',now(),now());
 if(!inserted.changes)return {handled:true,accepted:true,duplicate:true};
 setImmediate(()=>processGroupCommands({request}).catch(err=>console.warn('[group command]',String(err?.message||err).slice(0,100))));
 return {handled:true,accepted:true,queued:true};
}
export async function processGroupCommands({ask=groqChat,request=waRequest}={}){
 if(process.env.PROSPECTOR_AUTO_GROUP_ENABLED==='false')return {state:'DISABLED'};
 if(running)return {state:'BUSY'};running=true;
 try{
  // Persisted queues survive restarts; a failed uncertain send is never resent.
  const item=one("SELECT * FROM prospector_group_commands WHERE state='PENDING' ORDER BY received_at LIMIT 1");
  if(!item)return {state:'IDLE'};
  const permitted=await verifyGroupMember({sessionId:item.session_id,groupId:item.group_jid,sender:[item.sender_jid],request});
  if(!permitted.ok){
   run("UPDATE prospector_group_commands SET state='REJECTED',updated_at=? WHERE event_id=?",now(),item.event_id);
   return {state:'REJECTED',reason:permitted.reason};
  }
  // Only one execution even across interrupted workers.
  if(!run("UPDATE prospector_group_commands SET state='PROCESSING',updated_at=? WHERE event_id=? AND state='PENDING'",now(),item.event_id).changes)return {state:'BUSY'};
  let response;
  try{response=await commandReply(item.body,{sender:item.sender_jid,ask});}
  catch(e){response='Não consegui processar esse pedido agora.';}
  run("UPDATE prospector_group_commands SET state='SENDING',reply=?,updated_at=? WHERE event_id=?",response,now(),item.event_id);
  try{
   const sent=await sendGroupMessage({sessionId:privateGroupState()?.owner_session||item.session_id,groupId:item.group_jid,text:response,request});
   run("UPDATE prospector_group_commands SET state=?,updated_at=? WHERE event_id=?",sent.ok?'DONE':'UNKNOWN',now(),item.event_id);
   return {state:sent.ok?'DONE':'UNKNOWN'};
  }catch{
   run("UPDATE prospector_group_commands SET state='UNKNOWN',updated_at=? WHERE event_id=?",now(),item.event_id);
   return {state:'UNKNOWN'};
  }
 }finally{running=false;}
}
let audioBusy=false;
export async function processGroupAudio({download=fetchPrivateAudio,transcribe=transcribeAudio,request=waRequest}={}){
 if(process.env.PROSPECTOR_AUTO_GROUP_ENABLED==='false')return {state:'DISABLED'};
 if(audioBusy)return {state:'BUSY'};
 audioBusy=true;
 try{
  const job=one("SELECT * FROM prospector_group_audio WHERE state='PENDING' ORDER BY created_at LIMIT 1");
  if(!job)return {state:'IDLE'};
  const verified=await verifyGroupMember({sessionId:job.session_id,groupId:job.group_jid,sender:[job.sender_jid],request});
  if(!verified.ok){
   run("UPDATE prospector_group_audio SET state='REJECTED',updated_at=? WHERE event_id=?",now(),job.event_id);
   return {state:'REJECTED'};
  }
  if(!run("UPDATE prospector_group_audio SET state='PROCESSING',updated_at=? WHERE event_id=? AND state='PENDING'",now(),job.event_id).changes)return {state:'BUSY'};
  try{
   const audio=await download(job.media_path,{session:job.session_id});
   const recognized=await transcribe({buffer:audio.buffer,filename:audio.filename});
   const queued=await queueGroupCommand({unique:job.event_id,sessionId:job.session_id,groupId:job.group_jid,
    sender:job.sender_jid,text:recognized.text,request});
   run("UPDATE prospector_group_audio SET state='DONE',updated_at=? WHERE event_id=?",now(),job.event_id);
   audit('GROUP_AUDIO_TRANSCRIBED',null,{chars:recognized.text.length});
   return {state:'DONE',queued:queued.queued===true};
  }catch{
   run("UPDATE prospector_group_audio SET state='REVIEW',updated_at=? WHERE event_id=?",now(),job.event_id);
   return {state:'REVIEW'};
  }
 }finally{audioBusy=false;}
}
export async function scheduledGroupReport(at=new Date(),{request=waRequest}={}){
 if(process.env.PROSPECTOR_AUTO_GROUP_ENABLED==='false')return {state:'DISABLED'};
 // 08:00 São Paulo, report on the COMPLETE previous business day.
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',hour:'2-digit',hour12:false}).format(at))%24;
 if(hour!==8)return {state:'OUTSIDE_REPORT_HOUR'};
 const group=privateGroupState();
 if(!group?.group_jid||group.state!=='READY')return {state:'GROUP_NOT_READY'};
 const day=localDay(at),reportDay=previousLocalDay(at);
 if(one('SELECT 1 FROM prospector_group_daily_reports WHERE day=?',day))return {state:'ALREADY_ATTEMPTED'};
 const inserted=run('INSERT OR IGNORE INTO prospector_group_daily_reports(day,report_day,group_jid,status,attempted_at) VALUES(?,?,?,?,?)',
  day,reportDay,group.group_jid,'SENDING',now());
 if(!inserted.changes)return {state:'ALREADY_ATTEMPTED'};
 try{
  const sent=await sendGroupMessage({sessionId:group.owner_session,groupId:group.group_jid,text:reportForGroup(reportDay),request});
  run('UPDATE prospector_group_daily_reports SET status=?,accepted_id=? WHERE day=?',sent.ok?'SENT':'UNKNOWN',sent.acceptedId||null,day);
  audit('GROUP_DAILY_REPORT',null,{status:sent.ok?'SENT':'UNKNOWN',day,reportDay});
  return {state:sent.ok?'SENT':'UNKNOWN',reportDay};
 }catch{
  run("UPDATE prospector_group_daily_reports SET status='UNKNOWN' WHERE day=?",day);
  return {state:'UNKNOWN'};
 }
}

let lastWebhookSweep=0;
export async function ensureGroupWebhookSubscriptions({request=waRequest,getSessions}={}){
 if(process.env.PROSPECTOR_AUTO_GROUP_ENABLED==='false')return {state:'DISABLED'};
 if(Date.now()-lastWebhookSweep<5*60_000)return {state:'COOLDOWN'};
 const group=privateGroupState();
 if(!group?.group_jid)return {state:'GROUP_NOT_READY'};
 const secret=String(process.env.WA_AKG_WEBHOOK_SECRET||'');
 if(secret.length<40)return {state:'WEBHOOK_SECRET_MISSING'};
 const sessions=getSessions?await getSessions():await import('./waakg-control.mjs').then(m=>m.waSessionList());
 const base='https://prospector-operacional-production.up.railway.app/api/wa-akg/webhook';
 const url=base+(process.env.PROSPECTOR_TENANT_ID?'?tenant='+encodeURIComponent(process.env.PROSPECTOR_TENANT_ID):'');
 let ensured=0,errors=0;
 for(const candidate of (sessions?.items||[]).filter(x=>x.connected===true)){
  const id=String(candidate.sessionId||'');
  if(!/^[a-zA-Z0-9_-]{3,70}$/.test(id)||id!==group.owner_session&&!isManagedSession(id))continue;
  try{
   const path='/api/webhooks/'+encodeURIComponent(id);
   const existing=await request(path);
   const hooks=(Array.isArray(existing.data)?existing.data:[]).filter(h=>h.isActive!==false&&h.url===url);
   const hasReceived=hooks.some(h=>Array.isArray(h.events)&&h.events.includes('message.received'));
   const hasSent=hooks.some(h=>Array.isArray(h.events)&&h.events.includes('message.sent'));
   if(!hasReceived)await request(path,{method:'POST',data:{name:'Meu Prospector — comandos',url,secret,
    events:['message.received','connection.update',...(!hasSent?['message.sent']:[])]}});
   else if(!hasSent)await request(path,{method:'POST',data:{name:'Meu Prospector — comandos enviados',url,secret,
    events:['message.sent']}});
   ensured++;
  }catch{errors++;}
 }
 lastWebhookSweep=Date.now();
 return {state:errors?'PARTIAL':'READY',sessions:ensured,errors};
}
