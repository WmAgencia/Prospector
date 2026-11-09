// WA-AKG webhook receiver and consent-gated WhatsApp transport.
// No credentials here. No automatic message sending. WAL-backed idempotency.
import crypto from "node:crypto";
import {db,one,all,run,id,now,phone,addLead,getThread,addMessage,stopLead,stage,audit} from "./db.mjs";
import {aiDraft} from "./ai-groq.mjs";
import {classifyContact,prospectorChatEligible,prospectorLeadEligible} from "./whatsapp-roles.mjs";
import {queueInboundTurn} from "./groq-sales-automation.mjs";
import {salesEnding,isExplicitOptOut} from "./sales-policy.mjs";
import {classifyInboundAutomation} from './inbound-automation.mjs';
import {recordSalesOutcome} from "./sales-outcomes.mjs";
import {routeIntroductionReply,introductionStatus} from "./prospecting-introduction.mjs";
import {explicitlyAcceptsProposal} from "./proposal-acceptance.mjs";
import {queueInboundBrief} from "./personal-concierge.mjs";
import {queueInboundAudio} from "./waakg-audio-inbound.mjs";
import {configuredClosing} from "./training-sales-extras.mjs";
import {recordReceiptMedia} from "./sales-payment-flow.mjs";
import {waRequest,selectedWaSession,waControlStatus} from "./waakg-control.mjs";
import {receivePrivateGroupWebhook} from './prospector-group-assistant.mjs';
import {isManagedSession,boundLeadSession,leadSession,bindLeadSession} from './waakg-session-registry.mjs';

