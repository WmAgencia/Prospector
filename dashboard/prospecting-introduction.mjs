// Two-step introduction on an APPROVED WA-AKG prospect campaign.
// A reply to "Olá, <nome>, tudo bem?" schedules ONE introduction after 30s.
// After the introduction, every incoming reply can continue the sales conversation.
// No public listing is ever treated as documented WhatsApp opt-in.
import {db,one,all,run,now,audit,addMessage} from './db.mjs';
import {operatorSelected,conversationAuthorized} from './operator-outreach.mjs';
import {documentedOptIn} from './outreach-queue.mjs';
import {classifyContact} from './whatsapp-roles.mjs';
import {threeMonthsAfter} from './prospecting-recontact.mjs';
import {priceQuestion} from './sales-policy.mjs';
import {detectAutomaticReply,friendlyGreeting,portfolioQuestion} from './portfolio-offer-550.mjs';
import {tenantApproachGreeting} from './tenant-approach.mjs';
import {waControlStatus,selectedWaSession,waRequest} from './waakg-control.mjs';
import {isManagedSession,leadSession} from './waakg-session-registry.mjs';
import {sendVoiceWithRecording} from './waakg-voice-presence.mjs';
import {wantsPortfolioPitchAudio,acceptsPortfolioPresentation} from './portfolio-pitch-audio.mjs';
import {loadCurrentPortfolioVoice,currentVoiceEligible,CURRENT_VOICE_OFFER_BRL} from './portfolio-pitch-voice-550.mjs';
import {queueNotice} from './notifications.mjs';
import {conversationFinished} from './prospect-terminal-conversation.mjs';
import {approvedOwnerRecordingStatus} from './owner-approved-pitch.mjs';
import {enqueueOwnerPitch} from './owner-pitch-sequence.mjs';

