import fs from 'node:fs';
import path from 'node:path';
import {one,all,run,tx,id,now,phone,getSetting,addLead,getThread,addMessage,stage,audit,stopLead,suppressed} from './db.mjs';
import {classify,renderTemplate} from './classifier.mjs';
import {onReply,cancelForOptOut,onSent,onUnknown,requestFromAutomation} from './production.mjs';
import {evaluateDecision,selectAutomationForLead} from './automation-router.mjs';
import {scheduleReport,flushNotices} from './notifications.mjs';

let sock=null,connecting=false,waStatus='DISCONNECTED',qrData=null,lastError=null,waUser=null;
let notifier=()=>{};
let locked=false;
export function setNotifier(fn){notifier=fn;}
const publish=()=>{try{notifier();}catch{}};
export function connection(){return {status:waStatus,qr:qrData,user:waUser,error:lastError};}
function jidFor(lead) {
 const thread=one('SELECT jid FROM threads WHERE lead_id=?',lead.id);
 return thread?.jid&&thread.jid.endsWith('@lid')?thread.jid:(lead.phone?lead.phone+'@s.whatsapp.net':thread?.jid);
}
export async function connectWhatsApp(){
 if(connecting||waStatus==='CONNECTED')return connection();
 connecting=true;waStatus='CONNECTING';lastError=null;publish();
 try{
  const B=await import('@whiskeysockets/baileys');
  const Q=await import('qrcode');
  const dir=path.resolve('wa-session');fs.mkdirSync(dir,{recursive:true});
  const {state,saveCreds}=await B.useMultiFileAuthState(dir);
  const {version}=await B.fetchLatestBaileysVersion();
  const socket=B.default({version,auth:state,printQRInTerminal:false,
   logger:{level:'silent',child(){return this;},trace(){},debug(){},info(){},warn(){},error(){},fatal(){}}});
  sock=socket;
  socket.ev.on('creds.update',saveCreds);
  socket.ev.on('connection.update',async u=>{
   if(u.qr){try{qrData=await Q.default.toDataURL(u.qr,{width:320,margin:2});waStatus='QR_READY';}catch(e){lastError=e.message;}publish();}
   if(u.connection==='open'){waStatus='CONNECTED';qrData=null;waUser=socket.user?.id||null;connecting=false;publish();}
   if(u.connection==='close'){
    const reason=u.lastDisconnect?.error?.output?.statusCode;
    waStatus=reason===B.DisconnectReason.loggedOut?'LOGGED_OUT':'DISCONNECTED';
    lastError=String(u.lastDisconnect?.error?.message||reason||'conexão fechada');
    connecting=false;sock=null;qrData=null;publish();
   }
  });
  socket.ev.on('messages.upsert',async event=>{
   if(event.type!=='notify')return;
   for(const m of event.messages||[]){
    try{await incoming(m);}catch(e){audit('INBOUND_ERROR',null,{error:e.message});}
   }
  });
 }catch(e){waStatus='ERROR';lastError=e.message;connecting=false;publish();}
 return connection();
}
export async function disconnectWhatsApp(){
 if(sock){try{sock.end(new Error('Desconectado pelo painel'));}catch{}}
 sock=null;connecting=false;waStatus='DISCONNECTED';qrData=null;publish();return connection();
}
function formMessage(m){
 const x=m.message||{};
 const body=x.conversation||x.extendedTextMessage?.text||x.imageMessage?.caption||x.videoMessage?.caption||x.documentMessage?.caption||'';
 const type=x.audioMessage?'audio':x.videoMessage?'video':x.imageMessage?'image':x.documentMessage?'file':'text';
 return {body,type};
}

