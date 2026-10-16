import fs from 'node:fs';
import path from 'node:path';
import {one,all,run,tx,id,now,phone,getSetting,addLead,getThread,addMessage,stage,audit,stopLead,suppressed} from './db.mjs';
import {classify,renderTemplate} from './classifier.mjs';
import {onReply,cancelForOptOut,onSent,onUnknown,requestFromAutomation} from './production.mjs';
import {evaluateDecision,selectAutomationForLead,permitsPresentation} from './automation-router.mjs';
import {scheduleReport,flushNotices,queueNotice} from './notifications.mjs';
import {automaticCandidateSql,documentedOptIn} from './outreach-queue.mjs';
import {isInvitationWorkflow,isInvitationJob,acceptPresentation} from './permission-invitation.mjs';
import {rememberOutreach,eligibleRecontacts} from './contact-cadence.mjs';
import {canSendInitial} from './radar.mjs';
import {isOfferActive} from './campaign-rules.mjs';
import {rememberMessage,retryMessage,recordDeliveryReceipt,createRetryCache,recoveryRepository} from './whatsapp-recovery.mjs';
import {currentWebVersion,classifyDisconnect,retryDelay,isPairingRestart} from './whatsapp-reliability.mjs';

const msgRetryCounterCache=createRetryCache();
const failedDecryptionPeers=new Set();
let decryptionFailures=0,lastDecryptionFailureAt=null,lastDecryptionSuccessAt=null;
let sock=null,connecting=false,waStatus='DISCONNECTED',qrData=null,lastError=null,waUser=null;
let notifier=()=>{},locked=false,reconnectTimer=null,retries=0,closeCode=null,lastEventAt=null,lastQrAt=null,nextRetryAt=null,pairedRestartCount=0;
export function setNotifier(fn){notifier=fn;}
const publish=()=>{lastEventAt=new Date().toISOString();try{notifier();}catch{}};
export function connection(){return {decryption:{unresolvedConversations:failedDecryptionPeers.size,failures:decryptionFailures,lastFailureAt:lastDecryptionFailureAt,lastSuccessAt:lastDecryptionSuccessAt},status:waStatus,qr:qrData,user:waUser,error:lastError,closeCode,lastEventAt,lastQrAt,nextRetryAt};}
const authDir=()=>path.resolve(process.env.PROSPECTOR_SESSION_DIR||path.join(process.env.PROSPECTOR_DATA_DIR||'data','wa-session'));
function backupSession(folder){
 if(!fs.existsSync(path.join(folder,'creds.json')))return false;
 const backup=folder+'.backup-'+Date.now();
 fs.renameSync(folder,backup);fs.mkdirSync(folder,{recursive:true});
 audit('WHATSAPP_SESSION_ARCHIVED',null,{reason:'requested_repair',backup:path.basename(backup)});
 console.info('[whatsapp] Sessão anterior preservada em backup para novo pareamento');
 return true;
}
export async function restoreWhatsAppSession(){
 const folder=authDir();
 if(!fs.existsSync(path.join(folder,'creds.json')))return {restored:false,reason:'not_paired'};
 return {restored:true,status:await connectWhatsApp({restore:true})};
}
function jidFor(lead) {
 const thread=one('SELECT jid FROM threads WHERE lead_id=?',lead.id);
 return thread?.jid&&thread.jid.endsWith('@lid')?thread.jid:(lead.phone?lead.phone+'@s.whatsapp.net':thread?.jid);
}
function queueReconnect(){
 if(retries>=5)return;
 retries++;
 const delay=retryDelay(retries);
 nextRetryAt=new Date(Date.now()+delay).toISOString();
 clearTimeout(reconnectTimer);
 reconnectTimer=setTimeout(()=>{
  reconnectTimer=null;nextRetryAt=null;
  connectWhatsApp({restore:true}).catch(e=>{lastError=String(e.message);waStatus='ERROR';publish();});
 },delay);
 reconnectTimer.unref();
 console.info('[whatsapp] Reconexão transitória agendada em '+Math.round(delay/1000)+' s');
}
export async function connectWhatsApp(options={}){
 const fresh=options?.fresh===true,restore=options?.restore===true;
 if(connecting)return connection();
 if(sock&&['CONNECTED','QR_READY','CONNECTING'].includes(waStatus)&&!fresh)return connection();
 if(fresh&&sock){const old=sock;sock=null;try{old.end(new Error('Novo pareamento solicitado'));}catch{}}
 const oldStatus=waStatus;
 clearTimeout(reconnectTimer);reconnectTimer=null;nextRetryAt=null;
 connecting=true;waStatus='CONNECTING';lastError=null;closeCode=null;qrData=null;publish();
 try{
  const B=await import('@whiskeysockets/baileys');
  const Q=await import('qrcode');
  const folder=authDir();fs.mkdirSync(folder,{recursive:true});
  // Recuperar sessão inválida só por ação explícita; jamais apagar credenciais na restauração do servidor.
  if(!restore&&(fresh||oldStatus==='LOGGED_OUT')){backupSession(folder);pairedRestartCount=0;retries=0;}
  const {state,saveCreds}=await B.useMultiFileAuthState(folder);
  const version=await currentWebVersion(B);
  console.info('[whatsapp] Iniciando conexão com versão Web '+version.join('.')+(restore?' (restauração)':' (pareamento)'));
  const socket=B.default({version,auth:state,printQRInTerminal:false,
   browser:B.Browsers?.macOS?.('Chrome'),connectTimeoutMs:45000,markOnlineOnConnect:true,
   msgRetryCounterCache,maxMsgRetryCount:5,
   shouldIgnoreJid:jid=>jid?.endsWith('@g.us')||jid?.endsWith('@broadcast')||jid?.endsWith('@newsletter'),
   getMessage:async key=>retryMessage(key,B.proto.Message),
   makeSignalRepository:recoveryRepository(B.DEFAULT_CONNECTION_CONFIG.makeSignalRepository,{folder,
    onFailure:jid=>{failedDecryptionPeers.add(jid);decryptionFailures++;lastDecryptionFailureAt=new Date().toISOString();},
    onSuccess:jid=>{failedDecryptionPeers.delete(jid);lastDecryptionSuccessAt=new Date().toISOString();}}),
   logger:{level:'silent',child(){return this;},trace(){},debug(){},info(){},warn(){},error(){},fatal(){}}});
  const providerSend=socket.sendMessage.bind(socket);
  socket.sendMessage=async(...args)=>{
   const result=await providerSend(...args);
   try{rememberMessage(result,B.proto.Message);}catch(error){audit('WHATSAPP_RETRY_STORE_ERROR',null,{error:error.message});}
   return result;
  };
  sock=socket;
  socket.ev.on('creds.update',saveCreds);
  socket.ev.on('messages.update',updates=>{
   if(sock!==socket)return;
   for(const item of updates||[]){
    try{
     const receipt=recordDeliveryReceipt(item);if(!receipt)continue;
     const {existing,next}=receipt;
     console.info('[whatsapp] Entrega confirmada pelo destinatário: '+next);
     const testThread=one('SELECT lead_id FROM threads WHERE id=?',existing.thread_id);
     if(testThread?.lead_id===getSetting('operator_test_lead_id',''))console.info('[campaign test]',JSON.stringify({status:next.toUpperCase(),type:existing.type}));
     publish();
    }catch(error){console.error('[whatsapp] Falha ao registrar confirmação de entrega: '+error.message);}
   }
  });
  socket.ev.on('connection.update',async update=>{
   if(sock!==socket)return;
   if(update.qr){
    try{qrData=await Q.default.toDataURL(update.qr,{width:320,margin:2});waStatus='QR_READY';lastQrAt=new Date().toISOString();lastError=null;}
    catch(e){lastError='Não foi possível gerar a imagem QR: '+e.message;}
    publish();
   }
   if(update.connection==='open'){
    waStatus='CONNECTED';qrData=null;waUser=socket.user?.id||null;
    connecting=false;retries=0;pairedRestartCount=0;closeCode=null;lastError=null;nextRetryAt=null;publish();
    console.info('[whatsapp] Sessão autenticada e conectada');
   }
   if(update.connection==='close'){
    const code=update.lastDisconnect?.error?.output?.statusCode||null;
    closeCode=code;
    const mustRestart=isPairingRestart(code,B.DisconnectReason.restartRequired);
    connecting=false;sock=null;qrData=null;waUser=null;
    if(mustRestart){
     // 515 é a segunda fase esperada do pareamento: grave credenciais e
     // reinicie o WebSocket sem limpar a sessão e sem atraso exponencial.
     pairedRestartCount++;
     waStatus='RESTARTING';lastError=null;publish();
     console.info('[whatsapp] Pareamento aceito pela primeira fase; reinício 515 (etapa '+pairedRestartCount+')');
     if(pairedRestartCount>3){
      waStatus='ERROR';lastError='Muitas reinicializações de pareamento. Aguarde e tente novamente.';publish();return;
     }
     try{
      await saveCreds();
      const credentialFile=path.join(folder,'creds.json');
      if(!fs.existsSync(credentialFile))throw Error('O arquivo de autenticação não foi persistido');
     }catch(error){
      waStatus='ERROR';lastError='Falha ao salvar as credenciais antes da reconexão: '+error.message;publish();
      console.error('[whatsapp] '+lastError);return;
     }
     clearTimeout(reconnectTimer);
     nextRetryAt=new Date(Date.now()+150).toISOString();
     reconnectTimer=setTimeout(()=>{
      reconnectTimer=null;nextRetryAt=null;
      connectWhatsApp({restore:true}).catch(error=>{waStatus='ERROR';lastError=String(error.message);publish();});
     },150);
     reconnectTimer.unref();
     return;
    }
    waStatus=classifyDisconnect(code,B.DisconnectReason.loggedOut);
    lastError=String(update.lastDisconnect?.error?.message||code||'Conexão fechada').slice(0,180);
    publish();
    console.warn('[whatsapp] Socket fechado: status='+String(code||'desconhecido')+'; estado='+waStatus+'; '+lastError);
    if(waStatus!=='LOGGED_OUT')queueReconnect();
   }
  });
  socket.ev.on('messages.upsert',async event=>{
   if(sock!==socket)return;
   for(const m of event.messages||[]){
    try{rememberMessage(m,B.proto.Message);}catch(error){audit('WHATSAPP_RETRY_STORE_ERROR',null,{error:error.message});}
    if(event.type!=='notify')continue;
    try{await incoming(m);}catch(e){audit('INBOUND_ERROR',null,{error:e.message});}
   }
  });
 }catch(e){
  waStatus='ERROR';lastError=String(e.message).slice(0,180);connecting=false;sock=null;publish();
  console.error('[whatsapp] Falha de inicialização: '+lastError);
  // Erro de versão ou protocolo requer revisão: não gerar reconexões agressivas.
 }
 return connection();
}
export async function disconnectWhatsApp(){
 clearTimeout(reconnectTimer);reconnectTimer=null;nextRetryAt=null;retries=5;
 const old=sock;sock=null;
 if(old){try{old.end(new Error('Desconectado pelo painel'));}catch{}}
 connecting=false;waStatus='DISCONNECTED';qrData=null;waUser=null;lastError=null;closeCode=null;publish();
 return connection();
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
  const response=type==='message'?String(choice[prefix+'_text']||'').trim():'';
  const mediaId=choice[prefix+'_media_id']||null;
  const lead=one('SELECT * FROM leads WHERE id=?',leadId);
  if(!lead||!lead.contact_permission||suppressed(lead.phone))throw Error('Lead não autorizado');
  if(action!=='handover'&&(response||type==='audio')){
   const jid=id(),key='decision:'+exec.id+':'+exec.next_step+':'+prefix;
   run("INSERT OR IGNORE INTO jobs(id,lead_id,type,text,media_id,key,status,created_at,updated_at) VALUES(?,?,?,?,? ,?,'PENDING',?,?)",
     jid,leadId,type,response,mediaId,key,now(),now());
  }
  if(accepted&&action==='handover'){
   run("UPDATE executions SET state='COMPLETE',next_step=next_step+1,updated_at=? WHERE id=?",now(),exec.id);
   stage(leadId,'INTERESTED','Interesse confirmado na decisão da campanha');
   const thread=getThread(leadId);
   run('UPDATE threads SET manual_takeover=1 WHERE id=?',thread.id);
   audit('INTERESTED_HANDOVER',leadId,{executionId:exec.id});
  }else if(accepted&&action==='request_sample'){
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

function handoverInterest(lead,reason){
 const l=one("SELECT stage FROM leads WHERE id=?",lead.id);
 if(l?.stage==='INTERESTED')return;
 const t=getThread(lead.id);
 stage(lead.id,'INTERESTED',reason);
 run('UPDATE threads SET manual_takeover=1 WHERE id=?',t.id);
 run("UPDATE jobs SET status='CANCELLED',updated_at=? WHERE lead_id=? AND status='PENDING' AND execution_id IS NOT NULL",now(),lead.id);
 run("UPDATE executions SET state='NEEDS_REVIEW',updated_at=? WHERE lead_id=? AND state NOT IN ('COMPLETE','CANCELLED')",now(),lead.id);
 const link=String(process.env.APP_BASE_URL||'https://prospector-ui-production.up.railway.app').replace(/\/$/,'');
 queueNotice('sales-interest:'+lead.id,'INTERESTED','⭐ *Novo interessado — site Consecom*\n\nEmpresa: '+lead.business+'\nTelefone: '+(lead.phone||'não informado')+'\n\nKanban: '+link+'/#/prospects',lead.id);
 audit('SALES_INTEREST_HANDOVER',lead.id,{reason});
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
 if(lead.id===getSetting('operator_test_lead_id',''))console.info('[campaign test]',JSON.stringify({status:'REPLY_RECEIVED',type:payload.type}));
 const result=payload.type==='text'?classify(payload.body):{intent:'UNCERTAIN',confidence:0,matched_rules:['MEDIA'],requires_human:true,allow_media:false};
 audit('INTENT_CLASSIFIED',lead.id,{intent:result.intent,matched_rules:result.matched_rules,confidence:result.confidence});
 if(result.intent==='OPT_OUT'){
  stopLead(lead.id,result.intent);cancelForOptOut(lead.id);publish();return;
 }
 // Decisão final do fluxo tem prioridade sobre o classificador genérico.
 // No primeiro aceite, apenas autorizações explícitas podem liberar mídia.
 const waiting=one("SELECT * FROM executions WHERE lead_id=? AND state='WAIT_REPLY'",lead.id);
 let next=null,firstApproval=false;
 if(waiting){
  try{
   const steps=JSON.parse(waiting.steps);
   next=steps[waiting.next_step];
   firstApproval=payload.type==='text'&&permitsPresentation(steps,waiting.next_step,payload.body);
  }catch{}
 }
 if(result.intent==='INTERESTED'&&next?.type!=='decision'&&next?.type!=='delay'){
  handoverInterest(lead,'Interesse comercial declarado');publish();return;
 }
 if(firstApproval){acceptPresentation(lead.id,m.key?.id,payload.body);lead=one('SELECT * FROM leads WHERE id=?',lead.id);}
 const manualChoice=!!one('SELECT manual_takeover FROM threads WHERE id=?',thread.id)?.manual_takeover;
 const routing=!manualChoice&&getSetting('automation_enabled',true)?handleDecision(lead.id,payload.body,payload.type==='text'):null;
 if(routing){if(routing.shouldContinue)drive(routing.executionId);publish();return;}
 if(result.intent==='NOT_INTERESTED'){
  stopLead(lead.id,result.intent);cancelForOptOut(lead.id);publish();return;
 }
 const sampleReply=onReply(lead.id,payload.body,payload.type==='text');
 if(sampleReply){publish();return;}
 const manual=one('SELECT manual_takeover FROM threads WHERE id=?',thread.id)?.manual_takeover;
 if(waiting&&next?.type==='delay'&&!firstApproval&&result.intent!=='NOT_INTERESTED'){
  stage(lead.id,'REPLIED','Aguardando aceite explícito da apresentação');
  audit('PRESENTATION_ACCEPTANCE_PENDING',lead.id,{messageId:m.key?.id||null});publish();return;
 }
 if(['QUESTION','UNCERTAIN'].includes(result.intent)&&!firstApproval){
  stage(lead.id,'REPLIED','Resposta sob análise: '+result.intent);
  if(result.intent==='QUESTION'||result.intent==='UNCERTAIN'){
   run("UPDATE executions SET state='NEEDS_REVIEW',updated_at=? WHERE lead_id=? AND state IN ('WAIT_REPLY','WAIT_DELAY','ACTIVE')",now(),lead.id);
   run("UPDATE jobs SET status='CANCELLED',updated_at=? WHERE lead_id=? AND status='PENDING' AND execution_id IS NOT NULL",now(),lead.id);
   publish();return;
  }
 }else stage(lead.id,'REPLIED','resposta recebida');
 if(!manual&&getSetting('automation_enabled',true)){
  const execution=one("SELECT * FROM executions WHERE lead_id=? AND state='WAIT_REPLY'",lead.id);
  if(execution){
   const steps=JSON.parse(execution.steps),upcoming=steps[execution.next_step],after=steps[execution.next_step+1];
   // Cumprimento isolado nao libera audio comercial.
   if(upcoming?.type==='delay'&&after?.type==='audio'){
    const decision=payload.type==='text'?evaluateDecision(payload.body,'general_interest').decision:'REVIEW';
    if(decision!=='YES'){
     run("UPDATE executions SET state='NEEDS_REVIEW',updated_at=? WHERE id=?",now(),execution.id);
     audit('PROMOTIONAL_REPLY_REVIEW',lead.id,{decision,reason:'no_explicit_go_ahead'});
     publish();return;
    }
   }
   run("UPDATE executions SET state='ACTIVE',updated_at=? WHERE id=?",now(),execution.id);drive(execution.id);
  }
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
   if(!['sample_offer','general_interest','website_interest'].includes(s.context))throw Error('Escolha o contexto da pergunta');
   if(!String(s.context_description||'').trim())throw Error('Descreva a pergunta usada para interpretar a resposta');
   for(const side of ['yes','no']){
    if(!['message','audio'].includes(s[side+'_type']||'message'))throw Error('Resposta deve ser texto ou áudio');
    if(!['end','continue','request_sample','handover'].includes(s[side+'_action']))throw Error('Ação inválida na decisão');
    if(side==='no'&&['request_sample','handover'].includes(s.no_action))throw Error('Recusa não pode solicitar site');
    if(s[side+'_action']==='request_sample'&&s.context!=='sample_offer')throw Error('Solicitação de site exige contexto oferta de exemplo');
    if(s[side+'_type']==='audio'){
     if(!String(s[side+'_audio_description']||'').trim())throw Error('Descreva o áudio da resposta '+side);
     const media=one('SELECT * FROM media WHERE id=?',s[side+'_media_id']||'');
     if(media?.kind!=='audio')throw Error('Escolha o áudio da resposta '+side);
    }else if(s[side+'_action']!=='handover'&&!String(s[side+'_text']||'').trim())throw Error('Escreva a resposta '+side);
   }
  }
  if(['video','audio','image'].includes(s.type)){
   const asset=one('SELECT * FROM media WHERE id=?',s.media_id||'');
   if((!asset||asset.kind!==s.type)&&input.enabled!==false)throw Error('Envie a mídia antes de ativar a automação: '+s.type);
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
  if(input.version!=null&&Number(input.version)!==Number(w.version))throw Error('Esta campanha foi alterada. Recarregue o painel antes de salvar novamente.');
  run('UPDATE workflows SET name=?,version=?,steps=?,segments_json=?,enabled=?,updated_at=? WHERE id=?',String(input.name||w.name),w.version+1,JSON.stringify(steps),tagJson,enabled,now(),w.id);
  audit('WORKFLOW_UPDATED',null,{id:w.id,version:w.version+1});return w.id;
 }
 const workflowId=id();
 run('INSERT INTO workflows(id,name,is_default,version,steps,created_at,updated_at,segments_json,enabled) VALUES(?,?,?,?,?,?,?,?,?)',workflowId,String(input.name||'Nova automação'),0,1,JSON.stringify(steps),now(),now(),tagJson,enabled);
 return workflowId;
}
export function setDefaultWorkflow(workflowId){
 if(!one('SELECT id FROM workflows WHERE id=? AND enabled=1',workflowId))throw Error('Workflow inválido');
 tx(()=>{run('UPDATE workflows SET is_default=0');run('UPDATE workflows SET is_default=1 WHERE id=?',workflowId);});
}
export function startWorkflow(leadId,selectedAutomationId=null){
 return tx(()=>{
  const lead=one('SELECT * FROM leads WHERE id=?',leadId);
  if(!lead)throw Error('Lead não encontrado');
  if(!lead.phone)throw Error('Lead sem WhatsApp');
  if(lead.stage==='NO_INTEREST'||lead.stage==='CLOSED_WON')throw Error('Lead recusou contato ou negociação concluída');
  if(suppressed(lead.phone))throw Error('Contato bloqueado/opt-out');
  if(one('SELECT lead_id FROM initial_contacts WHERE phone=? OR lead_id=?',lead.phone,leadId))throw Error('Primeira abordagem já registrada');
  if(one('SELECT id FROM executions WHERE lead_id=?',leadId))throw Error('Lead já possui workflow iniciado');
  const wf=selectAutomationForLead(lead,all('SELECT * FROM workflows'),selectedAutomationId);
  if(!wf)throw Error('Não existe automação ativa aplicável ao segmento');
  if(!documentedOptIn(lead.id)&&!isInvitationWorkflow(wf))throw Error('Primeira abordagem exige autorização comercial comprovada');
  const runId=id();
  run("INSERT INTO executions(id,lead_id,workflow_id,version,steps,next_step,state,updated_at) VALUES(?,?,?,?,?,0,'ACTIVE',?)",runId,leadId,wf.id,wf.version,wf.steps,now());
  audit('WORKFLOW_STARTED',leadId,{workflowId:wf.id,version:wf.version});
  return runId;
 });
}
function isPromotionalExecution(runId){
 if(!runId)return false;
 const record=one('SELECT w.name FROM executions e JOIN workflows w ON w.id=e.workflow_id WHERE e.id=?',runId);
 return /^Oferta Consecom R\$350\b/.test(String(record?.name||''));
}
function promotionExpired(runId){
 return isPromotionalExecution(runId)&&!isOfferActive(getSetting('campaign_offer_expiry',''));
}
export function drive(runId){
 for(let i=0;i<50;i++){
  const r=one('SELECT * FROM executions WHERE id=?',runId);if(!r||r.state!=='ACTIVE')return;
  const lead=one('SELECT * FROM leads WHERE id=?',r.lead_id);
  if(!lead||suppressed(lead.phone))return;
  const takeover=one('SELECT manual_takeover FROM threads WHERE lead_id=?',lead.id);
  if(takeover?.manual_takeover)return;
  const steps=JSON.parse(r.steps),step=steps[r.next_step];
  if(promotionExpired(r.id)){
   run("UPDATE executions SET state='NEEDS_REVIEW',updated_at=? WHERE id=?",now(),r.id);
   audit('PROMOTION_EXPIRED_REVIEW',r.lead_id,{executionId:r.id});publish();return;
  }
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
  const text=kind==='message'?renderTemplate(step.text,lead):kind==='video'?renderTemplate(step.caption||'',lead):'';
  if(initial){
   if(!documentedOptIn(lead.id)&&!isInvitationWorkflow({id:r.workflow_id,steps:r.steps}))throw Error('Sem autorização de contato');
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
 if(suppressed(lead.phone)||!lead.contact_permission)throw Error('Contato bloqueado ou sem autorização de envio');
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
function canInitial(){return canSendInitial();}
async function send(job,lead){
 if(waStatus!=='CONNECTED'||!sock)throw Error('WhatsApp desconectado');
 const jid=jidFor(lead);if(!jid)throw Error('JID não encontrado');
 let payload={text:job.text};
 if(job.type!=='message'){
  const media=one('SELECT * FROM media WHERE id=?',job.media_id);if(!media)throw Error('Mídia inexistente');
  const buf=fs.readFileSync(path.join(process.env.PROSPECTOR_DATA_DIR||'data','media',media.filename));
  if(job.type==='video')payload={video:buf,mimetype:media.mime,...(job.text?{caption:job.text}:{})};
  else if(job.type==='audio')payload={audio:buf,mimetype:media.mime,ptt:/opus|ogg/.test(media.mime)};
  else if(job.type==='image')payload={image:buf,mimetype:media.mime};
 }
 const ack=await sock.sendMessage(jid,payload);
 if(!ack?.key?.id)throw Error('Envio sem identificador de confirmação do WhatsApp');
 return {ack,jid};
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
  // Convite inicial segue a campanha revisada; mídia exige aceite real do contato.
  const campaign=one('SELECT id,enabled FROM workflows WHERE id=? AND enabled=1',String(getSetting('autonomous_campaign_id','')));
  if(getSetting('auto_initial',false)&&campaign&&canInitial()&&!one("SELECT id FROM jobs WHERE execution_id IS NOT NULL AND step_index=0 AND status IN ('PENDING','SENDING') LIMIT 1")){
   const candidate=one(automaticCandidateSql());
   if(candidate){try{const rid=startWorkflow(candidate.id,campaign.id);drive(rid);}catch(err){audit('AUTO_START_REVIEW',candidate.id,{error:err.message});}}
  }
  const testJobId=Date.parse(getSetting('operator_test_expires_at',''))>Date.now()?getSetting('operator_test_job_id',''):'';
  const jobs=all("SELECT * FROM jobs WHERE status='PENDING' ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,created_at LIMIT 10",testJobId);
  for(const job of jobs){
   const lead=one('SELECT * FROM leads WHERE id=?',job.lead_id);
   const declineFarewell=lead?.stage==='NO_INTEREST'&&/^decision:[^:]+:\d+:no$/.test(String(job.key||''));
   const invitation=isInvitationJob(job);
   if(!lead||(!lead.contact_permission&&!invitation)||(job.step_index===0&&job.execution_id&&!documentedOptIn(lead.id)&&!invitation)||(lead.stage==='NO_INTEREST'&&!declineFarewell)||lead.stage==='CLOSED_WON'||suppressed(lead.phone)){
    run("UPDATE jobs SET status='CANCELLED',updated_at=? WHERE id=?",now(),job.id);
    audit('DELIVERY_BLOCKED',job.lead_id,{jobId:job.id,reason:'permission_or_stage'});continue;
   }
   if(job.execution_id&&promotionExpired(job.execution_id)){
    run("UPDATE jobs SET status='CANCELLED',updated_at=? WHERE id=?",now(),job.id);
    run("UPDATE executions SET state='NEEDS_REVIEW',updated_at=? WHERE id=?",now(),job.execution_id);
    audit('PROMOTION_EXPIRED_REVIEW',job.lead_id,{jobId:job.id});continue;
   }
   if(job.execution_id){
    const execution=one('SELECT * FROM executions WHERE id=?',job.execution_id);
    const thread=one('SELECT manual_takeover FROM threads WHERE lead_id=?',lead.id);
    if(execution?.state!=='SENDING'||thread?.manual_takeover){run("UPDATE jobs SET status='CANCELLED',updated_at=? WHERE id=?",now(),job.id);continue;}
    if(job.step_index===0&&job.id!==testJobId&&!canInitial())continue;
   }
   // UNKNOWN nunca será reenviado automaticamente: rede pode ter aceitado a mensagem.
   run("UPDATE jobs SET status='SENDING',updated_at=? WHERE id=?",now(),job.id);
   try{
    const result=await send(job,lead);
    run("UPDATE jobs SET status='SENT',updated_at=? WHERE id=?",now(),job.id);
    if(job.step_index===0&&job.execution_id){
     rememberOutreach(lead.id,'initial');
     run("UPDATE initial_contacts SET status='SENT' WHERE job_id=?",job.id);
     stage(lead.id,'CONTACTED','mensagem inicial confirmada');
     console.info('[outreach] Convite inicial aceito pelo provedor; aguardando confirmação de entrega');
    }
    if(String(job.key||'').startsWith('recontact:'))rememberOutreach(lead.id,'recontact');
    const t=getThread(lead.id,result.jid);
    addMessage({threadId:t.id,providerId:result.ack?.key?.id||null,direction:'out',type:job.type==='message'?'text':job.type,body:job.text,mediaId:job.media_id,status:'sent'});
    if(job.execution_id){run("UPDATE executions SET state='ACTIVE',updated_at=? WHERE id=?",now(),job.execution_id);drive(job.execution_id);}
    if(lead.id===getSetting('operator_test_lead_id',''))console.info('[campaign test]',JSON.stringify({status:'PROVIDER_ACCEPTED',type:job.type,step:job.step_index}));
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
