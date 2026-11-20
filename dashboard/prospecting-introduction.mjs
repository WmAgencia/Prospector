import {ownerProspectionPaused} from './prospection-pause.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {sendOfferVideoMedia} from './waakg-media.mjs';
import {CAMPAIGN_VIDEO_CAPTION} from './consecom-flow.mjs';
// Two-step introduction on an APPROVED WA-AKG prospect campaign.
// A reply to "Olá, <nome>, tudo bem?" schedules ONE introduction after 30s.
// After the introduction, every incoming reply can continue the sales conversation.
// No public listing is ever treated as documented WhatsApp opt-in.
import {db,one,run,now,audit,addMessage,getSetting} from './db.mjs';
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
import {portfolioPitchAudioEnabled,wantsPortfolioPitchAudio,readPortfolioPitchAudio,PITCH_AUDIO_ORIGINAL_SHA256} from './portfolio-pitch-audio.mjs';
import {acceptsProposalAudio} from './prospector-sales-signals.mjs';

export const INTRO_DELAY_MS=30_000;
export const PITCH_PREVIEW_DELAY_MS=10_000;
export const PITCH_PREVIEW_TEXT=CAMPAIGN_VIDEO_CAPTION;
export const PITCH_VIDEO_SOURCE_SHA256='326b9d042adba1b3b996811f6ad37fe4b79aafde58f363f92db3d71ce6d9df1b';
export function readPitchVideo(){
 const bytes=fs.readFileSync(new URL('./assets/consecom-demo-20261119.mp4',import.meta.url));
 if(bytes.length<1024||bytes.length>15*1024*1024||bytes.toString('ascii',4,8)!=='ftyp'||
    crypto.createHash('sha256').update(bytes).digest('hex')!==PITCH_VIDEO_SOURCE_SHA256)
  throw Error('PITCH_VIDEO_SOURCE_INVALID');
 return {bytes,caption:PITCH_PREVIEW_TEXT,durationSeconds:44.166667};
}
export const WESLEY_INTRO='Meu nome é Wesley, sou dono da agência Consecom. Eu tô entrando em contato porque queria fazer uma proposta pra vocês. Posso te mandar um áudio explicando a ideia?';
db.exec("CREATE TABLE IF NOT EXISTS prospecting_introductions(lead_id TEXT PRIMARY KEY REFERENCES leads(id),phone TEXT NOT NULL,session_id TEXT NOT NULL,greeting_id TEXT NOT NULL,stage TEXT NOT NULL,first_reply_id TEXT,first_reply_at TEXT,due_at TEXT,attempt_at TEXT,sent_at TEXT,reason TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
db.exec("CREATE INDEX IF NOT EXISTS idx_introduction_due ON prospecting_introductions(stage,due_at)");
for(const column of ['followup_due_at','followup_status','followup_attempt_at','followup_sent_at']){
 if(!db.prepare('PRAGMA table_info(prospecting_introductions)').all().some(x=>x.name===column))
  db.exec('ALTER TABLE prospecting_introductions ADD COLUMN '+column+' TEXT');
}
run("UPDATE prospecting_introductions SET followup_status='UNKNOWN' WHERE followup_status='SENDING'");
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
 return run("INSERT OR IGNORE INTO prospecting_introductions(lead_id,phone,session_id,greeting_id,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(lead_id) DO UPDATE SET phone=excluded.phone,session_id=excluded.session_id,greeting_id=excluded.greeting_id,stage=excluded.stage,first_reply_id=NULL,first_reply_at=NULL,due_at=NULL,attempt_at=NULL,sent_at=NULL,reason=NULL,followup_due_at=NULL,followup_status=NULL,followup_attempt_at=NULL,followup_sent_at=NULL,created_at=excluded.created_at,updated_at=excluded.updated_at WHERE prospecting_introductions.greeting_id<>excluded.greeting_id AND prospecting_introductions.stage NOT IN ('SENDING','UNKNOWN') AND prospecting_introductions.created_at=?",
  leadId,lead.phone,sessionId,greetingId,'GREETING_SENT',timestamp,timestamp,previous?.created_at||'').changes===1;
}
export function cancelIntroduction(leadId,reason='CONTACT_DECLINED'){
 const row=introductionStatus(leadId);
 if(!row||!['GREETING_SENT','WAITING','VOICE_WAITING'].includes(row.stage))return false;
 run("UPDATE prospecting_introductions SET stage='CANCELLED',reason=?,updated_at=? WHERE lead_id=? AND stage IN ('GREETING_SENT','WAITING','VOICE_WAITING')",String(reason).slice(0,110),now(),leadId);
 return true;
}
export function routeIntroductionReply({leadId,providerId,body='',inboxState='REVIEW',receivedAt=new Date()}={}){
 const item=introductionStatus(leadId);
 // Never pitch an automated responder or an opted-out contact.
 if(inboxState==='AUTO_REPLY'||detectAutomaticReply(body))return {managed:true,queueAi:false,state:'AUTO_REPLY'};
 if(!item)return {managed:false,queueAi:true};
 if(inboxState!=='REVIEW'){
  cancelIntroduction(leadId,'INBOX_'+inboxState);
  return {managed:true,queueAi:false,state:'CANCELLED'};
 }
 const wantsVoice=portfolioPitchAudioEnabled()&&wantsPortfolioPitchAudio(body);
 const received=new Date(receivedAt),timestamp=Number.isFinite(received.getTime())?received:new Date();
 const due=new Date(timestamp.getTime()+INTRO_DELAY_MS).toISOString();
 const sourceId=String(providerId||'').slice(0,180);
 if(item.stage==='GREETING_SENT'){
  // A direct question about the proposal is a request for the approved audio.
  // A simple greeting still receives Wesley's permission question first.
  const next='WAITING'; // Always ask Wesley's unchanged audio-permission question first.
  run("UPDATE prospecting_introductions SET stage=?,first_reply_id=?,first_reply_at=?,due_at=?,updated_at=? WHERE lead_id=? AND stage='GREETING_SENT'",
   next,sourceId,timestamp.toISOString(),due,now(),leadId);
  audit('PROSPECT_GREETING_ANSWERED',leadId,{dueAt:due,next,voiceRequested:next==='VOICE_WAITING'});
  return {managed:true,queueAi:false,state:next};
 }
 if(item.stage==='WAITING')return {managed:true,queueAi:false,state:'WAITING'};
 if(item.stage==='VOICE_WAITING')return {managed:true,queueAi:false,state:'VOICE_WAITING'};
 if(item.stage==='SENT'&&(wantsVoice||acceptsProposalAudio(body))){
  run("UPDATE prospecting_introductions SET stage='VOICE_WAITING',due_at=?,updated_at=? WHERE lead_id=? AND stage='SENT'",due,now(),leadId);
  audit('PROSPECT_PITCH_VOICE_REQUESTED',leadId,{dueAt:due,afterTextIntro:true});
  return {managed:true,queueAi:false,state:'VOICE_WAITING'};
 }
 if(item.stage==='SENT')return {managed:true,queueAi:false,state:'AWAITING_AUDIO_PERMISSION'};
 if(item.stage==='VOICE_SENT'){
  // A normal inbound reply must not cancel the demo scheduled ten seconds
  // after the audio. Confirmed interest, refusal or human takeover still stop
  // media through the existing eligibility checks in tickPitchFollowup.
  if(item.followup_status==='WAITING'){
   audit('PROSPECT_POST_AUDIO_REPLY',leadId,{providerId:sourceId,previewStillScheduled:true});
   return {managed:true,queueAi:true,state:'VOICE_SENT'};
  }
  run("UPDATE prospecting_introductions SET stage='CONVERSING',updated_at=? WHERE lead_id=? AND stage='VOICE_SENT'",now(),leadId);
  audit('PROSPECT_INVITED_PROPOSAL_DETAILS',leadId,{providerId:sourceId,previousStage:item.stage});
  return {managed:true,queueAi:true,state:'CONVERSING'};
 }
 return {managed:true,queueAi:item.stage==='CONVERSING',state:item.stage};
}