// Executa apenas quando o bloco anterior aguardava resposta. Não processa textos isolados.
export function handleDecision(leadId,text,isText=true){
 const exec=one("SELECT * FROM executions WHERE lead_id=? AND state='WAIT_REPLY'",leadId);
 if(!exec)return null;
 const steps=JSON.parse(exec.steps),choice=steps[exec.next_step];
 if(choice?.type!=='decision')return null;
 const outcome=isText?evaluateDecision(text,choice.context):{decision:'REVIEW',reason:'media_not_transcribed'};
 if(outcome.decision==='REVIEW'){
  run("UPDATE executions SET state='NEEDS_REVIEW',updated_at=? WHERE id=?",now(),exec.id);
  audit('AUTOMATION_REPLY_REVIEW',leadId,{workflowId:exec.workflow_id,reason:outcome.reason,step:exec.next_step});
  return outcome;
 }
 return tx(()=>{
  const latest=one("SELECT * FROM executions WHERE id=? AND state='WAIT_REPLY'",exec.id);
  if(!latest||latest.next_step!==exec.next_step)return {decision:'REVIEW',reason:'already_processed'};
  const accepted=outcome.decision==='YES',prefix=accepted?'yes':'no',action=choice[prefix+'_action']||'end';
  const type=choice[prefix+'_type']||'message';
  const response=String(choice[prefix+'_text']||'').trim();
  const mediaId=choice[prefix+'_media_id']||null;
  const lead=one('SELECT * FROM leads WHERE id=?',leadId);
  if(!lead||!lead.contact_permission||suppressed(lead.phone))throw Error('Lead não autorizado');
  if(response||type==='audio'){
   const jid=id(),key='decision:'+exec.id+':'+exec.next_step+':'+prefix;
   run("INSERT OR IGNORE INTO jobs(id,lead_id,type,text,media_id,key,status,created_at,updated_at) VALUES(?,?,?,?,? ,?,'PENDING',?,?)",
     jid,leadId,type,response,mediaId,key,now(),now());
  }
  if(accepted&&action==='request_sample'){
   run("UPDATE executions SET state='COMPLETE',next_step=next_step+1,updated_at=? WHERE id=?",now(),exec.id);
   requestFromAutomation(leadId,exec.workflow_id);
  }else if(action==='continue'){
   run("UPDATE executions SET state='ACTIVE',next_step=next_step+1,updated_at=? WHERE id=?",now(),exec.id);
   stage(leadId,accepted?'INTERESTED':'REPLIED','Respondeu a pergunta da automação');
  }else{
   run("UPDATE executions SET state='COMPLETE',next_step=next_step+1,updated_at=? WHERE id=?",now(),exec.id);
   stage(leadId,accepted?'INTERESTED':'NO_INTEREST','Automação finalizada por resposta');
  }
  audit('AUTOMATION_DECISION',leadId,{workflowId:exec.workflow_id,decision:outcome.decision,context:choice.context,action});
  return {...outcome,action,shouldContinue:action==='continue',executionId:exec.id};
 });
}