export const INTRO_DELAY_MS=30_000;
export const WESLEY_INTRO='Meu nome é Wesley, sou dono da agência Consecom. Eu tô entrando em contato porque queria fazer uma proposta pra vocês.';
db.exec("CREATE TABLE IF NOT EXISTS prospecting_introductions(lead_id TEXT PRIMARY KEY REFERENCES leads(id),phone TEXT NOT NULL,session_id TEXT NOT NULL,greeting_id TEXT NOT NULL,stage TEXT NOT NULL,first_reply_id TEXT,first_reply_at TEXT,due_at TEXT,attempt_at TEXT,sent_at TEXT,reason TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
db.exec("CREATE INDEX IF NOT EXISTS idx_introduction_due ON prospecting_introductions(stage,due_at)");
// Network activity may have succeeded before a process restart. Never retry automatically.
run("UPDATE prospecting_introductions SET stage='UNKNOWN',reason='Process interrupted during send; verify WhatsApp',updated_at=? WHERE stage='SENDING'",now());

const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function asksAboutProposal(value=''){
 const s=clean(value);
 if(portfolioQuestion(s))return true;
 return /(?:sobre o que|do que) (?:se trata|seria|e) (?:essa |a |sua )?(?:proposta|oferta)|(?:qual|que|como) (?:e |seria )?(?:a |essa |sua )?(?:proposta|oferta)|(?:me explica|pode explicar|explica|me fala|me conte|pode falar).{0,65}(?:proposta|oferta|servico|site|trabalho)|(?:quero|gostaria de) (?:saber|entender|conhecer|ver).{0,45}(?:proposta|oferta)|(?:pode|poderia) (?:me )?(?:contar|explicar|falar) (?:mais|sobre)|(?:quanto (?:custa|fica)|qual (?:o )?(?:valor|preco|investimento)|fazer (?:um )?orcamento)|(?:quero (?:fechar|contratar)|vamos (?:fechar|comecar))/i.test(s);
}
export function greetingForProspect(lead={},at=new Date()){
 // The original master/Consecom two-step approach stays EXACTLY as configured.
 if(!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true')return friendlyGreeting(lead,at);
 // A client may use only its approved tenant-specific first-message template.
 return tenantApproachGreeting(lead)||friendlyGreeting(lead,at);
}
export function introductionStatus(leadId){return one('SELECT * FROM prospecting_introductions WHERE lead_id=?',String(leadId||''))||null;}
export function registerGreeting({leadId,greetingId,sessionId}={}){
 if(process.env.PROSPECTOR_TENANT_ID&&process.env.PROSPECTOR_TENANT_INTERNAL!=='true')return false; // other tenants never use Wesley's introduction
 const lead=one('SELECT id,phone,contact_permission FROM leads WHERE id=?',leadId);
 if(!lead||!lead.phone||(!documentedOptIn(lead.id)&&!operatorSelected(lead.id)))return false;
 if(!sessionId||!greetingId)return false;
 const timestamp=now();
 const previous=introductionStatus(leadId);
 if(previous){
  const eligibleAt=threeMonthsAfter(previous.created_at);
  if(previous.greeting_id===greetingId||['SENDING','UNKNOWN'].includes(previous.stage)||!eligibleAt||Date.parse(eligibleAt)>Date.parse(timestamp))return false;
 }
 return run("INSERT OR IGNORE INTO prospecting_introductions(lead_id,phone,session_id,greeting_id,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(lead_id) DO UPDATE SET phone=excluded.phone,session_id=excluded.session_id,greeting_id=excluded.greeting_id,stage=excluded.stage,first_reply_id=NULL,first_reply_at=NULL,due_at=NULL,attempt_at=NULL,sent_at=NULL,reason=NULL,created_at=excluded.created_at,updated_at=excluded.updated_at WHERE prospecting_introductions.greeting_id<>excluded.greeting_id AND prospecting_introductions.stage NOT IN ('SENDING','UNKNOWN') AND prospecting_introductions.created_at=?",
  leadId,lead.phone,sessionId,greetingId,'GREETING_SENT',timestamp,timestamp,previous?.created_at||'').changes===1;
}
export function cancelIntroduction(leadId,reason='CONTACT_DECLINED'){
 const row=introductionStatus(leadId);
 if(!row||!['GREETING_SENT','WAITING','VOICE_WAITING','VOICE_REVIEW'].includes(row.stage))return false;
 run("UPDATE prospecting_introductions SET stage='CANCELLED',reason=?,updated_at=? WHERE lead_id=? AND stage IN ('GREETING_SENT','WAITING','VOICE_WAITING','VOICE_REVIEW')",String(reason).slice(0,110),now(),leadId);
 return true;
}
// Explicit product decision: NEVER synthesize Francisca's voice as Wesley's
// recorded sales pitch. Voice requests require a separately approved owner
// recording and human review; disabling the voice service must not block text.
export function queueManualPitchReview(leadId,reason='OWNER_RECORDING_REQUIRED'){
 const item=introductionStatus(leadId);
 if(!item||!['GREETING_SENT','WAITING','VOICE_WAITING','SENT','CONVERSING','VOICE_REVIEW'].includes(item.stage))return false;
 const update=run("UPDATE prospecting_introductions SET stage='VOICE_REVIEW',reason=?,due_at=NULL,updated_at=? WHERE lead_id=? AND stage<> 'VOICE_REVIEW'",reason,now(),leadId);
 queueNotice('owner-pitch-review:'+leadId,'OWNER_PITCH_REVIEW',
  'Contato '+String(item.phone).slice(-4)+' pediu a proposta; enviar apenas gravação original do Wesley aprovada. Verifique o histórico antes de responder.',leadId);
 if(update.changes)audit('OWNER_PITCH_REVIEW_REQUIRED',leadId,{reason,phoneSuffix:String(item.phone).slice(-4),sessionId:item.session_id});
 return true;
}
export function recoverDisabledPitchQueue(){
 const items=all("SELECT lead_id FROM prospecting_introductions WHERE stage='VOICE_WAITING'");
 let count=0;
 for(const item of items){if(queueManualPitchReview(item.lead_id,'AUTO_VOICE_DISABLED_OWNER_REVIEW'))count++;}
 return {markedForReview:count};
}

export function routeIntroductionReply({leadId,providerId,body='',inboxState='REVIEW',receivedAt=new Date()}={}){
 const item=introductionStatus(leadId);
 // Never pitch an automated responder or an opted-out contact.
 if(inboxState==='AUTO_REPLY'||detectAutomaticReply(body))return {managed:true,queueAi:false,state:'AUTO_REPLY'};
 if(!item)return {managed:false,queueAi:true};
 if(conversationFinished(leadId,item.session_id))return {managed:true,queueAi:false,state:'FINISHED'};
 if(inboxState!=='REVIEW'){
  cancelIntroduction(leadId,'INBOX_'+inboxState);
  return {managed:true,queueAi:false,state:'CANCELLED'};
 }
 const prefersText=/(?:prefiro|quero) (?:em )?texto|(?:nao|não).{0,20}(?:audio|áudio|voz)/i.test(body);
 const wantsVoice=!prefersText&&wantsPortfolioPitchAudio(body);
 const acceptsVoice=!prefersText&&acceptsPortfolioPresentation(body);
 // If a customer specifically asks about the proposal after the greeting,
 // never let a disabled AI voice service monopolize the text reply queue.
 if(wantsVoice||acceptsVoice){
  if(approvedOwnerRecordingStatus().ready){
   const result=enqueueOwnerPitch({leadId,sessionId:item.session_id,providerId,receivedAt});
   if(['PENDING_AUDIO','AUDIO_ACCEPTED','DONE','ALREADY_QUEUED'].includes(result.state)){
    run("UPDATE prospecting_introductions SET stage='VOICE_REVIEW',reason='OWNER_AUDIO_QUEUED',due_at=NULL,updated_at=? WHERE lead_id=? AND stage NOT IN ('UNKNOWN','CANCELLED')",now(),leadId);
    audit('PROSPECT_OWNER_AUDIO_SCHEDULED',leadId,{sha:'OWNER_APPROVED',stage:result.state});
    return {managed:true,queueAi:false,state:'OWNER_AUDIO_QUEUED'};
   }
  }
  if(queueManualPitchReview(leadId,'AWAITING_APPROVED_WESLEY_RECORDING'))
   return {managed:true,queueAi:false,state:'VOICE_REVIEW'};
 }
 const received=new Date(receivedAt),timestamp=Number.isFinite(received.getTime())?received:new Date();
 const due=new Date(timestamp.getTime()+INTRO_DELAY_MS).toISOString();
 const sourceId=String(providerId||'').slice(0,180);
 if(item.stage==='GREETING_SENT'){
  const next=wantsVoice?'VOICE_WAITING':'WAITING';
  run("UPDATE prospecting_introductions SET stage=?,first_reply_id=?,first_reply_at=?,due_at=?,updated_at=? WHERE lead_id=? AND stage='GREETING_SENT'",
   next,sourceId,timestamp.toISOString(),due,now(),leadId);
  audit('PROSPECT_GREETING_ANSWERED',leadId,{dueAt:due,next,voiceRequested:wantsVoice});
  return {managed:true,queueAi:false,state:next};
 }
 if(item.stage==='WAITING'){
  if(wantsVoice||acceptsVoice){
   run("UPDATE prospecting_introductions SET stage='VOICE_WAITING',due_at=?,updated_at=? WHERE lead_id=? AND stage='WAITING'",due,now(),leadId);
   audit('PROSPECT_PITCH_VOICE_REQUESTED',leadId,{dueAt:due});
   return {managed:true,queueAi:false,state:'VOICE_WAITING'};
  }
  return {managed:true,queueAi:false,state:'WAITING'};
 }
 if(item.stage==='VOICE_WAITING'||item.stage==='VOICE_REVIEW'){
  queueManualPitchReview(leadId,'AWAITING_APPROVED_WESLEY_RECORDING');
  return {managed:true,queueAi:false,state:'VOICE_REVIEW'};
 }
 if(['SENT','CONVERSING'].includes(item.stage)&&(wantsVoice||acceptsVoice)){
  const pitched=one("SELECT 1 FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.lead_id=? AND m.provider_id LIKE 'intro-voice:%' LIMIT 1",leadId);
  if(!pitched&&item.reason!=='PITCH_AUDIO_550'){
   const updated=run("UPDATE prospecting_introductions SET stage='VOICE_WAITING',first_reply_id=?,first_reply_at=?,due_at=?,updated_at=? WHERE lead_id=? AND stage=?",sourceId,timestamp.toISOString(),due,now(),leadId,item.stage);
   if(updated.changes){audit('PROSPECT_PITCH_VOICE_REQUESTED',leadId,{dueAt:due,afterTextIntro:true,affirmative:acceptsVoice});return {managed:true,queueAi:false,state:'VOICE_WAITING'};}
  }
 }
 if(item.stage==='SENT'||item.stage==='VOICE_SENT'){
  run('UPDATE prospecting_introductions SET stage=?,updated_at=? WHERE lead_id=? AND stage=?','CONVERSING',now(),leadId,item.stage);
  audit('PROSPECT_INVITED_PROPOSAL_DETAILS',leadId,{providerId:sourceId,previousStage:item.stage});
  return {managed:true,queueAi:true,state:'CONVERSING'};
 }
 return {managed:true,queueAi:item.stage==='CONVERSING',state:item.stage};
}

let busy=false;
export async function tickIntroductions(deps={}){
 if(busy)return {state:'BUSY'};
 const {currentTime=()=>Date.now(),status=waControlStatus,session=selectedWaSession,
  send=waRequest,sendAudio=sendVoiceWithRecording,loadAudio=loadCurrentPortfolioVoice}=deps;
 busy=true;
 try{
  const at=currentTime();
  // Strictly text-only. Disabled or unapproved voice jobs are reviewed by an
  // operator and NEVER selected, so they cannot starve other replies.
  const item=one("SELECT p.*,l.stage lead_stage,l.contact_permission,l.id id,t.manual_takeover FROM prospecting_introductions p JOIN leads l ON l.id=p.lead_id LEFT JOIN threads t ON t.lead_id=l.id WHERE p.stage='WAITING' AND p.due_at<=? ORDER BY p.due_at LIMIT 1",new Date(at).toISOString());
  if(!item)return {state:'IDLE'};
  const voiceRequested=item.stage==='VOICE_WAITING';
  const eligible=()=>{
   const current=introductionStatus(item.lead_id);
   const lead=one('SELECT stage,contact_permission,phone FROM leads WHERE id=?',item.lead_id);
   const takeover=one('SELECT manual_takeover FROM threads WHERE lead_id=?',item.lead_id);
   if(!current||current.greeting_id!==item.greeting_id||current.stage!==item.stage||!lead||lead.phone!==item.phone)return false;
   const identified=classifyContact({jid:item.phone+'@s.whatsapp.net',sessionId:item.session_id});
   const blocked=one('SELECT phone FROM suppressions WHERE phone=?',item.phone);
   // An existing first text introduction is allowed when the customer only
   // then requests the full pitch as a voice note. Other outbound texts block.
   const extra=one("SELECT 1 FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.lead_id=? AND m.direction='out' AND m.provider_id<>? AND m.provider_id<>? AND m.rowid>COALESCE((SELECT rowid FROM messages WHERE provider_id=?),0) AND m.at>=? LIMIT 1",
    item.lead_id,'prospect-queue:'+item.greeting_id,'intro:'+item.greeting_id,
    'prospect-queue:'+item.greeting_id,voiceRequested?(item.first_reply_at||item.created_at):item.created_at);
   if(!conversationAuthorized(item.lead_id)||blocked||takeover?.manual_takeover===1||
    ['NO_INTEREST','INTERESTED','CLOSED_WON'].includes(lead.stage)||extra||
    identified.role!=='PROSPECT_APPROACHED'||(voiceRequested&&!currentVoiceEligible())||
    (deps.session?session()!==item.session_id:!isManagedSession(item.session_id)||leadSession(item.lead_id)!==item.session_id)){
    return false;
   }
   return true;
  };
  if(!eligible()){cancelIntroduction(item.lead_id,'ELIGIBILITY_CHANGED');return {state:'CANCELLED'};}
  // Validate/transcode the audio before claiming the send. When missing,
  // keep the job pending instead of sending a different offer as plain text.
  let voice=null;
  if(voiceRequested){
   try{
    voice=await loadAudio();
    if(!Buffer.isBuffer(voice?.bytes)||voice.bytes.length<256||voice.offerBRL!==CURRENT_VOICE_OFFER_BRL)throw Error('AUDIO_OFFER_NOT_APPROVED');
   }catch(e){
    const reason=String(e?.message||e).slice(0,85);
    queueNotice('pitch-550-unavailable:'+item.lead_id,'PITCH_AUDIO_NEEDS_REVIEW',
     'Áudio da proposta de R$ 550 pendente para '+item.phone+'; motivo: '+reason+'. Conferir WhatsApp antes de qualquer envio manual.',item.lead_id);
    return {state:'VOICE_ASSET_UNAVAILABLE',reason};
   }
  }
  const wa=await status(item.session_id);
  if(!wa.connected)return {state:'OFFLINE'};
  if(!eligible()){cancelIntroduction(item.lead_id,'ELIGIBILITY_CHANGED');return {state:'CANCELLED'};}
  // Reserve before attempting network transport; UNKNOWN never auto-retries.
  if(!run("UPDATE prospecting_introductions SET stage='SENDING',attempt_at=?,updated_at=? WHERE lead_id=? AND stage=? AND due_at<=?",
   new Date(at).toISOString(),now(),item.lead_id,item.stage,new Date(at).toISOString()).changes)return {state:'BUSY'};
  try{
   if(voiceRequested){
    const ack=await sendAudio({jid:item.phone+'@s.whatsapp.net',session:item.session_id,bytes:voice.bytes});
    if(ack?.accepted!==true)throw Error('VOICE_UNCONFIRMED');
   }else{
    const ack=await send('/api/messages/'+encodeURIComponent(item.session_id)+'/'+encodeURIComponent(item.phone+'@s.whatsapp.net')+'/send',
     {method:'POST',data:{message:{text:WESLEY_INTRO}}});
    if(ack.status!==true)throw Error('TEXT_UNCONFIRMED');
   }
   const nextStage=voiceRequested?'VOICE_SENT':'SENT';
   run("UPDATE prospecting_introductions SET stage=?,reason=?,sent_at=?,updated_at=? WHERE lead_id=? AND stage='SENDING'",
    nextStage,voiceRequested?'PITCH_AUDIO_550':null,now(),now(),item.lead_id);
   const thread=one('SELECT id FROM threads WHERE lead_id=?',item.lead_id);
   if(thread)addMessage({threadId:thread.id,
    providerId:(voiceRequested?'intro-voice:':'intro:')+item.greeting_id,direction:'out',
    body:voiceRequested?'[Áudio da Francisca: proposta de portfólio R$ 550]':WESLEY_INTRO,
    status:'sent'});
   audit(voiceRequested?'PROSPECT_PITCH_AUDIO_SENT':'PROSPECT_INTRO_SENT',item.lead_id,
    voiceRequested?{voice:true,voiceProvider:'FRANCISCA_TTS',offerBRL:CURRENT_VOICE_OFFER_BRL,delaySeconds:30,
     gatewayAccepted:true,verifiedOnPhone:false}:{delaySeconds:30});
   return {state:nextStage,leadId:item.lead_id,recipientSuffix:String(item.phone).slice(-4),verifiedOnPhone:false};
  }catch{
   run("UPDATE prospecting_introductions SET stage='UNKNOWN',reason='Uncertain delivery; verify WhatsApp',updated_at=? WHERE lead_id=? AND stage='SENDING'",now(),item.lead_id);
   audit('PROSPECT_INTRO_UNKNOWN',item.lead_id,{manualReview:true,voice:voiceRequested});
   return {state:'UNKNOWN'};
  }
 }finally{busy=false;}
}


/**
 * One-time, conservative repair for proposal questions received before a deploy.
 * Recover only the latest, unanswered, approved inbound message. Never retry
 * an uncertain send and never requeue an audio already recorded as sent.
 */
export function recoverUnansweredPitchRequests({at=Date.now(),windowMinutes=90,limit=8}={}){
 const cutoff=new Date(at-Math.min(180,Math.max(1,windowMinutes))*60_000).toISOString();
 const rows=all(`SELECT p.lead_id,p.phone,i.provider_id,i.body,i.received_at
  FROM prospecting_introductions p
  JOIN waakg_inbox i ON i.lead_id=p.lead_id
  WHERE p.stage IN ('SENT','CONVERSING') AND i.state='REVIEW' AND i.received_at>=?
    AND i.rowid=(SELECT MAX(i2.rowid) FROM waakg_inbox i2 WHERE i2.lead_id=p.lead_id)
  ORDER BY i.received_at DESC LIMIT 80`,cutoff);
 let recovered=0;const suffixes=[];
 for(const row of rows){
  if(recovered>=Math.max(1,Math.min(20,limit)))break;
  if(!wantsPortfolioPitchAudio(row.body))continue;
  const alreadyAnswered=one(`SELECT 1 FROM messages m JOIN threads t ON t.id=m.thread_id
    WHERE t.lead_id=? AND m.direction='out' AND m.at>=? LIMIT 1`,row.lead_id,row.received_at);
  if(alreadyAnswered)continue;
  const alreadySent=one(`SELECT 1 FROM messages m JOIN threads t ON t.id=m.thread_id
    WHERE t.lead_id=? AND m.provider_id LIKE 'intro-voice:%' LIMIT 1`,row.lead_id);
  if(alreadySent||one('SELECT 1 FROM suppressions WHERE phone=?',row.phone))continue;
  const routed=routeIntroductionReply({leadId:row.lead_id,providerId:row.provider_id,body:row.body,inboxState:'REVIEW',receivedAt:row.received_at});
  if(routed.state==='VOICE_WAITING'){recovered++;suffixes.push(String(row.phone).slice(-4));}
 }
 return {recovered,contactSuffixes:suffixes};
}