let busy=false;
export async function tickIntroductions(deps={}){
 if(ownerProspectionPaused())return {state:'PAUSED_BY_OWNER'};
 if(busy)return {state:'BUSY'};
 const {currentTime=()=>Date.now(),status=waControlStatus,session=selectedWaSession,
  send=waRequest,sendAudio=sendVoiceWithRecording,loadAudio=readPortfolioPitchAudio}=deps;
 busy=true;
 try{
  const at=currentTime();
  const item=one("SELECT p.*,l.stage lead_stage,l.contact_permission,l.id id,t.manual_takeover FROM prospecting_introductions p JOIN leads l ON l.id=p.lead_id LEFT JOIN threads t ON t.lead_id=l.id WHERE p.stage IN ('WAITING','VOICE_WAITING') AND p.due_at<=? ORDER BY p.due_at LIMIT 1",new Date(at).toISOString());
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
    'prospect-queue:'+item.greeting_id,item.created_at);
   if(!conversationAuthorized(item.lead_id)||blocked||takeover?.manual_takeover===1||
    ['NO_INTEREST','INTERESTED','CLOSED_WON'].includes(lead.stage)||extra||
    identified.role!=='PROSPECT_APPROACHED'||(voiceRequested&&!portfolioPitchAudioEnabled())||
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
    if(!Buffer.isBuffer(voice?.bytes)||voice.bytes.length<200000)throw Error('AUDIO_NOT_READY');
    if(!Buffer.isBuffer(readPitchVideo().bytes))throw Error('VIDEO_NOT_READY');
   }catch(e){return {state:'VOICE_ASSET_UNAVAILABLE',reason:String(e?.message||e).slice(0,85)};}
  }
  const wa=await status(item.session_id);
  if(!wa.connected)return {state:'OFFLINE'};
  if(!eligible()){cancelIntroduction(item.lead_id,'ELIGIBILITY_CHANGED');return {state:'CANCELLED'};}
  // Reserve before attempting network transport; UNKNOWN never auto-retries.
  if(!run("UPDATE prospecting_introductions SET stage='SENDING',attempt_at=?,updated_at=? WHERE lead_id=? AND stage=? AND due_at<=?",
   new Date(at).toISOString(),now(),item.lead_id,item.stage,new Date(at).toISOString()).changes)return {state:'BUSY'};
  // Recheck ownership just before transport, including after the recording indicator.
  const stillAutomated=()=>{
   const current=introductionStatus(item.lead_id);
   return current?.stage==='SENDING'&&current?.greeting_id===item.greeting_id&&
    one('SELECT manual_takeover FROM threads WHERE lead_id=?',item.lead_id)?.manual_takeover!==1&&
    !ownerProspectionPaused()&&conversationAuthorized(item.lead_id);
  };
  try{
   if(voiceRequested){
    const ack=await sendAudio({jid:item.phone+'@s.whatsapp.net',session:item.session_id,bytes:voice.bytes,shouldSend:stillAutomated});
    if(ack?.accepted!==true)throw Error('VOICE_UNCONFIRMED');
   }else{
    if(!stillAutomated())throw Error('TEXT_OWNER_TAKEOVER');
    const ack=await send('/api/messages/'+encodeURIComponent(item.session_id)+'/'+encodeURIComponent(item.phone+'@s.whatsapp.net')+'/send',
     {method:'POST',data:{message:{text:WESLEY_INTRO}}});
    if(ack.status!==true)throw Error('TEXT_UNCONFIRMED');
   }
   const nextStage=voiceRequested?'VOICE_SENT':'SENT';
   const acceptedAt=now();
   const followupDue=voiceRequested?new Date(Date.now()+PITCH_PREVIEW_DELAY_MS).toISOString():null;
   run("UPDATE prospecting_introductions SET stage=?,reason=?,sent_at=?,followup_due_at=?,followup_status=?,updated_at=? WHERE lead_id=? AND stage='SENDING'",
    nextStage,voiceRequested?'PITCH_AUDIO_550':null,acceptedAt,followupDue,voiceRequested?'WAITING':null,acceptedAt,item.lead_id);
   const thread=one('SELECT id FROM threads WHERE lead_id=?',item.lead_id);
   if(thread)addMessage({threadId:thread.id,
    providerId:(voiceRequested?'intro-voice:':'intro:')+item.greeting_id,direction:'out',
    body:voiceRequested?'[Áudio original do Wesley: proposta de portfólio R$ 550]':WESLEY_INTRO,
    status:'sent'});
   audit(voiceRequested?'PROSPECT_PITCH_AUDIO_SENT':'PROSPECT_INTRO_SENT',item.lead_id,
    voiceRequested?{voice:true,sourceSha256:PITCH_AUDIO_ORIGINAL_SHA256,offerBRL:550,delaySeconds:30,
     gatewayAccepted:true,verifiedOnPhone:false}:{delaySeconds:30});
   return {state:nextStage,leadId:item.lead_id,verifiedOnPhone:false};
  }catch(error){
   if(['VOICE_OWNER_TAKEOVER','TEXT_OWNER_TAKEOVER'].includes(String(error?.message||''))){
    run("UPDATE prospecting_introductions SET stage='CONVERSING',reason='MANUAL_TAKEOVER',followup_status='CANCELLED',updated_at=? WHERE lead_id=? AND stage='SENDING'",now(),item.lead_id);
    audit('PROSPECT_INTRO_CANCELLED_MANUAL',item.lead_id,{voice:voiceRequested});
    return {state:'CANCELLED',reason:'MANUAL_TAKEOVER'};
   }
   run("UPDATE prospecting_introductions SET stage='UNKNOWN',reason='Uncertain delivery; verify WhatsApp',updated_at=? WHERE lead_id=? AND stage='SENDING'",now(),item.lead_id);
   audit('PROSPECT_INTRO_UNKNOWN',item.lead_id,{manualReview:true,voice:voiceRequested});
   return {state:'UNKNOWN'};
  }
 }finally{busy=false;}
}