export async function incoming(m) {
 const from=m.key?.remoteJid||'',alt=m.key?.remoteJidAlt||'';
 if(!m.message||m.key?.fromMe||from.endsWith('@g.us')||from.endsWith('@newsletter')||from==='status@broadcast')return;
 const jid=alt.endsWith('@s.whatsapp.net')?alt:from;
 const ph=jid.endsWith('@s.whatsapp.net')?phone(jid):null;
 let thread=one('SELECT * FROM threads WHERE jid=?',from)||one('SELECT * FROM threads WHERE jid=?',alt);
 let lead=thread?one('SELECT * FROM leads WHERE id=?',thread.lead_id):null;
 if(!lead&&ph)lead=one('SELECT * FROM leads WHERE phone=?',ph);
 if(!lead&&ph){
  lead=addLead({business:m.pushName||ph,phone:ph,source:'WHATSAPP_INBOUND',contact_permission:true}).lead;
  stage(lead.id,'REPLIED','mensagem iniciada pelo contato');
 }
 if(!lead){audit('UNRESOLVED_INCOMING',null,{jid:from,alt,providerId:m.key?.id});return;}
 thread=getThread(lead.id,from);
 const payload=formMessage(m);
 const saved=addMessage({threadId:thread.id,providerId:m.key.id||null,direction:'in',type:payload.type,body:payload.body,status:'received'});
 if(!saved)return; // webhook duplicado
 const result=payload.type==='text'?classify(payload.body):{intent:'UNCERTAIN',confidence:0,matched_rules:['MEDIA'],requires_human:true,allow_media:false};
 audit('INTENT_CLASSIFIED',lead.id,{intent:result.intent,matched_rules:result.matched_rules,confidence:result.confidence});
 if(result.intent==='OPT_OUT'){
  stopLead(lead.id,result.intent);cancelForOptOut(lead.id);publish();return;
 }
 const routing=handleDecision(lead.id,payload.body,payload.type==='text');
 if(routing){if(routing.shouldContinue)drive(routing.executionId);publish();return;}
 if(result.intent==='NOT_INTERESTED'){
  stopLead(lead.id,result.intent);cancelForOptOut(lead.id);publish();return;
 }
 const sampleReply=onReply(lead.id,payload.body,payload.type==='text');
 if(sampleReply){publish();return;}
 const manual=one('SELECT manual_takeover FROM threads WHERE id=?',thread.id)?.manual_takeover;
 if(['INTERESTED','QUESTION','UNCERTAIN'].includes(result.intent)){
  stage(lead.id,'INTERESTED',result.intent);
  if(result.intent==='UNCERTAIN'){
   run("UPDATE executions SET state='NEEDS_REVIEW',updated_at=? WHERE lead_id=? AND state IN ('WAIT_REPLY','WAIT_DELAY','ACTIVE')",now(),lead.id);
   run("UPDATE jobs SET status='CANCELLED',updated_at=? WHERE lead_id=? AND status='PENDING' AND execution_id IS NOT NULL",now(),lead.id);
   publish();return;
  }
 }else stage(lead.id,'REPLIED','resposta recebida');
 if(!manual&&getSetting('automation_enabled',true)){
  const execution=one("SELECT * FROM executions WHERE lead_id=? AND state='WAIT_REPLY'",lead.id);
  if(execution){run("UPDATE executions SET state='ACTIVE',updated_at=? WHERE id=?",now(),execution.id);drive(execution.id);}
 }
 publish();
}
export function saveWorkflow(input){
 const steps=input.steps;
 if(!Array.isArray(steps)||steps.length<2||steps.length>30)throw Error('Workflow deve ter entre 2 e 30 blocos');
 const allowed=['message','wait_reply','delay','video','audio','image','decision','end'];
 for(const [index,s] of steps.entries()){
  if(!allowed.includes(s.type))throw Error('Bloco inválido: '+s.type);
  if(s.type==='message'&&!String(s.text||'').trim())throw Error('Bloco de texto vazio');
  if(s.type==='delay'&&(!Number.isInteger(Number(s.seconds))||Number(s.seconds)<1||Number(s.seconds)>86400))throw Error('Delay inválido');
  if(s.type==='decision'){
   if(index===0||steps[index-1]?.type!=='wait_reply')throw Error('Decisão deve vir logo após Aguardar resposta');
   if(!['sample_offer','general_interest'].includes(s.context))throw Error('Escolha o contexto da pergunta');
   if(!String(s.context_description||'').trim())throw Error('Descreva a pergunta usada para interpretar a resposta');
   for(const side of ['yes','no']){
    if(!['message','audio'].includes(s[side+'_type']||'message'))throw Error('Resposta deve ser texto ou áudio');
    if(!['end','continue','request_sample'].includes(s[side+'_action']||'end'))throw Error('Ação inválida na decisão');
    if(side==='no'&&s.no_action==='request_sample')throw Error('Recusa não pode solicitar site');
    if(s[side+'_action']==='request_sample'&&s.context!=='sample_offer')throw Error('Solicitação de site exige contexto oferta de exemplo');
    if(s[side+'_type']==='audio'){
     if(!String(s[side+'_audio_description']||'').trim())throw Error('Descreva o áudio da resposta '+side);
     const media=one('SELECT * FROM media WHERE id=?',s[side+'_media_id']||'');
     if(media?.kind!=='audio')throw Error('Escolha o áudio da resposta '+side);
    }else if(!String(s[side+'_text']||'').trim())throw Error('Escreva a resposta '+side);
   }
  }
  if(['video','audio','image'].includes(s.type)){
   const asset=one('SELECT * FROM media WHERE id=?',s.media_id||'');
   if(!asset||asset.kind!==s.type)throw Error('Mídia indisponível para o bloco '+s.type);
   if(s.type==='audio'&&!String(s.description||'').trim())throw Error('Preencha a descrição do áudio para orientar a classificação contextual');
  }
 }
 if(steps[0].type!=='message')throw Error('O primeiro bloco deve ser uma mensagem inicial');
 const segments=Array.isArray(input.segments)?input.segments:String(input.segments||'').split(',');
 const tags=[...new Set(segments.map(v=>String(v).trim()).filter(Boolean))];
 if(tags.length>25||tags.some(x=>x.length>80))throw Error('Máximo de 25 segmentos, 80 caracteres cada');
 const tagJson=JSON.stringify(tags);
 const enabled=input.enabled===false?0:1;
 if(steps[steps.length-1].type!=='end')throw Error('Último bloco deve ser FIM');
 if(input.id){
  const w=one('SELECT * FROM workflows WHERE id=?',input.id);if(!w)throw Error('Workflow inexistente');
  run('UPDATE workflows SET name=?,version=?,steps=?,segments_json=?,enabled=?,updated_at=? WHERE id=?',String(input.name||w.name),w.version+1,JSON.stringify(steps),tagJson,enabled,now(),w.id);
  audit('WORKFLOW_UPDATED',null,{id:w.id,version:w.version+1});return w.id;
 }
 const workflowId=id();
 run('INSERT INTO workflows(id,name,is_default,version,steps,created_at,updated_at,segments_json,enabled) VALUES(?,?,?,?,?,?,?,?,?)',workflowId,String(input.name||'Nova automação'),0,1,JSON.stringify(steps),now(),now(),tagJson,enabled);
 return workflowId;
}
export function setDefaultWorkflow(workflowId){
 if(!one('SELECT id FROM workflows WHERE id=?',workflowId))throw Error('Workflow inválido');
 tx(()=>{run('UPDATE workflows SET is_default=0');run('UPDATE workflows SET is_default=1 WHERE id=?',workflowId);});
}
export function startWorkflow(leadId,selectedAutomationId=null){
 return tx(()=>{
  const lead=one('SELECT * FROM leads WHERE id=?',leadId);
  if(!lead)throw Error('Lead não encontrado');
  if(!lead.phone)throw Error('Lead sem WhatsApp');
  if(lead.stage==='NO_INTEREST'||lead.stage==='CLOSED_WON')throw Error('Lead recusou contato ou negociação concluída');
  if(!lead.contact_permission)throw Error('Canal não autorizado: marque contato permitido para esse lead');
  if(suppressed(lead.phone))throw Error('Contato bloqueado/opt-out');
  if(one('SELECT lead_id FROM initial_contacts WHERE phone=? OR lead_id=?',lead.phone,leadId))throw Error('Primeira abordagem já registrada');
  if(one('SELECT id FROM executions WHERE lead_id=?',leadId))throw Error('Lead já possui workflow iniciado');
  const wf=selectAutomationForLead(lead,all('SELECT * FROM workflows'),selectedAutomationId);
  if(!wf)throw Error('Não existe automação ativa aplicável ao segmento');
  const runId=id();
  run("INSERT INTO executions(id,lead_id,workflow_id,version,steps,next_step,state,updated_at) VALUES(?,?,?,?,?,0,'ACTIVE',?)",runId,leadId,wf.id,wf.version,wf.steps,now());
  audit('WORKFLOW_STARTED',leadId,{workflowId:wf.id,version:wf.version});
  return runId;
 });
}
export function drive(runId){
 for(let i=0;i<50;i++){
  const r=one('SELECT * FROM executions WHERE id=?',runId);if(!r||r.state!=='ACTIVE')return;
  const lead=one('SELECT * FROM leads WHERE id=?',r.lead_id);
  if(!lead||suppressed(lead.phone))return;
  const takeover=one('SELECT manual_takeover FROM threads WHERE lead_id=?',lead.id);
  if(takeover?.manual_takeover)return;
  const steps=JSON.parse(r.steps),step=steps[r.next_step];
  if(!step||step.type==='end'){run("UPDATE executions SET state='COMPLETE',updated_at=? WHERE id=?",now(),runId);publish();return;}
  if(step.type==='decision'){run("UPDATE executions SET state='NEEDS_REVIEW',updated_at=? WHERE id=?",now(),runId);audit('AUTOMATION_INVALID_DECISION',lead.id,{runId});publish();return;}
  if(step.type==='wait_reply'){run("UPDATE executions SET state='WAIT_REPLY',next_step=next_step+1,updated_at=? WHERE id=?",now(),runId);publish();return;}
  if(step.type==='delay'){
   const wake=new Date(Date.now()+Math.round(Number(step.seconds))*1000).toISOString();
   run("UPDATE executions SET state='WAIT_DELAY',wake_at=?,next_step=next_step+1,updated_at=? WHERE id=?",wake,now(),runId);publish();return;
  }
  const initial=r.next_step===0,kind=step.type;
  if(!['message','video','audio','image'].includes(kind))throw Error('Tipo de bloco inválido');
  const jobId=id(),key='workflow:'+runId+':'+r.next_step;
  const text=kind==='message'?renderTemplate(step.text,lead):'';
  if(initial){
   if(!lead.contact_permission)throw Error('Sem autorização de contato');
   try{run("INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,'RESERVED',?,?)",lead.id,lead.phone,jobId,now());}
   catch{run("UPDATE executions SET state='NEEDS_REVIEW',updated_at=? WHERE id=?",now(),runId);return;}
  }
  run("INSERT OR IGNORE INTO jobs(id,lead_id,execution_id,step_index,type,text,media_id,key,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
   jobId,lead.id,runId,r.next_step,kind,text,step.media_id||null,key,'PENDING',now(),now());
  run("UPDATE executions SET state='SENDING',next_step=next_step+1,updated_at=? WHERE id=?",now(),runId);publish();return;
 }
}
export function manualJob(leadId,text,type='message',mediaId=null){
 const lead=one('SELECT * FROM leads WHERE id=?',leadId);if(!lead||!lead.phone)throw Error('Lead sem telefone');
 if(suppressed(lead.phone))throw Error('Contato não pode receber mensagens');
 const t=getThread(leadId);
 const jobId=id();run("INSERT INTO jobs(id,lead_id,type,text,media_id,key,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'PENDING',?,?)",jobId,leadId,type,String(text||''),mediaId,'manual:'+jobId,now(),now());
 audit('MANUAL_MESSAGE_QUEUED',leadId,{type});publish();return jobId;
}
export function takeover(threadId,value){
 const t=one('SELECT * FROM threads WHERE id=?',threadId);if(!t)throw Error('Conversa inexistente');
 run('UPDATE threads SET manual_takeover=? WHERE id=?',value?1:0,threadId);
 if(value){
  run("UPDATE jobs SET status='CANCELLED',updated_at=? WHERE lead_id=? AND status='PENDING' AND execution_id IS NOT NULL",now(),t.lead_id);
  run("UPDATE executions SET state='NEEDS_REVIEW',updated_at=? WHERE lead_id=? AND state NOT IN ('COMPLETE','CANCELLED')",now(),t.lead_id);
 }
 audit('TAKEOVER',t.lead_id,{enabled:value});publish();
}
function insideHours(){
 const h=Number(new Intl.DateTimeFormat('en-US',{hour:'numeric',hour12:false,timeZone:'America/Sao_Paulo'}).format(new Date()));
 return h>=Number(getSetting('business_start',8))&&h<Number(getSetting('business_end',21));
}
function canInitial(){
 if(getSetting('paused',true)||!insideHours())return false;
 const sent=one("SELECT MAX(updated_at) as last FROM jobs WHERE execution_id IS NOT NULL AND step_index=0 AND status='SENT'");
 if(sent?.last&&Date.now()-new Date(sent.last).getTime()<Number(getSetting('min_minutes',5))*60000)return false;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const count=all("SELECT updated_at FROM jobs WHERE execution_id IS NOT NULL AND step_index=0 AND status='SENT'").filter(x=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x.updated_at))===today).length;
 return count<Number(getSetting('daily_limit',96));
}
async function send(job,lead){
 if(waStatus!=='CONNECTED'||!sock)throw Error('WhatsApp desconectado');
 const jid=jidFor(lead);if(!jid)throw Error('JID não encontrado');
 let payload={text:job.text};
 if(job.type!=='message'){
  const media=one('SELECT * FROM media WHERE id=?',job.media_id);if(!media)throw Error('Mídia inexistente');
  const buf=fs.readFileSync(path.join('data','media',media.filename));
  if(job.type==='video')payload={video:buf,mimetype:media.mime};
  else if(job.type==='audio')payload={audio:buf,mimetype:media.mime,ptt:/opus|ogg/.test(media.mime)};
  else if(job.type==='image')payload={image:buf,mimetype:media.mime};
 }
 return {ack:await sock.sendMessage(jid,payload),jid};
}
export async function tick(){
 if(locked)return;locked=true;
 try{
  for(const r of all("SELECT id FROM executions WHERE state='ACTIVE'"))drive(r.id);
  for(const r of all("SELECT id FROM executions WHERE state='WAIT_DELAY' AND wake_at<=?",now())){
   run("UPDATE executions SET state='ACTIVE',updated_at=? WHERE id=?",now(),r.id);drive(r.id);
  }
  scheduleReport(new Date());
  if(waStatus!=='CONNECTED')return;
  await flushNotices(sock);
  if(getSetting('paused',true))return;
  const jobs=all("SELECT * FROM jobs WHERE status='PENDING' ORDER BY created_at LIMIT 10");
  for(const job of jobs){
   const lead=one('SELECT * FROM leads WHERE id=?',job.lead_id);if(!lead||suppressed(lead.phone)){run("UPDATE jobs SET status='CANCELLED',updated_at=? WHERE id=?",now(),job.id);continue;}
   if(job.execution_id){
    const execution=one('SELECT * FROM executions WHERE id=?',job.execution_id);
    const thread=one('SELECT manual_takeover FROM threads WHERE lead_id=?',lead.id);
    if(execution?.state!=='SENDING'||thread?.manual_takeover){run("UPDATE jobs SET status='CANCELLED',updated_at=? WHERE id=?",now(),job.id);continue;}
    if(job.step_index===0&&!canInitial())continue;
   }
   // UNKNOWN nunca será reenviado automaticamente: rede pode ter aceitado a mensagem.
   run("UPDATE jobs SET status='SENDING',updated_at=? WHERE id=?",now(),job.id);
   try{
    const result=await send(job,lead);
    run("UPDATE jobs SET status='SENT',updated_at=? WHERE id=?",now(),job.id);
    if(job.step_index===0&&job.execution_id){
     run("UPDATE initial_contacts SET status='SENT' WHERE job_id=?",job.id);
     stage(lead.id,'CONTACTED','mensagem inicial confirmada');
    }
    const t=getThread(lead.id,result.jid);
    addMessage({threadId:t.id,providerId:result.ack?.key?.id||null,direction:'out',type:job.type==='message'?'text':job.type,body:job.text,mediaId:job.media_id,status:'sent'});
    if(job.execution_id){run("UPDATE executions SET state='ACTIVE',updated_at=? WHERE id=?",now(),job.execution_id);drive(job.execution_id);}
    onSent(job.id);
    publish();
   }catch(e){
    run("UPDATE jobs SET status='UNKNOWN',error=?,updated_at=? WHERE id=?",String(e.message),now(),job.id);
    if(job.execution_id)run("UPDATE executions SET state='NEEDS_REVIEW',updated_at=? WHERE id=?",now(),job.execution_id);
    audit('DELIVERY_UNKNOWN',lead.id,{job:job.id,error:e.message});onUnknown(job.id);publish();
   }
  }
 }finally{locked=false;}
}
export function resume(leadId){
 const r=one('SELECT * FROM executions WHERE lead_id=?',leadId);
 if(!r||r.state!=='NEEDS_REVIEW')throw Error('Não há workflow revisável');
 const th=one('SELECT manual_takeover FROM threads WHERE lead_id=?',leadId);
 if(th?.manual_takeover)throw Error('Devolva para automação primeiro');
 if(one("SELECT id FROM jobs WHERE execution_id=? AND status='UNKNOWN'",r.id))throw Error('Envio com resultado desconhecido: revisão manual obrigatória');
 run("UPDATE executions SET state='ACTIVE',updated_at=? WHERE id=?",now(),r.id);drive(r.id);
}