db.exec("CREATE TABLE IF NOT EXISTS waakg_inbox(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,jid TEXT NOT NULL,provider_id TEXT NOT NULL UNIQUE,lead_id TEXT,body TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'REVIEW',draft TEXT,received_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS waakg_manual_outbox(id TEXT PRIMARY KEY,inbox_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL,requested_at TEXT NOT NULL,updated_at TEXT NOT NULL,error TEXT)");
const base=(process.env.WA_AKG_BASE_URL||"").replace(/\/$/,"");
const configuredBase=base==="https://wa-akg-production-f9f0.up.railway.app";
const safeEq=(a,b)=>{const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
export function gatewayStatus(){
 return {provider:"WA-AKG",configuredBase,apiKeyConfigured:!!process.env.WA_AKG_API_KEY,sessionConfigured:!!process.env.WA_AKG_SESSION_ID,webhookSecretConfigured:(process.env.WA_AKG_WEBHOOK_SECRET||"").length>=40,autoSend:false,manualSendEnabled:process.env.WA_AKG_MANUAL_SEND==="true",pending:one("SELECT COUNT(*) AS n FROM waakg_inbox WHERE state IN ('REVIEW','DRAFTED')")?.n||0,connected:false,connectionNotTested:true};
}
export async function gatewayRemoteStatus(){
 const status=gatewayStatus();
 if(!status.configuredBase)return {...status,connected:false,connectionNotTested:false,reason:'MISSING_URL'};
 // WA-AKG may not expose a fixed API key in Railway: waRequest obtains its
 // authenticated key from the configured admin login. Use that same authority
 // instead of falsely reporting MISSING_API_KEY for a connected service.
 const remote=await waControlStatus();
 return {...status,connected:remote.connected===true,
  connectionNotTested:remote.ok!==true,
  sessionConfigured:Boolean(remote.sessionId),
  totalSessions:remote.totalSessions||0,
  reason:remote.ok?remote.connected?'CONNECTED':remote.hasSession?'SESSION_NOT_CONNECTED':'SESSION_NOT_FOUND':
   'WA_AKG_UNAVAILABLE',
  gatewayStatus:remote.status};
}

export function gatewayInbox(){
 const rows=all("SELECT i.id,i.session_id,i.jid,i.lead_id,i.body,i.state,i.draft,i.received_at FROM waakg_inbox i ORDER BY i.received_at DESC LIMIT 200").filter(x=>prospectorChatEligible({jid:x.jid,sessionId:x.session_id})).slice(0,80);
 return {total:rows.length,items:rows,sendEnabled:process.env.WA_AKG_MANUAL_SEND==="true"};
}
export async function receiveWebhook(req){
 const raw=await new Promise((resolve,reject)=>{const chunks=[];let n=0;req.on("data",x=>{n+=x.length;if(n>65536){req.destroy();reject(Error("too_large"));return;}chunks.push(x);});req.on("end",()=>resolve(Buffer.concat(chunks)));req.on("error",reject);});
 const secret=process.env.WA_AKG_WEBHOOK_SECRET||"";
 if(secret.length<40)return {status:503,body:{accepted:false,reason:"NOT_CONFIGURED"}};
 const expected="sha256="+crypto.createHmac("sha256",secret).update(raw).digest("hex");
 if(!safeEq(req.headers["x-webhook-signature"],expected))return {status:401,body:{accepted:false,reason:"BAD_SIGNATURE"}};
 let payload;try{payload=JSON.parse(raw.toString("utf8"));}catch{return {status:400,body:{accepted:false,reason:"BAD_JSON"}};}
 if(payload.event==="test")return {status:200,body:{accepted:true,test:true}};
 if(payload.event!=="message.received"&&payload.event!=="message.sent")
  return {status:200,body:{accepted:true,ignored:true}};
 const data=payload.data||{},key=data.key||{};
 if(data.isGroup===true){
  const sid=String(payload.sessionId||'');
  try{
   const handled=await receivePrivateGroupWebhook({sessionId:sid,data,event:payload.event});
   return {status:200,body:{accepted:true,groupCommand:handled.queued===true,audioQueued:handled.audioQueued===true,
    reason:handled.reason||null}};
  }catch(err){
   console.warn('[private group inbound]',String(err?.message||err).slice(0,100));
   return {status:503,body:{accepted:false,reason:'GROUP_COMMAND_UNAVAILABLE'}};
  }
 }
 if(payload.event!=="message.received"||key.fromMe===true||data.fromMe===true)
  return {status:200,body:{accepted:true,ignored:true}};
 const sid=String(payload.sessionId||"");
 if(!isManagedSession(sid))return {status:200,body:{accepted:true,ignored:true}};
 const jid=String(key.remoteJid||data.from||"");
 if(!/^\d{10,15}@s\.whatsapp\.net$/.test(jid))return {status:200,body:{accepted:true,ignored:true}};
 // Only the confirmed Prospector outbound list is eligible for this customer inbox.
 if(!prospectorChatEligible({jid,sessionId:sid}))return {status:200,body:{accepted:true,ignored:true,reason:'NOT_PROSPECTOR_APPROACHED'}};
 const providerId=String(key.id||data.id||"");
 if(!/^[\w\-]{5,150}$/.test(providerId))return {status:200,body:{accepted:true,ignored:true}};
 const unique=sid+":"+providerId;
 if(one("SELECT id FROM waakg_inbox WHERE provider_id=?",unique))return {status:200,body:{accepted:true,duplicate:true}};
 if(!prospectorChatEligible({jid,sessionId:sid}))return {status:200,body:{accepted:true,ignored:true,reason:'NOT_PROSPECTOR_APPROACHED'}};
 const mediaType=String(data.type||'').toUpperCase();
 if(['IMAGE','DOCUMENT','PDF'].includes(mediaType)){
  const lead=one('SELECT id FROM leads WHERE phone=?',String(jid).split('@')[0]);
  if(lead){
   const receipt=recordReceiptMedia({leadId:lead.id,jid,sessionId:sid,providerId:unique,mimeType:mediaType});
   if(receipt.recorded){
    // One acknowledgement for the receipt event. Delivery is never retried
    // if WhatsApp acceptance is uncertain.
    const acknowledgement='Recebi seu arquivo e vou encaminhar para conferência. Se for o comprovante de pagamento, o responsável vai verificar e continuar com você por aqui.';
    try{
     const delivered=await waRequest('/api/messages/'+encodeURIComponent(sid)+'/'+encodeURIComponent(jid)+'/send',
      {method:'POST',data:{message:{text:acknowledgement}}});
     if(delivered?.status===true){
      const thread=getThread(lead.id,jid);
      addMessage({threadId:thread.id,providerId:'receipt-ack:'+unique,direction:'out',body:acknowledgement,status:'sent'});
      audit('RECEIPT_ACKNOWLEDGED',lead.id,{sent:true});
     }else audit('RECEIPT_ACK_UNKNOWN',lead.id,{reason:'TRANSPORT_UNCONFIRMED'});
    }catch(error){audit('RECEIPT_ACK_UNKNOWN',lead.id,{reason:'TRANSPORT_UNCERTAIN'});}
    return {status:200,body:{accepted:true,mediaPendingReview:true,commerciallyClosed:false,paymentVerified:false}};
   }
  }
 }
 const isAudio=String(data.type||'').toUpperCase()==='AUDIO';
 if(isAudio){
  if(process.env.AUDIO_TRANSCRIPTION_ENABLED!=='true')return {status:200,body:{accepted:true,audioPendingSetup:true}};
  const result=queueInboundAudio({providerId:unique,sessionId:sid,jid,fileUrl:String(data.fileUrl||'')});
  return {status:200,body:{accepted:true,audioQueued:result.queued,reason:result.reason||null}};
 }
 const text=typeof data.content==="string"?data.content:typeof data.content?.text==="string"?data.content.text:"";
 if(!text.trim())return {status:200,body:{accepted:true,ignored:true}};
 return recordInboundTranscript({sessionId:sid,jid,unique,content:text});
}
export function recordInboundTranscript({sessionId:sid,jid,unique,content:text,source='TEXT'}={}){
 if(!/^\d{10,15}@s\.whatsapp\.net$/.test(jid||'')||!String(unique||'').includes(':'))return {status:400,body:{accepted:false,error:'INVALID_INBOUND'}};
 if(one("SELECT id FROM waakg_inbox WHERE provider_id=?",unique))return {status:200,body:{accepted:true,duplicate:true}};
 const content=String(text||'').trim().slice(0,2000);
 if(!content)return {status:400,body:{accepted:false,error:'EMPTY_TRANSCRIPT'}};
 const number=phone(jid.split("@")[0]);
 if(!number)return {status:200,body:{accepted:true,ignored:true}};
 const identity=classifyContact({jid,sessionId:sid});
 if(identity.role==='UNVERIFIED')return {status:200,body:{accepted:true,ignored:true}};
 const existingLead=one('SELECT id FROM leads WHERE phone=?',number);
 const existingRoute=existingLead?boundLeadSession(existingLead.id):'';
 if(existingRoute&&existingRoute!==sid)return {status:200,body:{accepted:true,ignored:true,reason:'CONVERSATION_SESSION_MISMATCH'}};
 const lead=addLead({business:"Contato WhatsApp "+number.slice(-4),phone:number,source:"WHATSAPP_INBOUND",contact_permission:false}).lead;
 const bound=boundLeadSession(lead.id);
 if(bound&&bound!==sid)return {status:200,body:{accepted:true,ignored:true,reason:'CONVERSATION_SESSION_MISMATCH'}};
 bindLeadSession(lead.id,sid);
 const thread=getThread(lead.id,jid);
 const firstInbound=!one("SELECT id FROM messages WHERE thread_id=? AND direction=\'in\' LIMIT 1",thread.id);
 addMessage({threadId:thread.id,providerId:unique,direction:"in",body:content,status:"received"});
 const automation=classifyInboundAutomation(content);
 let state=automation.blocked?'AUTO_REPLY':'REVIEW';
 const ending=identity.role==='PROSPECT_APPROACHED'&&state!=='AUTO_REPLY'?salesEnding(content):null;
 if(isExplicitOptOut(content)||ending==='OPT_OUT'){
  stopLead(lead.id,"INBOUND_OPTOUT");state="OPT_OUT";
 }else if(state!=='AUTO_REPLY'&&(/^(?:não tenho interesse|nao tenho interesse|agora não|agora nao|não é o momento|nao e o momento)(?:[.!\s]|$)/i.test(content)||ending==='NO_INTEREST')){
  stage(lead.id,'NO_INTEREST','INBOUND_SOFT_DECLINE');state='NO_INTEREST';
 }else if(state!=='AUTO_REPLY'&&(/\b(humano|atendente|pessoa de verdade|falar com algu[eé]m)\b/i.test(content)||ending==='HUMAN_REVIEW')){
  run("UPDATE threads SET manual_takeover=1 WHERE id=?",thread.id);state="HUMAN";
 }
 if(state==='AUTO_REPLY'){
  audit('INBOUND_AUTOMATION_HELD',lead.id,{reason:automation.reason,action:automation.action});
  if(automation.action==='HUMAN_REVIEW'){
   run('UPDATE threads SET manual_takeover=1 WHERE id=?',thread.id);state='HUMAN';
  }
 }
 if(identity.role==='PROSPECT_APPROACHED'){
  const intro=introductionStatus(lead.id);
  const firstAcceptance=intro?.stage==='GREETING_SENT'&&explicitlyAcceptsProposal(content);
  // A real affirmative inbound answer is recorded as evidence to CONTINUE the
  // existing conversation; the first WhatsApp approach still requires opt-in.
  if(state==='REVIEW'&&firstAcceptance)grantAutonomousFirstReply(lead.id,content,intro.greeting_id);
  const accepted=firstAcceptance||['WAITING','SENT','CONVERSING'].includes(intro?.stage);
  if(state==='REVIEW'&&accepted&&lead.stage!=='CONVERSING')stage(lead.id,'CONVERSING','PROSPECT_REPLIED_WITH_PERMISSION');
  const outcome=state==='OPT_OUT'?'OPT_OUT':state==='HUMAN'?'HUMAN_REVIEW':state==='NO_INTEREST'?'NO_INTEREST':null;
  if(outcome)recordSalesOutcome({leadId:lead.id,status:outcome,providerId:unique,evidence:content});
 }
 const at=now();
 run("INSERT INTO waakg_inbox(id,session_id,jid,provider_id,lead_id,body,state,received_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",id(),sid,jid,unique,lead.id,content,state,at,at);
 audit("WAAKG_INBOUND",lead.id,{event:"message.received",state,session:sid,source,role:identity.role});
 // The owner has already been routed above, including the sandbox exception.
 if(firstInbound&&state!=='AUTO_REPLY'&&configuredClosing()?.mode!=='complete')queueInboundBrief({leadId:lead.id,phone:lead.phone,body:content,source:source==="AUDIO"?"WHATSAPP_AUDIO":"WHATSAPP_INBOUND"});
 const introRoute=identity.role==='PROSPECT_APPROACHED'?
  routeIntroductionReply({leadId:lead.id,providerId:unique,body:content,inboxState:state,receivedAt:at}):{managed:false,queueAi:true};
 if(state==="REVIEW"&&introRoute.queueAi)queueInboundTurn({providerId:unique,jid,sessionId:sid});
 return {status:200,body:{accepted:true,processed:true}};
}
// Consent to receive the requested proposal is recorded only from a genuine,
// affirmative inbound reply to THIS lead's persisted greeting. Never infer
// authorization from a public Google Maps listing or an automated response.
function grantAutonomousFirstReply(leadId,text,greetingId){
 if(!greetingId||!explicitlyAcceptsProposal(text))return false;
 const current=one('SELECT contact_permission FROM leads WHERE id=?',leadId);
 if(!current)return false;
 const greeting=one("SELECT 1 FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.lead_id=? AND m.direction='out' AND m.provider_id=? LIMIT 1",
   leadId,'prospect-queue:'+greetingId);
 if(!greeting)return false;
 if(one('SELECT 1 FROM suppressions WHERE phone=(SELECT phone FROM leads WHERE id=?)',leadId))return false;
 if(!one("SELECT id FROM audit WHERE lead_id=? AND action='CONSENT_UPDATED' AND json_extract(detail,'$.permitted')=1 AND COALESCE(json_extract(detail,'$.evidence'),'')<>'' ORDER BY at DESC LIMIT 1",leadId)){
  run('UPDATE leads SET contact_permission=1 WHERE id=?',leadId);
  audit('CONSENT_UPDATED',leadId,{permitted:true,method:'explicit_proposal_acceptance',evidence:String(text||'').slice(0,1000)});
 }
 return true;
}
export async function draftInbox(input){
 const row=one("SELECT * FROM waakg_inbox WHERE id=?",String(input.id||""));
 if(!row) return {status:404,body:{error:"Mensagem não encontrada"}};
 if(!prospectorChatEligible({jid:row.jid,sessionId:row.session_id}))return {status:403,body:{error:"Conversa fora da prospecção"}};
 if(["OPT_OUT","HUMAN","SENT","AUTO_REPLY"].includes(row.state))return {status:409,body:{error:"Revisão humana obrigatória"}};
 const lead=one("SELECT * FROM leads WHERE id=?",row.lead_id);
 const thread=one("SELECT id,manual_takeover FROM threads WHERE lead_id=?",row.lead_id);
 if(thread?.manual_takeover)return {status:409,body:{error:"Conversa em atendimento humano"}};
 const history=thread?all("SELECT direction,body FROM messages WHERE thread_id=? ORDER BY at DESC LIMIT 8",thread.id).reverse():[];
 const context=[
 "Empresa: Consecom Brasil — Publicidade e Inovação.",
 "Oferecemos sites e soluções digitais para pequenos negócios; valores, prazos e condições requerem confirmação humana.",
 "Conversa atual é INBOUND; não fazer prospecção ativa; respeitar recusa e pedido de atendimento humano.",
 "Contexto: "+history.map(m=>(m.direction==="in"?"Cliente":"Consecom")+": "+String(m.body||"").slice(0,450)).join(" | "),
 "Informações adicionais do operador: "+String(input.context||"").slice(0,500)
 ].join("\n");
 const draft=await aiDraft({text:row.body,context});
 if(!draft.ok)return {status:draft.httpStatus||502,body:{ok:false,code:draft.code}};
 run("UPDATE waakg_inbox SET draft=?,state='DRAFTED',updated_at=? WHERE id=? AND state IN ('REVIEW','DRAFTED')",draft.draft,now(),row.id);
 return {status:200,body:{ok:true,id:row.id,draft:draft.draft,requiresApproval:true,autoSent:false}};
}
export async function sendApproved(input){
 const inboxId=String(input.id||"");
 const item=one("SELECT * FROM waakg_inbox WHERE id=?",inboxId);
 if(!item)return {status:404,body:{error:"Mensagem não encontrada"}};
 if(!prospectorChatEligible({jid:item.jid,sessionId:item.session_id}))return {status:403,body:{error:"Conversa fora da prospecção"}};
 if(item.state!=="DRAFTED")return {status:409,body:{error:"Rascunho não está disponível para aprovação"}};
 const lead=one("SELECT * FROM leads WHERE id=?",item.lead_id);
 const text=String(input.text||"").trim();
 if(!text||text.length>1600||input.approve!==true||!safeEq(String(input.confirmId||""),inboxId))return {status:400,body:{error:"Aprovação explícita com ID da mensagem é obrigatória"}};
 const opted=!!one("SELECT phone FROM suppressions WHERE phone=?",lead.phone);
 const consent=lead.contact_permission===1||!!one("SELECT id FROM messages WHERE thread_id=(SELECT id FROM threads WHERE lead_id=?) AND direction='in' LIMIT 1",lead.id);
 if(opted||!consent||one("SELECT manual_takeover FROM threads WHERE lead_id=?",lead.id)?.manual_takeover===1)return {status:403,body:{error:"Sem autorização para envio"}};
 const apiKey=process.env.WA_AKG_API_KEY||"",session=item.session_id;
 if(!configuredBase||!apiKey||!session||process.env.WA_AKG_MANUAL_SEND!=="true")return {status:503,body:{error:"Gateway não habilitado para envio"}};
 if(!isManagedSession(session)||leadSession(lead.id)!==session)return {status:409,body:{error:"Sessão de origem divergente"}};
 if(one("SELECT id FROM waakg_manual_outbox WHERE inbox_id=?",inboxId))return {status:409,body:{error:"Já houve tentativa de envio; não repetir automaticamente"}};
 const mid=id(),at=now();
 run("INSERT INTO waakg_manual_outbox(id,inbox_id,state,requested_at,updated_at) VALUES(?,?,?,?,?)",mid,inboxId,"UNKNOWN",at,at);
 const url=base+"/api/messages/"+encodeURIComponent(session)+"/"+encodeURIComponent(item.jid)+"/send";
 try{
  const res=await fetch(url,{method:"POST",headers:{"X-API-Key":apiKey,"Content-Type":"application/json"},body:JSON.stringify({message:{text}}),signal:AbortSignal.timeout(8500)});
  if(!res.ok)return {status:502,body:{error:"Envio não confirmado",http:res.status,code:"UNKNOWN_NO_AUTO_RETRY"}};
  const response=await res.json().catch(()=>({}));
  if(response.status!==true)return {status:502,body:{error:"Gateway não confirmou",code:"UNKNOWN_NO_AUTO_RETRY"}};
  run("UPDATE waakg_manual_outbox SET state='SENT',updated_at=? WHERE id=?",now(),mid);
  run("UPDATE waakg_inbox SET state='SENT',updated_at=? WHERE id=?",now(),inboxId);
  const thread=getThread(lead.id,item.jid);
  addMessage({threadId:thread.id,providerId:"waakg-out:"+mid,direction:"out",body:text,status:"sent"});
  audit("WAAKG_MANUAL_SENT",lead.id,{id:mid});
  return {status:200,body:{ok:true,id:mid,state:"SENT"}};
 }catch{return {status:502,body:{error:"Falha de rede, estado desconhecido; conferir WhatsApp antes de outra tentativa",code:"UNKNOWN_NO_AUTO_RETRY"}};}
}

db.exec("CREATE TABLE IF NOT EXISTS waakg_operator_outbox(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
export async function sendChatMessage(input={}){
 const threadId=String(input.threadId||""),text=String(input.text||"").trim(),requestId=String(input.requestId||"");
 if(!/^[a-f0-9-]{36}$/i.test(requestId)||text.length<1||text.length>1500)return {status:400,body:{error:"Mensagem ou identificador inválido"}};
 const thread=one("SELECT t.*,l.phone,l.business FROM threads t JOIN leads l ON l.id=t.lead_id WHERE t.id=?",threadId);
 if(!thread||!thread.jid||!/^\d{10,15}@s\.whatsapp\.net$/.test(thread.jid))return {status:404,body:{error:"Conversa WhatsApp não encontrada"}};
 if(!prospectorLeadEligible(thread.lead_id))return {status:403,body:{error:'Conversa fora da prospecção'}};
 if(one("SELECT id FROM waakg_operator_outbox WHERE id=?",requestId))return {status:409,body:{error:"Essa mensagem já foi processada ou enviada. Confira a conversa antes de repetir."}};
 if(one("SELECT phone FROM suppressions WHERE phone=?",thread.phone))return {status:403,body:{error:"Contato optou por não receber mensagens"}};
 if(!one("SELECT id FROM messages WHERE thread_id=? AND direction='in' LIMIT 1",threadId))return {status:403,body:{error:"O envio pelo painel está limitado a conversas iniciadas pelo cliente"}};
 const session=leadSession(thread.lead_id),wa=await waControlStatus(session);
 if(!wa.connected||!session)return {status:503,body:{error:"Conecte seu WhatsApp na aba Conexões"}};
 const at=now();
 // UNKNOWN is deliberate: after a timeout the provider may have delivered the message.
 run("INSERT INTO waakg_operator_outbox(id,thread_id,state,created_at,updated_at) VALUES(?,?,?,?,?)",requestId,threadId,"UNKNOWN",at,at);
 try{
  const result=await waRequest("/api/messages/"+encodeURIComponent(session)+"/"+encodeURIComponent(thread.jid)+"/send",{method:"POST",data:{message:{text}}});
  if(result.status!==true)return {status:502,body:{error:"Envio não confirmado. Não tente repetir automaticamente."}};
  run("UPDATE waakg_operator_outbox SET state='SENT',updated_at=? WHERE id=?",now(),requestId);
  addMessage({threadId,providerId:"operator:"+requestId,direction:"out",body:text,status:"sent"});
  stage(thread.lead_id,"CONVERSING","OPERATOR_CHAT_MESSAGE");
  run("UPDATE threads SET manual_takeover=1 WHERE id=?",threadId);
  audit("WA_AKG_CHAT_MESSAGE_SENT",thread.lead_id,{thread:threadId,manual:true});
  return {status:200,body:{ok:true,delivery:"ACCEPTED",message:"Enviado ao WA-AKG"}};
 }catch(e){return {status:502,body:{error:"Falha ou resultado incerto no WhatsApp. Confira a conversa antes de tentar novamente.",delivery:"UNKNOWN"}};}
}