// Persistent one-time preview question after the owner's confirmed original audio.
// Only brand-new automated audio acknowledgments schedule this; past/manual audios
// are not backfilled. Uncertain sends are NEVER automatically retried.
let pitchFollowupBusy=false;
export async function tickPitchFollowup(deps={}){
 if(ownerProspectionPaused()||getSetting('paused',true))return {state:'PAUSED'};
 if(pitchFollowupBusy)return {state:'BUSY'};
 const {currentTime=()=>Date.now(),status=waControlStatus,sendVideo=sendOfferVideoMedia,loadVideo=readPitchVideo}=deps;
 pitchFollowupBusy=true;
 try{
  const at=currentTime(),atIso=new Date(at).toISOString();
  const p=one("SELECT * FROM prospecting_introductions WHERE stage='VOICE_SENT' AND followup_status='WAITING' AND followup_due_at<=? ORDER BY followup_due_at LIMIT 1",atIso);
  if(!p)return {state:'IDLE'};
  const cancel=reason=>{
   run("UPDATE prospecting_introductions SET followup_status='CANCELLED',reason=?,updated_at=? WHERE lead_id=? AND stage='VOICE_SENT' AND followup_status='WAITING'",
    reason,now(),p.lead_id);
   audit('PROSPECT_PITCH_PREVIEW_CANCELLED',p.lead_id,{reason});
   return {state:'CANCELLED',reason};
  };
  if(at-Date.parse(p.followup_due_at)>90_000)return cancel('FOLLOWUP_WINDOW_EXPIRED');
  const lead=one("SELECT l.phone,l.stage,t.manual_takeover FROM leads l LEFT JOIN threads t ON t.lead_id=l.id WHERE l.id=?",p.lead_id);
  if(!lead||lead.phone!==p.phone||lead.manual_takeover===1||
   ['NO_INTEREST','INTERESTED','CLOSED_WON'].includes(lead.stage)||
   p.reason!=='PITCH_AUDIO_550'||!p.sent_at||
   !isManagedSession(p.session_id)||leadSession(p.lead_id)!==p.session_id||
   !conversationAuthorized(p.lead_id)||
   one('SELECT 1 FROM suppressions WHERE phone=?',p.phone))
   return cancel('CONTACT_NOT_ELIGIBLE');
  // Do not interrupt a conversation or duplicate a manually sent second message.
  const audioMessage=one("SELECT m.rowid FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.lead_id=? AND m.provider_id=? AND m.direction='out' ORDER BY m.rowid DESC LIMIT 1",
   p.lead_id,'intro-voice:'+p.greeting_id);
  if(!audioMessage)return cancel('AUDIO_NOT_RECORDED');
  // Inbound replies do not preempt the approved preview. Any later manual
  // outbound response does; explicit interest/refusal and takeover are guarded
  // by the lead stage and thread ownership checks above.
  const nextMessage=one("SELECT 1 FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.lead_id=? AND m.rowid>? AND m.direction='out' LIMIT 1",
   p.lead_id,audioMessage.rowid);
  if(nextMessage)return cancel('OTHER_OUTBOUND_AFTER_AUDIO');
  const wa=await status(p.session_id);
  if(!wa.connected)return {state:'OFFLINE'};
  if(one('SELECT manual_takeover FROM threads WHERE lead_id=?',p.lead_id)?.manual_takeover===1||
    introductionStatus(p.lead_id)?.stage!=='VOICE_SENT')return cancel('MANUAL_TAKEOVER');
  let video=null;
  try{
   video=await loadVideo();
   if(!Buffer.isBuffer(video?.bytes)||video.bytes.length<1024)throw Error('VIDEO_NOT_READY');
  }catch(error){return {state:'VIDEO_ASSET_UNAVAILABLE',reason:String(error?.message||error).slice(0,80)};}
  if(!run("UPDATE prospecting_introductions SET followup_status='SENDING',followup_attempt_at=?,updated_at=? WHERE lead_id=? AND stage='VOICE_SENT' AND followup_status='WAITING' AND followup_due_at<=?",
   atIso,now(),p.lead_id,atIso).changes)return {state:'BUSY'};
  try{
   if(ownerProspectionPaused()||getSetting('paused',true))throw Error('PAUSED_DURING_SEND');
   if(one('SELECT manual_takeover FROM threads WHERE lead_id=?',p.lead_id)?.manual_takeover===1||
      introductionStatus(p.lead_id)?.stage!=='VOICE_SENT')throw Error('MANUAL_TAKEOVER');
   const ack=await sendVideo({jid:p.phone+'@s.whatsapp.net',session:p.session_id,
    bytes:video.bytes,caption:PITCH_PREVIEW_TEXT});
   if(ack?.accepted!==true)throw Error('VIDEO_UNCONFIRMED');
   const stamp=now();
   run("UPDATE prospecting_introductions SET followup_status='SENT',followup_sent_at=?,updated_at=? WHERE lead_id=? AND followup_status='SENDING'",stamp,stamp,p.lead_id);
   const thread=one('SELECT id FROM threads WHERE lead_id=?',p.lead_id);
   if(thread)addMessage({threadId:thread.id,providerId:'intro-video:'+p.greeting_id,direction:'out',type:'video',body:PITCH_PREVIEW_TEXT,status:'sent'});
   audit('PROSPECT_PITCH_VIDEO_SENT',p.lead_id,{delaySeconds:10,session:p.session_id,gatewayAccepted:true});
   return {state:'SENT',leadId:p.lead_id};
  }catch(error){
   if(String(error?.message||'')==='MANUAL_TAKEOVER'){
    run("UPDATE prospecting_introductions SET followup_status='CANCELLED',reason='MANUAL_TAKEOVER',updated_at=? WHERE lead_id=? AND followup_status='SENDING'",now(),p.lead_id);
    return {state:'CANCELLED',reason:'MANUAL_TAKEOVER'};
   }
   run("UPDATE prospecting_introductions SET followup_status='UNKNOWN',reason='Follow-up delivery uncertain; manual review',updated_at=? WHERE lead_id=? AND followup_status='SENDING'",now(),p.lead_id);
   audit('PROSPECT_PITCH_PREVIEW_UNKNOWN',p.lead_id,{manualReview:true});
   return {state:'UNKNOWN',reason:String(error?.message||error).slice(0,80)};
  }
 }finally{pitchFollowupBusy=false;}
}
