import {ownerProspectionPaused} from './prospection-pause.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {sendOfferVideoMedia,sendRecordedOfferVoiceMedia} from './waakg-media.mjs';
import {CAMPAIGN_VIDEO_CAPTION} from './consecom-flow.mjs';
// Two-step introduction on an APPROVED WA-AKG prospect campaign.
// A reply to "Olá, <nome>, tudo bem?" schedules ONE introduction after 30s.
// After the introduction, every incoming reply can continue the sales conversation.
// No public listing is ever treated as documented WhatsApp opt-in.
import {db,one,all,run,now,audit,addMessage,getSetting,stage} from './db.mjs';
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
import {acceptsProposalAudio,interestedAfterProposal} from './prospector-sales-signals.mjs';
import {recordSalesOutcome} from './sales-outcomes.mjs';
import {beginPitchDelivery,acknowledgePitchDelivery,unknownPitchDelivery,cancelPitchDelivery,pitchDeliveryReceipt,receivePitchDeliveryStatus} from './pitch-delivery-verification.mjs';
import {reserveTextReceipt,acceptTextReceipt,unknownTextReceipt,extractTextMessageId,receiveTextReceiptStatus} from './prospecting-text-receipts.mjs';
import {preflightNewStep} from './prospecting-chat-history.mjs';
import {queueNotice} from './notifications.mjs';

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
   // Defer generic AI until the 10-second approved video is resolved.
   // Confirmed interest transfers immediately to the operator, without the video.
   if(item.reason==='PITCH_AUDIO_550'&&interestedAfterProposal(body)){
    const lead=one('SELECT stage FROM leads WHERE id=?',leadId);
    const owner=one('SELECT manual_takeover FROM threads WHERE lead_id=?',leadId);
    if(lead&&!['NO_INTEREST','INTERESTED','CLOSED_WON'].includes(lead.stage)&&owner?.manual_takeover!==1){
     stage(leadId,'INTERESTED','PITCH_AUDIO_550_INTEREST');
     run('UPDATE threads SET manual_takeover=1 WHERE lead_id=?',leadId);
     recordSalesOutcome({leadId,status:'INTERESTED',providerId:sourceId,evidence:body});
     audit('PROSPECT_POST_AUDIO_HOT_LEAD',leadId,{providerId:sourceId});
    }
    return {managed:true,queueAi:false,state:'INTERESTED'};
   }
   audit('PROSPECT_POST_AUDIO_REPLY',leadId,{providerId:sourceId,previewStillScheduled:true});
   return {managed:true,queueAi:false,state:'VOICE_SENT'};
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
  send=waRequest,sendAudio=async args=>sendVoiceWithRecording({...args,sendAudio:sendRecordedOfferVoiceMedia}),loadAudio=readPortfolioPitchAudio}=deps;
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
  // This is a brand-new stage (no previous network attempt). Read actual
  // WhatsApp history before issuing its one permitted transport request.
  const fetchHistory=deps.fetchHistory||(!deps.status&&!deps.send&&!deps.sendAudio?waRequest:null);
  if(fetchHistory){
   const proof=await preflightNewStep({sessionId:item.session_id,jid:item.phone+'@s.whatsapp.net',
    kind:voiceRequested?'AUDIO':'TEXT',text:voiceRequested?'':WESLEY_INTRO,
    at:new Date(at),fetchChat:fetchHistory});
   if(proof.state==='UNAVAILABLE')return {state:'HISTORY_UNAVAILABLE'};
   if(!voiceRequested&&proof.state==='EXISTS'){
    const messageId=String(proof.message?.keyId||proof.message?.key?.id||'');
    const changed=run("UPDATE prospecting_introductions SET stage='SENDING',attempt_at=?,updated_at=? WHERE lead_id=? AND greeting_id=? AND stage='WAITING'",
     now(),now(),item.lead_id,item.greeting_id).changes;
    if(!changed)return {state:'BUSY'};
    reserveTextReceipt({leadId:item.lead_id,greetingId:item.greeting_id,kind:'INTRO',sessionId:item.session_id,jid:item.phone+'@s.whatsapp.net'});
    acceptTextReceipt({leadId:item.lead_id,greetingId:item.greeting_id,kind:'INTRO',providerId:messageId});
    receiveTextReceiptStatus({event:'message.status',sessionId:item.session_id,
     data:{keyId:messageId,remoteJid:item.phone+'@s.whatsapp.net',
      status:['SENT','DELIVERED','READ'].includes(String(proof.message.status||'').toUpperCase())?proof.message.status:'SENT'}});
    const stamp=now();
    run("UPDATE prospecting_introductions SET stage='SENT',reason=NULL,sent_at=?,updated_at=? WHERE lead_id=? AND stage='SENDING'",
     stamp,stamp,item.lead_id);
    const thread=one('SELECT id FROM threads WHERE lead_id=?',item.lead_id);
    if(thread&&!one('SELECT id FROM messages WHERE provider_id=?','intro:'+item.greeting_id))
     addMessage({threadId:thread.id,providerId:'intro:'+item.greeting_id,direction:'out',body:WESLEY_INTRO,status:'sent'});
    audit('PROSPECT_PERMISSION_TEXT_ALREADY_IN_WHATSAPP',item.lead_id,{messageId,duplicateAvoided:true});
    return {state:'SENT',fromHistory:true};
   }
   if(proof.state!=='CLEAR'){
    run("UPDATE prospecting_introductions SET stage='UNKNOWN',reason=?,updated_at=? WHERE lead_id=? AND stage=?",
     'Possible earlier outbound WhatsApp media; manual review',now(),item.lead_id,item.stage);
    queueNotice('preflight-intro:'+item.greeting_id+':'+item.stage,'PITCH_DELIVERY_ISSUE',
     '*Prospector — mensagem já existe ou pode existir no WhatsApp*\\nDestino: '+item.phone+
     '\\nNenhum novo envio realizado; conferir mídia e mensagem.\\nhttps://wa.me/'+item.phone,item.lead_id);
    audit('PROSPECT_INTRO_PREFLIGHT_HELD',item.lead_id,{state:proof.state,voice:voiceRequested});
    return {state:'UNKNOWN',reason:'POSSIBLE_EXISTING_MESSAGE'};
   }
  }
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
    beginPitchDelivery({leadId:item.lead_id,greetingId:item.greeting_id,kind:'AUDIO',sessionId:item.session_id,jid:item.phone+'@s.whatsapp.net'});
    const ack=await sendAudio({jid:item.phone+'@s.whatsapp.net',session:item.session_id,bytes:voice.bytes,shouldSend:stillAutomated});
    if(ack?.accepted!==true)throw Error('VOICE_UNCONFIRMED');
    acknowledgePitchDelivery({leadId:item.lead_id,greetingId:item.greeting_id,kind:'AUDIO',providerId:ack.messageId});
   }else{
    if(!stillAutomated())throw Error('TEXT_OWNER_TAKEOVER');
    reserveTextReceipt({leadId:item.lead_id,greetingId:item.greeting_id,kind:'INTRO',sessionId:item.session_id,jid:item.phone+'@s.whatsapp.net'});
    const ack=await send('/api/messages/'+encodeURIComponent(item.session_id)+'/'+encodeURIComponent(item.phone+'@s.whatsapp.net')+'/send',
     {method:'POST',data:{message:{text:WESLEY_INTRO}}});
    if(ack.status!==true)throw Error('TEXT_UNCONFIRMED');
    acceptTextReceipt({leadId:item.lead_id,greetingId:item.greeting_id,kind:'INTRO',providerId:extractTextMessageId(ack)});
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
    if(voiceRequested)cancelPitchDelivery({leadId:item.lead_id,greetingId:item.greeting_id,kind:'AUDIO'});
    else unknownTextReceipt({leadId:item.lead_id,greetingId:item.greeting_id,kind:'INTRO',error:'MANUAL_TAKEOVER_DURING_RESERVATION'});
    run("UPDATE prospecting_introductions SET stage='CONVERSING',reason='MANUAL_TAKEOVER',followup_status='CANCELLED',updated_at=? WHERE lead_id=? AND stage='SENDING'",now(),item.lead_id);
    audit('PROSPECT_INTRO_CANCELLED_MANUAL',item.lead_id,{voice:voiceRequested});
    return {state:'CANCELLED',reason:'MANUAL_TAKEOVER'};
   }
   if(voiceRequested)unknownPitchDelivery({leadId:item.lead_id,greetingId:item.greeting_id,kind:'AUDIO',reason:String(error?.message||error)});
   else unknownTextReceipt({leadId:item.lead_id,greetingId:item.greeting_id,kind:'INTRO',error:String(error?.message||error)});
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
// A single unavailable sender/chat must not starve unrelated clients.
// In-memory cooldown never resends media; the durable receipt still enforces
// one actual network attempt for each recipient and video.
const pitchFollowupCheckAfter=new Map();
export async function tickPitchFollowup(deps={}){
 if(ownerProspectionPaused()||getSetting('paused',true))return {state:'PAUSED'};
 if(pitchFollowupBusy)return {state:'BUSY'};
 const {currentTime=()=>Date.now(),status=waControlStatus,sendVideo=sendOfferVideoMedia,loadVideo=readPitchVideo}=deps;
 pitchFollowupBusy=true;
 try{
  const at=currentTime(),atIso=new Date(at).toISOString();
  // Never allow one unconfirmed/failed audio to block videos for other
  // clients. Pick the earliest due video whose own audio is confirmed SENT
  // (or delivered/read) by the exact WhatsApp ID/history.
  for(const [leadId,retryAt] of pitchFollowupCheckAfter){
   if(retryAt<=at)pitchFollowupCheckAfter.delete(leadId);
  }
  const candidates=all(`SELECT p.* FROM prospecting_introductions p
   WHERE p.stage='VOICE_SENT' AND p.followup_status='WAITING'
    AND p.followup_due_at<=?
    AND EXISTS (SELECT 1 FROM pitch_delivery_receipts r
     WHERE r.lead_id=p.lead_id AND r.greeting_id=p.greeting_id
      AND r.kind='AUDIO' AND r.status IN ('SENT','DELIVERED','READ'))
   ORDER BY p.followup_due_at LIMIT 100`,atIso);
  const p=candidates.find(row=>(pitchFollowupCheckAfter.get(row.lead_id)||0)<=at);
  if(!p){
   if(candidates.length)return {state:'CHECK_DEFERRED',pending:candidates.length};
   const blocked=one(`SELECT p.lead_id,r.status AS audio_status
    FROM prospecting_introductions p
    LEFT JOIN pitch_delivery_receipts r
     ON r.lead_id=p.lead_id AND r.greeting_id=p.greeting_id AND r.kind='AUDIO'
    WHERE p.stage='VOICE_SENT' AND p.followup_status='WAITING'
     AND p.followup_due_at<=? ORDER BY p.followup_due_at LIMIT 1`,atIso);
   return blocked?{state:'WAITING_AUDIO_CONFIRMATION',audioStatus:blocked.audio_status||'MISSING'}:{state:'IDLE'};
  }
  const queueDeferredReply=async()=>{
   const owner=one('SELECT l.stage,t.manual_takeover FROM leads l LEFT JOIN threads t ON t.lead_id=l.id WHERE l.id=?',p.lead_id);
   if(!owner||owner.manual_takeover===1||['INTERESTED','NO_INTEREST','CLOSED_WON'].includes(owner.stage))return false;
   const inbound=one("SELECT provider_id,jid FROM waakg_inbox WHERE lead_id=? AND session_id=? AND state='REVIEW' AND received_at>=? ORDER BY received_at DESC LIMIT 1",p.lead_id,p.session_id,p.sent_at);
   if(!inbound)return false;
   try{
    const {queueInboundTurn}=await import('./groq-sales-automation.mjs');
    const queued=queueInboundTurn({providerId:inbound.provider_id,jid:inbound.jid,sessionId:p.session_id});
    audit('PROSPECT_POST_VIDEO_REPLY_QUEUED',p.lead_id,{queued});
    return queued;
   }catch(error){
    audit('PROSPECT_POST_VIDEO_REPLY_QUEUE_ERROR',p.lead_id,{reason:String(error?.message||error).slice(0,100)});
    return false;
   }
  };
  const cancel=async reason=>{
   run("UPDATE prospecting_introductions SET followup_status='CANCELLED',reason=?,updated_at=? WHERE lead_id=? AND stage='VOICE_SENT' AND followup_status='WAITING'",
    reason,now(),p.lead_id);
   audit('PROSPECT_PITCH_PREVIEW_CANCELLED',p.lead_id,{reason});
   if(reason==='FOLLOWUP_WINDOW_EXPIRED')await queueDeferredReply();
   return {state:'CANCELLED',reason};
  };
  // Recovery after a temporary outage is allowed for the original approved video.
  // A long delay becomes an operator issue, never a blind retry.
  if(at-Date.parse(p.followup_due_at)>6*60*60_000)return cancel('FOLLOWUP_WINDOW_EXPIRED');
  const lead=one("SELECT l.phone,l.stage,t.manual_takeover FROM leads l LEFT JOIN threads t ON t.lead_id=l.id WHERE l.id=?",p.lead_id);
  if(!lead||lead.phone!==p.phone||lead.manual_takeover===1||
   ['NO_INTEREST','INTERESTED','CLOSED_WON'].includes(lead.stage)||
   p.reason!=='PITCH_AUDIO_550'||!p.sent_at||
   !isManagedSession(p.session_id)||leadSession(p.lead_id)!==p.session_id||
   !conversationAuthorized(p.lead_id)||
   one('SELECT 1 FROM suppressions WHERE phone=?',p.phone))
   return cancel('CONTACT_NOT_ELIGIBLE');
  // Sequence gate: WhatsApp must confirm that the exact audio message was
  // sent before scheduling its video; a gateway HTTP 200 is not enough.
  const audioReceipt=pitchDeliveryReceipt(p.lead_id,p.greeting_id,'AUDIO');
  if(!audioReceipt||!['SENT','DELIVERED','READ'].includes(audioReceipt.status))
   return {state:'WAITING_AUDIO_CONFIRMATION',audioStatus:audioReceipt?.status||'MISSING'};
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
  if(!wa.connected){
   pitchFollowupCheckAfter.set(p.lead_id,at+30_000);
   return {state:'OFFLINE'};
  }
  if(one('SELECT manual_takeover FROM threads WHERE lead_id=?',p.lead_id)?.manual_takeover===1||
    introductionStatus(p.lead_id)?.stage!=='VOICE_SENT')return cancel('MANUAL_TAKEOVER');
  let video=null;
  try{
   video=await loadVideo();
   if(!Buffer.isBuffer(video?.bytes)||video.bytes.length<1024)throw Error('VIDEO_NOT_READY');
  }catch(error){return {state:'VIDEO_ASSET_UNAVAILABLE',reason:String(error?.message||error).slice(0,80)};}
  // Before the first video transport, inspect the sender's real WhatsApp
  // conversation. A previously sent campaign video is counted, never repeated.
  const fetchHistory=deps.fetchHistory||(!deps.status&&!deps.sendVideo?waRequest:null);
  if(fetchHistory){
   const proof=await preflightNewStep({sessionId:p.session_id,jid:p.phone+'@s.whatsapp.net',
    kind:'VIDEO',text:PITCH_PREVIEW_TEXT,at:new Date(at),fetchChat:fetchHistory});
   if(proof.state==='UNAVAILABLE'){
    // Do not repeatedly block every other customer's video while one
    // WhatsApp conversation has temporarily unreadable history.
    pitchFollowupCheckAfter.set(p.lead_id,at+25_000);
    return {state:'HISTORY_UNAVAILABLE'};
   }
   if(proof.state==='EXISTS'){
    const messageId=String(proof.message?.keyId||proof.message?.key?.id||'');
    const stamp=now();
    const changed=run("UPDATE prospecting_introductions SET followup_status='SENDING',followup_attempt_at=?,updated_at=? WHERE lead_id=? AND stage='VOICE_SENT' AND followup_status='WAITING' AND followup_due_at<=?",
     stamp,stamp,p.lead_id,atIso).changes;
    if(!changed)return {state:'BUSY'};
    beginPitchDelivery({leadId:p.lead_id,greetingId:p.greeting_id,kind:'VIDEO',sessionId:p.session_id,jid:p.phone+'@s.whatsapp.net'});
    acknowledgePitchDelivery({leadId:p.lead_id,greetingId:p.greeting_id,kind:'VIDEO',providerId:messageId});
    receivePitchDeliveryStatus({event:'message.status',sessionId:p.session_id,
     data:{keyId:messageId,remoteJid:p.phone+'@s.whatsapp.net',
      status:['SENT','DELIVERED','READ'].includes(String(proof.message.status||'').toUpperCase())?proof.message.status:'SENT'}});
    run("UPDATE prospecting_introductions SET followup_status='SENT',followup_sent_at=?,updated_at=? WHERE lead_id=? AND followup_status='SENDING'",
     stamp,stamp,p.lead_id);
    const thread=one('SELECT id FROM threads WHERE lead_id=?',p.lead_id);
    if(thread&&!one('SELECT id FROM messages WHERE provider_id=?','intro-video:'+p.greeting_id))
     addMessage({threadId:thread.id,providerId:'intro-video:'+p.greeting_id,
      direction:'out',type:'video',body:PITCH_PREVIEW_TEXT,status:'sent'});
    audit('PROSPECT_VIDEO_ALREADY_IN_WHATSAPP',p.lead_id,{messageId,avoidedDuplicate:true});
    await queueDeferredReply();
    return {state:'SENT',fromHistory:true,leadId:p.lead_id};
   }
   if(proof.state!=='CLEAR'){
    run("UPDATE prospecting_introductions SET followup_status='UNKNOWN',reason=?,updated_at=? WHERE lead_id=? AND stage='VOICE_SENT' AND followup_status='WAITING'",
     'Possible existing outbound video; manual review',now(),p.lead_id);
    queueNotice('preflight-video:'+p.greeting_id,'PITCH_DELIVERY_ISSUE',
     '*Prospector — vídeo possivelmente já enviado*\\nDestino: '+p.phone+
     '\\nConfira o WhatsApp antes de reenviar. Nenhuma cópia foi enviada automaticamente.\\nhttps://wa.me/'+p.phone,p.lead_id);
    return {state:'UNKNOWN',reason:'WHATSAPP_HISTORY_CONFLICT'};
   }
  }
  if(!run("UPDATE prospecting_introductions SET followup_status='SENDING',followup_attempt_at=?,updated_at=? WHERE lead_id=? AND stage='VOICE_SENT' AND followup_status='WAITING' AND followup_due_at<=?",
   atIso,now(),p.lead_id,atIso).changes)return {state:'BUSY'};
  try{
   if(ownerProspectionPaused()||getSetting('paused',true))throw Error('PAUSED_DURING_SEND');
   if(one('SELECT manual_takeover FROM threads WHERE lead_id=?',p.lead_id)?.manual_takeover===1||
      introductionStatus(p.lead_id)?.stage!=='VOICE_SENT')throw Error('MANUAL_TAKEOVER');
   beginPitchDelivery({leadId:p.lead_id,greetingId:p.greeting_id,kind:'VIDEO',sessionId:p.session_id,jid:p.phone+'@s.whatsapp.net'});
   const ack=await sendVideo({jid:p.phone+'@s.whatsapp.net',session:p.session_id,
    bytes:video.bytes,caption:PITCH_PREVIEW_TEXT});
   if(ack?.accepted!==true)throw Error('VIDEO_UNCONFIRMED');
   acknowledgePitchDelivery({leadId:p.lead_id,greetingId:p.greeting_id,kind:'VIDEO',providerId:ack.messageId});
   const stamp=now();
   run("UPDATE prospecting_introductions SET followup_status='SENT',followup_sent_at=?,updated_at=? WHERE lead_id=? AND followup_status='SENDING'",stamp,stamp,p.lead_id);
   const thread=one('SELECT id FROM threads WHERE lead_id=?',p.lead_id);
   if(thread)addMessage({threadId:thread.id,providerId:'intro-video:'+p.greeting_id,direction:'out',type:'video',body:PITCH_PREVIEW_TEXT,status:'sent'});
   audit('PROSPECT_PITCH_VIDEO_SENT',p.lead_id,{delaySeconds:10,session:p.session_id,gatewayAccepted:true});
   await queueDeferredReply();
   return {state:'SENT',leadId:p.lead_id};
  }catch(error){
   if(String(error?.message||'')==='MANUAL_TAKEOVER'){
    cancelPitchDelivery({leadId:p.lead_id,greetingId:p.greeting_id,kind:'VIDEO'});
    run("UPDATE prospecting_introductions SET followup_status='CANCELLED',reason='MANUAL_TAKEOVER',updated_at=? WHERE lead_id=? AND followup_status='SENDING'",now(),p.lead_id);
    return {state:'CANCELLED',reason:'MANUAL_TAKEOVER'};
   }
   unknownPitchDelivery({leadId:p.lead_id,greetingId:p.greeting_id,kind:'VIDEO',reason:String(error?.message||error)});
   run("UPDATE prospecting_introductions SET followup_status='UNKNOWN',reason='Follow-up delivery uncertain; manual review',updated_at=? WHERE lead_id=? AND followup_status='SENDING'",now(),p.lead_id);
   audit('PROSPECT_PITCH_PREVIEW_UNKNOWN',p.lead_id,{manualReview:true});
   return {state:'UNKNOWN',reason:String(error?.message||error).slice(0,80)};
  }
 }finally{pitchFollowupBusy=false;}
}
