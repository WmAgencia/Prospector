// Groq assistant for inbound 1:1 conversations only. Hot leads silently
// transfer to the operator; never sends an extra response on handoff.
import {db,one,all,run,id,tx,now,stage,addMessage,audit} from './db.mjs';
import {aiDraft} from './ai-groq.mjs';
import {getSetting} from './db.mjs';
import {conversationAuthorized,operatorOffer} from './operator-outreach.mjs';
import {requestPriceApproval,approvedPriceForLead} from './owner-price-approvals.mjs';
import {prospectSalesContext,priceQuestion,salesEnding} from './sales-policy.mjs';
import {detectAutomaticReply,isBaseOfferQuestion,isPortfolioFAQ,portfolioQuestion,proposalRequestWhileBusy,fixedOfferPitch,fixedOfferPriceReply,fixedOfferFollowup,safeGeneralReply} from './portfolio-offer-550.mjs';
import {introductionStatus} from './prospecting-introduction.mjs';
import {portfolioAudioSentFor,portfolioPitchAudioEnabled} from './portfolio-pitch-audio.mjs';
import {consecomPortfolioDialogue,offScriptPortfolioDraft,CONSECOM_SITE_PITCH_SAFE} from './consecom-portfolio-dialogue.mjs';
import {recordSalesOutcome} from './sales-outcomes.mjs';
import {explicitInterest,qualifyWithGroq} from './groq-interest-check.mjs';
import {queueNotice} from './notifications.mjs';
import {conversationFinished,finishConversation,isFinalGoodbye} from './prospect-terminal-conversation.mjs';
import {ownerPitchStatus} from './owner-pitch-sequence.mjs';
import {interestedAfterProposal} from './prospector-sales-signals.mjs';
import {testModeAllowed,reviewGroqReply} from './groq-live-test-guard.mjs';
import {classifyInbound,firstGreeting,personalPhone} from './personal-concierge.mjs';
import {analyzeChatTurn,compactChatHistory,refineChatReply} from './francisca-chat-coach.mjs';
import {classifyContact,prospectorChatEligible} from './whatsapp-roles.mjs';
import {makeFranciscaVoice} from './francisca-tts.mjs';
import {readActiveTrainingMarkdown} from './training.mjs';
import {configuredClosing} from './training-sales-extras.mjs';
import {paymentProposalForIncoming,reservePaymentProposal,paymentProposalSent,paymentDeliveryUnknown,paymentIntentStatus} from './sales-payment-flow.mjs';
import {sendVoiceMedia} from './waakg-media.mjs';
import {chooseReplyChannel,channelPreference,saveChannelPreference,reservePart,acceptPart,partsFor} from './groq-reply-channels.mjs';
import {waControlStatus,waRequest,selectedWaSession} from './waakg-control.mjs';
import {replyPacingEnabled,waitForReplyPacing} from './reply-pacing.mjs';
import {INBOUND_AUTOMATION_VERSION} from './inbound-automation.mjs';
import {isManagedSession,leadSession} from './waakg-session-registry.mjs';
db.exec("CREATE TABLE IF NOT EXISTS groq_auto_events(provider_id TEXT PRIMARY KEY,jid TEXT NOT NULL,state TEXT NOT NULL,at TEXT NOT NULL,error TEXT)");
run("UPDATE groq_auto_events SET state='UNKNOWN',error='Interrupted; verify before retry' WHERE state IN ('PROCESSING','SENDING')");
const digits=s=>String(s||'').replace(/\D/g,'');
const optedOut=s=>/\b(pare|parar|stop|sair|remover|nao me contate|não me contate|sem interesse|nao tenho interesse)\b/i.test(String(s||''));
export const ownerApprovedOriginalOffer350=pitch=>pitch?.stage==='DONE';
export function ownerTarget(){const configured=digits(getSetting('sales_notification_phone','')),normalized=configured.length===11?'55'+configured:configured;if(/^55\d{10,11}$/.test(normalized))return normalized;const preferred=personalPhone();if(preferred)return preferred;const raw=digits(process.env.PROSPECTOR_HOT_LEAD_PHONE);const val=raw.length===11?'55'+raw:raw;return /^55\d{10,11}$/.test(val)?val:null;}
export function interestNotice(lead,evidence){
 const business=one('SELECT * FROM leads WHERE id=?',lead.lead_id)||lead;
 const links=[];
 if(business.instagram){const ig=String(business.instagram);if(/^https:\/\/(?:www\.)?instagram\.com\//i.test(ig))links.push('Instagram: '+ig);else if(/^[a-z0-9._]+$/i.test(ig))links.push('Instagram: https://www.instagram.com/'+ig+'/');}
 if(/^https?:\/\//i.test(business.website||''))links.push('Site: '+business.website);
 for(const row of all("SELECT identity FROM lead_origins WHERE lead_id=? AND source='maps_extension'",lead.lead_id))if(/^https:\/\/(?:www\.google\.[a-z.]+\/maps\/|maps\.google\.[a-z.]+\/|maps\.app\.goo\.gl\/)/i.test(row.identity))links.push('Maps: '+row.identity);
 return ['⭐ Interesse real no Prospector','Empresa: '+business.business,'Contato: '+(business.name||'não informado'),'Telefone: '+business.phone,...links,'Assumir conversa: https://wa.me/'+business.phone,'Interesse: '+String(evidence||lead.body||'Intenção confirmada').slice(0,180),'Próximo passo: assumir atendimento e confirmar escopo.'].join('\n');
}
export function agentStatus(){return {enabled:process.env.AI_CONVERSATION_AUTOSEND==='true',inboundAssistantEnabled:process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED==='true',approvedProspectFollowup:getSetting('sales_followup_enabled',true)===true,alertOnlyEnabled:process.env.PROSPECTOR_INTEREST_ALERTS_ENABLED==='true',ownerConfigured:!!ownerTarget(),ownerLastFour:(ownerTarget()||'').slice(-4),inboundOnly:true,inboundAutomationVersion:INBOUND_AUTOMATION_VERSION,replyPacing:{enabled:replyPacingEnabled(),minSeconds:8,maxSeconds:35,typing:{enabled:replyPacingEnabled(),minSeconds:3,maxSeconds:5,scope:'prepared_customer_text_replies'}}};}
function approvedProspectFollowup(identity,jid){
 if(getSetting('sales_followup_enabled',true)!==true||identity.role!=='PROSPECT_APPROACHED')return false;
 const number=String(jid||'').split('@')[0];
 const lead=one("SELECT id FROM leads WHERE phone=?",number);
 return !!lead&&conversationAuthorized(lead.id);
}
export function queueInboundTurn({providerId,jid,sessionId}={}){
 if(!providerId||!/^\d{12,15}@s\.whatsapp\.net$/.test(jid||''))return false;
 const lead=one('SELECT id FROM leads WHERE phone=?',String(jid).split('@')[0]);
 const boundSession=sessionId||(lead?leadSession(lead.id):selectedWaSession());
 if(lead&&conversationFinished(lead.id,boundSession))return false;
 if(lead){
  const pitch=ownerPitchStatus(lead.id);
  if(pitch&&pitch.stage!=='DONE')return false;
 }
 if(!prospectorChatEligible({jid,sessionId:boundSession}))return false;
 const identity=classifyContact({jid,sessionId:boundSession});
 const intro=lead?introductionStatus(lead.id):null;
 if(intro&&intro.stage!=='CONVERSING'&&!conversationAuthorized(lead.id))return false;
 const allowed=approvedProspectFollowup(identity,jid);
 if(intro&&portfolioPitchAudioEnabled()&&
  (!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true')&&
  !portfolioAudioSentFor(intro)&&ownerPitchStatus(lead.id)?.stage!=='DONE')return false;
 if(!allowed&&process.env.AI_CONVERSATION_AUTOSEND!=='true'&&process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED!=='true'&&process.env.PROSPECTOR_INTEREST_ALERTS_ENABLED!=='true'&&!testModeAllowed(String(jid).split('@')[0]))return false;
 return run("INSERT OR IGNORE INTO groq_auto_events(provider_id,jid,state,at) VALUES(?,?,?,?)",providerId,jid,'PENDING',now()).changes>0;
}
const active=new Set();
export async function handleSalesTurn(providerId,deps={}){
 if(process.env.PROSPECTOR_TENANT_ID&&!readActiveTrainingMarkdown())return {state:'TRAINING_REVIEW_REQUIRED'};
 const r=one("SELECT e.*,i.body,i.state inbox_state,i.lead_id,i.session_id,l.business,l.segment,l.phone,l.stage,t.id thread_id,t.manual_takeover FROM groq_auto_events e JOIN waakg_inbox i ON i.provider_id=e.provider_id JOIN leads l ON l.id=i.lead_id JOIN threads t ON t.lead_id=l.id WHERE e.provider_id=? AND e.state='PENDING'",providerId);
 if(!r)return {state:'SKIP'};
 if(conversationFinished(r.lead_id,r.session_id)){
  run("UPDATE groq_auto_events SET state='CLOSED',error='CONVERSATION_FINISHED' WHERE provider_id=?",providerId);
  return {state:'CLOSED'};
 }
 const pendingPitch=ownerPitchStatus(r.lead_id);
 if(pendingPitch&&pendingPitch.stage!=='DONE'){
  run("UPDATE groq_auto_events SET state='REVIEW',error='OWNER_ORIGINAL_AUDIO_WORKFLOW' WHERE provider_id=?",providerId);
  return {state:'REVIEW'};
 }
 if(one("SELECT 1 FROM prospecting_introductions WHERE lead_id=? AND stage='VOICE_REVIEW'",r.lead_id)){
  run("UPDATE groq_auto_events SET state='REVIEW',error='OWNER_AUDIO_FILE_NOT_APPROVED' WHERE provider_id=?",providerId);
  return {state:'REVIEW'};
 }
 const replyStartedAt=(deps.replyNow||Date.now)();
 const finish=(status,error='')=>{run('UPDATE groq_auto_events SET state=?,error=? WHERE provider_id=?',status,error,providerId);return {state:status};};
 const identity=classifyContact({jid:r.jid,sessionId:r.session_id});
 const allowTest=false; // Personal, owner and sandbox messages never join automated sales replies.
 const salesFollowup=approvedProspectFollowup(identity,r.jid);
 const portfolioAllowed=(!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true')&&salesFollowup&&operatorOffer(r.lead_id)==='portfolio';
 const intro=introductionStatus(r.lead_id);
 // A completed owner-approved ORIGINAL voice note quotes R$ 350, regardless
 // of the disabled old pitch-audio flag. Treat that real recorded offer as the
 // campaign's price anchor; NEVER respond with the separate R$ 550 offer.
 const originalOwnerAudio350=ownerApprovedOriginalOffer350(pendingPitch);
 const audioOffer350=originalOwnerAudio350||portfolioAudioSentFor(intro);
 // A Consecom introduction is the campaign ID, independent of whether an
 // older batch selection remains in 'SENT' after its queue progresses.
 const campaign350=(!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true')&&
  !!intro&&(originalOwnerAudio350||portfolioPitchAudioEnabled())&&identity.role==='PROSPECT_APPROACHED';
 if(intro&&intro.stage!=='CONVERSING'&&!conversationAuthorized(r.lead_id))return finish('SKIPPED','INTRO_NOT_COMPLETE');
 if(campaign350&&!audioOffer350)return finish('REVIEW','CAMPAIGN_AUDIO_FIRST_REQUIRED');
 if(!prospectorChatEligible({jid:r.jid,sessionId:r.session_id}))return finish('SKIPPED','NOT_PROSPECTOR_APPROACHED');
 if(identity.role==='OWNER'&&!allowTest)return finish('HANDOFF','OWNER_PRIVILEGED_CHANNEL');
 if(!salesFollowup&&process.env.AI_CONVERSATION_AUTOSEND!=='true'&&process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED!=='true'&&process.env.PROSPECTOR_INTEREST_ALERTS_ENABLED!=='true'&&!allowTest)return finish('DISABLED');
 if(!isManagedSession(r.session_id)||leadSession(r.lead_id)!==r.session_id)return finish('SKIPPED','SESSION');
 if(!allowTest&&(r.phone===ownerTarget()||r.phone===digits(process.env.GROQ_OWNER_WHATSAPP)||r.phone===personalPhone()))return finish('SKIPPED','OWNER');
 if(optedOut(r.body)||['OPT_OUT','NO_INTEREST'].includes(salesEnding(r.body))||one('SELECT phone FROM suppressions WHERE phone=?',r.phone))return finish('SKIPPED','OPTOUT_OR_REFUSAL');
 if(detectAutomaticReply(r.body))return finish('SKIPPED','AUTOMATIC_RESPONSE');
 const closer=configuredClosing();
 if(closer?.mode==='complete'&&!audioOffer350){
  if(['AWAITING_RECEIPT','RECEIPT_RECEIVED','PAYMENT_VERIFIED'].includes(paymentIntentStatus(r.lead_id)?.status))
   return finish('SKIPPED','PAYMENT_ALREADY_IN_PROGRESS');
  const plan=paymentProposalForIncoming({leadId:r.lead_id,jid:r.jid,sessionId:r.session_id,providerId,text:r.body});
  if(plan.eligible){
   if(r.manual_takeover||r.inbox_state!=='REVIEW'||one('SELECT phone FROM suppressions WHERE phone=?',r.phone))return finish('HANDOFF','NO_PERMISSION');
   const live=deps.status?await deps.status(r.session_id):await waControlStatus(r.session_id);
   if(!live.connected)return finish('REVIEW','WA_OFFLINE');
   if(!reservePaymentProposal(plan))return finish('SKIPPED','PAYMENT_DUPLICATE');
   try{
    const ack=await (deps.send||waRequest)('/api/messages/'+encodeURIComponent(r.session_id)+'/'+encodeURIComponent(r.jid)+'/send',{method:'POST',data:{message:{text:plan.offer.text}}});
    if(ack?.status!==true){paymentDeliveryUnknown(plan);return finish('UNKNOWN','PIX_SEND_NOT_CONFIRMED');}
    paymentProposalSent(plan,r.thread_id);
    return finish('SENT');
   }catch(error){paymentDeliveryUnknown(plan);return finish('UNKNOWN','PIX_SEND_UNCERTAIN');}
  }
 }

 if(identity.role!=='EXISTING_CLIENT'&&['INTERESTED','NO_INTEREST','CLOSED_WON'].includes(r.stage))return finish('SKIPPED','ALREADY_HANDOFF');
 const stale=()=>{
  if(conversationFinished(r.lead_id,r.session_id))return 'CLOSED';
  const current=one('SELECT l.stage,l.phone,t.manual_takeover,i.state inbox_state,i.body FROM leads l JOIN threads t ON t.lead_id=l.id JOIN waakg_inbox i ON i.provider_id=? WHERE l.id=?',providerId,r.lead_id);
  if(!current||current.manual_takeover||current.inbox_state!=='REVIEW'||current.stage!==r.stage||current.phone!==r.phone||current.body!==r.body||leadSession(r.lead_id)!==r.session_id||!isManagedSession(r.session_id)||one('SELECT phone FROM suppressions WHERE phone=?',r.phone))return 'HANDOFF';
  if(!prospectorChatEligible({jid:r.jid,sessionId:r.session_id}))return 'HANDOFF';
  const currentIntro=introductionStatus(r.lead_id);
  if((currentIntro&&currentIntro.stage!=='CONVERSING'&&!conversationAuthorized(r.lead_id))||(salesFollowup&&!approvedProspectFollowup(identity,r.jid)))return 'HANDOFF';
  if(one('SELECT provider_id FROM waakg_inbox WHERE jid=? ORDER BY rowid DESC LIMIT 1',r.jid)?.provider_id!==providerId)return 'SUPERSEDED';
  return '';
 };
 if(stale())return finish(stale());
 run("UPDATE groq_auto_events SET state='PROCESSING' WHERE provider_id=?",providerId);
 const recentTurns=all("SELECT direction,body,at FROM messages WHERE thread_id=? ORDER BY at DESC,rowid DESC LIMIT 22",r.thread_id).reverse();
 const offerAlreadyExplained=recentTurns.some(m=>m.direction==='out'&&/R\$\s*550/i.test(String(m.body||'')));
 const history=recentTurns.slice(-8).map(m=>(m.direction==='in'?'Cliente: ':'Consecom: ')+String(m.body||'').slice(0,220)).join('\n');
 // A chat is a continuous exchange. Read the real server-side thread rather
 // than asking the model to infer whether it has greeted the contact before.
 const hasOutbound=!!one("SELECT 1 FROM messages WHERE thread_id=? AND direction='out' LIMIT 1",r.thread_id);
 const dialogue=analyzeChatTurn({text:r.body,history:recentTurns,role:identity.role});
 dialogue.hasAssistantReply=hasOutbound;
 dialogue.isFirstContact=!hasOutbound;
 const buyerCommitment=identity.role==='PROSPECT_APPROACHED'&&explicitInterest(r.body);
 if(audioOffer350&&interestedAfterProposal(r.body)){
  run('UPDATE threads SET manual_takeover=1 WHERE id=?',r.thread_id);
  stage(r.lead_id,'INTERESTED','PITCH_AUDIO_350_INTEREST');
  recordSalesOutcome({leadId:r.lead_id,status:'INTERESTED',providerId,evidence:r.body,notify:false});
  queueNotice('pitch-audio350:'+r.lead_id,'GROQ_HOT_LEAD',
   interestNotice(r,'Cliente demonstrou interesse na oferta de R$ 350 enviada por áudio; revisar escopo e pagamento.'),r.lead_id);
  return finish('HOT','AUDIO_350_CLOSING_TO_OWNER');
 }
 // Never improvise a new written offer after a verified original owner audio.
 if(audioOffer350)return finish('REVIEW','OWNER_AUDIO_OFFER_AWAITING_OPERATOR');
 const audioPriceQuestion=campaign350&&/(?:quanto|pre[cç]o|valor|custa|r\$ ?350)/i.test(r.body)&&
  !/(?:parcel|pix|cart[aã]o|entrada|pagamento)/i.test(r.body);
 const fixedOffer=portfolioAllowed&&!campaign350&&!audioOffer350&&!buyerCommitment&&(isBaseOfferQuestion(r.body)||isPortfolioFAQ(r.body));
 const financial=priceQuestion(r.body)&&!fixedOffer&&!audioPriceQuestion&&!buyerCommitment&&!['EXISTING_CLIENT','OWNER'].includes(identity.role);
 const approval=financial?(deps.requestPriceApproval||requestPriceApproval)({leadId:r.lead_id,providerId,question:r.body,sessionId:r.session_id}):null;
 if(financial&&!approval?.ok)return finish('REVIEW','PRICE_APPROVAL_UNAVAILABLE');
 const qualify=deps.qualify||qualifyWithGroq;
 // Existing customers and owner QA NEVER become sales opportunities from
 // their ordinary WhatsApp messages, regardless of how they phrase a request.
 const interest=financial||['EXISTING_CLIENT','OWNER'].includes(identity.role)?
  {confirmed:false,reason:'NOT_A_SALES_PROSPECT'}:await qualify({text:r.body,history});
 if(stale())return finish(stale());
 if(interest.confirmed&&closer?.mode!=='complete'){
  tx(()=>{
   if(one('SELECT manual_takeover FROM threads WHERE id=?',r.thread_id)?.manual_takeover!==1){
    stage(r.lead_id,'INTERESTED','GROQ_REAL_INTEREST');
    recordSalesOutcome({leadId:r.lead_id,status:'INTERESTED',providerId,evidence:interest.evidence||r.body,notify:false});
    run('UPDATE threads SET manual_takeover=1 WHERE id=?',r.thread_id);
    queueNotice('groq-hot:'+r.lead_id,'GROQ_HOT_LEAD',
     interestNotice(r,interest.evidence),r.lead_id);
    audit('GROQ_INTEREST_ALERT_QUEUED',r.lead_id,{model:'groq',confidence:interest.confidence});
   }
  });
  return finish('HOT');
 }
 // An apparent commitment which the model cannot verify is left for review.
 if(closer?.mode!=='complete'&&!financial&&identity.role!=='EXISTING_CLIENT'&&identity.role!=='OWNER'&&explicitInterest(r.body)){
  if(salesFollowup){
   run('UPDATE threads SET manual_takeover=1 WHERE id=?',r.thread_id);
   recordSalesOutcome({leadId:r.lead_id,status:'HUMAN_REVIEW',providerId,evidence:'Intenção comercial precisa de confirmação: '+r.body});
  }
  return finish('REVIEW','UNCERTAIN_INTEREST');
 }
 if(!salesFollowup&&process.env.AI_CONVERSATION_AUTOSEND!=='true'&&process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED!=='true'&&!allowTest)return finish('REVIEW','AI_AUTOREPLY_DISABLED');
 if(r.inbox_state!=='REVIEW'||r.manual_takeover)return finish('HANDOFF');
 if(one("SELECT provider_id FROM waakg_inbox WHERE jid=? ORDER BY rowid DESC LIMIT 1",r.jid)?.provider_id!==providerId)return finish('SUPERSEDED');
 const wa=deps.status?await deps.status(r.session_id):await waControlStatus(r.session_id),session=r.session_id;
 if(stale())return finish(stale());
 if(!wa.connected||!session)return finish('REVIEW','WA_OFFLINE');
 const incoming=classifyInbound(r.body);
 if(incoming.human){
  if(salesFollowup){
   run('UPDATE threads SET manual_takeover=1 WHERE id=?',r.thread_id);
   recordSalesOutcome({leadId:r.lead_id,status:'HUMAN_REVIEW',providerId,evidence:r.body});
  }
  return finish('HANDOFF','REQUESTED_HUMAN');
 }
 // The Consecom site campaign has a defined objective; do not ask buyers what
 // they want from an agency or drift into unrelated automation services.
 const scripted=campaign350?consecomPortfolioDialogue({text:r.body,voiceAlreadySent:audioOffer350}):null;
 const draft=audioPriceQuestion?{ok:true,
  draft:audioOffer350?'A proposta especial que te enviei em áudio fica em R$ 350 para esse site de portfólio. Antes de começar, a gente alinha direitinho o escopo e o pagamento. Faz sentido pra vocês?':'Nesta campanha, a proposta é um site profissional por R$ 350, em condição especial pra entrar no portfólio da Consecom. Posso enviar a apresentação em áudio ou explicar por aqui.',
  model:'APPROVED_CAMPAIGN_350'}:scripted?{ok:true,draft:scripted.text,model:'CONSECOM_SITE_SCRIPT'}:fixedOffer?{ok:true,draft:(offerAlreadyExplained||isPortfolioFAQ(r.body))?fixedOfferFollowup(r.body):portfolioQuestion(r.body)&&!/\b(?:quanto|preco|valor|custa|r\$)/i.test(r.body)?fixedOfferPitch({business:r.business,segment:r.segment}):fixedOfferPriceReply(),model:'APPROVED_PORTFOLIO_550'}:financial?{ok:true,draft:'Vou confirmar a proposta para o seu negócio com o responsável e já te retorno por aqui.',model:'OWNER_PRICE_APPROVAL'}:incoming.intro&&!salesFollowup&&!hasOutbound?{ok:true,draft:firstGreeting(),model:'RULE_BASED_GREETING'}:
   await (deps.draft||aiDraft)({text:r.body,audience:identity.role,dialogueState:dialogue,context:compactChatHistory(recentTurns)+'\n'+
     '\nEste é um contato recebido via WhatsApp. Você não possui permissões administrativas. '+
     (audioOffer350?'Este contato recebeu o áudio ORIGINAL da proposta de portfólio por R$ 350. A condição desse áudio substitui a oferta padrão de R$ 550 SOMENTE nesta conversa. Nunca informe R$ 550, nunca invente desconto ou outro prazo, nem ofereça PIX/entrada não aprovados. Se o contato quiser contratar, encaminhe para o Wesley confirmar escopo e pagamento. ':'')+
     (campaign350?'A oferta já é definida: site profissional em campanha especial por R$ 350 para compor o portfólio da Consecom. Não pergunte ao cliente de que serviço precisa, como quer melhorar presença online, qual automação busca ou como podemos ajudar; explique a oferta, respeite recusas e a disponibilidade do responsável. ':'Se não estiver claro, pergunte o que a pessoa precisa. ')+
     'Não afirme ser humano. Não invente disponibilidade, preço ou serviços.\n'+
     (!process.env.PROSPECTOR_TENANT_ID&&salesFollowup&&!campaign350?prospectSalesContext({...r,offerType:operatorOffer(r.lead_id)}):'')+'\n'+(portfolioAllowed&&!campaign350?'Existe uma oferta BASE aprovada para portfólio: R$ 550 com domínio por um ano e prazo de até 3 dias após materiais/escopo. Não invente extras nem desconto de 90%; consulte o operador para parcelamento ou outra modalidade.':approvedPriceForLead(r.lead_id)?'Uma proposta já foi aprovada e enviada nesta conversa. Não repita valores nem altere condições; dúvidas financeiras voltam ao operador.':'Nenhuma proposta aprovada. Não forneça preço, prazo ou pagamento.')});
 if(stale())return finish(stale());
 if(!draft.ok&&draft.code==='RATE_LIMITED'){
  run("UPDATE groq_auto_events SET state='PENDING',at=?,error='GROQ_RATE_LIMITED' WHERE provider_id=? AND state='PROCESSING'",new Date(Date.now()+90000).toISOString(),providerId);
  return {state:'DEFERRED',retryAfterSeconds:90};
 }
 if(!draft.ok||!draft.draft){
  if(salesFollowup)recordSalesOutcome({leadId:r.lead_id,status:'HUMAN_REVIEW',providerId,evidence:'A resposta automática não ficou disponível; conferir conversa.'});
  return finish('REVIEW','GROQ_UNAVAILABLE');
 }
 if(fixedOffer&&proposalRequestWhileBusy(r.body))draft.draft=fixedOfferPitch({business:r.business,segment:r.segment},new Date(),{busy:true});
 if(campaign350&&!scripted&&offScriptPortfolioDraft(draft.draft)){audit('FRANCISCA_CAMPAIGN_SCRIPT_CORRECTED',r.lead_id,{campaign:'PORTFOLIO_350'});draft.draft=CONSECOM_SITE_PITCH_SAFE;}
 let replyText=refineChatReply(draft.draft,{state:dialogue,incoming:r.body});
 if(!replyText){
  audit('FRANCISCA_REPETITION_SUPPRESSED',r.lead_id,{reason:'REPEATED_OR_GREETING_ONLY',chatTurns:dialogue.turnCount});
  return finish('REVIEW','REPEATED_OR_EMPTY_REPLY');
 }
 // Only a server-authored fixed portfolio template bypasses the generic price filter.
 let review=(fixedOffer||audioPriceQuestion||scripted)?{ok:true,code:campaign350?'APPROVED_CAMPAIGN_350':'OPERATOR_APPROVED_FIXED_OFFER'}:reviewGroqReply({inbound:r.body,draft:replyText,allowAveragePrice:false});
 // If the model invented commercial terms or claimed an unperformed action,
 // replace it with deterministic, operator-safe information rather than falling silent.
 if(!review.ok&&portfolioAllowed&&['UNVERIFIED_PRICE','UNAPPROVED_TERMS','UNVERIFIED_ACTION'].includes(review.code)){
  const fallback=safeGeneralReply(r.body,{business:r.business,segment:r.segment});
  const verified=reviewGroqReply({inbound:r.body,draft:fallback,allowAveragePrice:false});
  if(verified.ok){audit('FRANCISCA_SAFE_FALLBACK',r.lead_id,{rejected:review.code});replyText=fallback;review=verified;}
 }
 if(!review.ok){
  audit('GROQ_REPLY_REJECTED',r.lead_id,{code:review.code,test:allowTest});
  if(salesFollowup)recordSalesOutcome({leadId:r.lead_id,status:'HUMAN_REVIEW',providerId,evidence:'Resposta bloqueada para revisão: '+review.code});
  return finish('REVIEW','SAFETY_'+review.code);
 }
 if(one('SELECT manual_takeover FROM threads WHERE id=?',r.thread_id)?.manual_takeover===1||one('SELECT phone FROM suppressions WHERE phone=?',r.phone))return finish('HANDOFF');
 if(one("SELECT provider_id FROM waakg_inbox WHERE jid=? ORDER BY rowid DESC LIMIT 1",r.jid)?.provider_id!==providerId)return finish('SUPERSEDED');
 const audioTable=!!one("SELECT name FROM sqlite_master WHERE type='table' AND name='inbound_audio_jobs'");
 const wasAudio=audioTable&&!!one("SELECT provider_id FROM inbound_audio_jobs WHERE provider_id=? AND state='DONE'",providerId);
 const routing=chooseReplyChannel({inbound:r.body,draft:replyText,wasAudio,isOperatorTest:allowTest,
  preferredMode:channelPreference(r.jid),
  // Consecom owner uses ONLY the explicitly uploaded Wesley recording;
  // synthesised Francisca responses are unavailable regardless of flag state.
  voiceAvailable:!!process.env.PROSPECTOR_TENANT_ID&&process.env.AUDIO_RESPONSE_ENABLED==='true'&&process.env.FRANCISCA_TTS_ENABLED==='true'});
 if(routing.preference)saveChannelPreference(r.jid,routing.preference);
 // Synthesise before any transport attempt. For temporary TTS failure, retain a
 // complete written response instead of leaving the contact without a reply.
 let voiceBytes=null;
 if(routing.voice){
  try{const speech=await (deps.voice||makeFranciscaVoice)(replyText);voiceBytes=speech.bytes;
   if(!Buffer.isBuffer(voiceBytes)||voiceBytes.length<256)throw Error('INVALID_VOICE');
  }catch(e){
   audit('GROQ_VOICE_FALLBACK',r.lead_id,{reason:'SYNTHESIS_FAILED',channel:routing.mode,test:allowTest});
   routing.mode='TEXT';routing.text=true;routing.voice=false;
  }
 }
 // Recheck takeover and newer inbound after potentially slow TTS generation.
 if(one('SELECT manual_takeover FROM threads WHERE id=?',r.thread_id)?.manual_takeover===1||
    one('SELECT phone FROM suppressions WHERE phone=?',r.phone))return finish('HANDOFF');
 if(one("SELECT provider_id FROM waakg_inbox WHERE jid=? ORDER BY rowid DESC LIMIT 1",r.jid)?.provider_id!==providerId)return finish('SUPERSEDED');
 if(stale())return finish(stale());
 let typingStarted=false;
 const presence=deps.presence||waRequest;
 const presencePath='/api/chat/'+encodeURIComponent(session)+'/'+encodeURIComponent(r.jid)+'/presence';
 try{
 const current=await waitForReplyPacing({incoming:r.body,reply:replyText,startedAt:replyStartedAt,stillCurrent:()=>!stale()},
  {wait:deps.replyPause,now:deps.replyNow,jitter:deps.replyJitter,preparingMs:deps.preparingMs,
   onPreparing:routing.text?async()=>{typingStarted=true;try{await presence(presencePath,{method:'POST',data:{presence:'composing'}});}catch{audit('REPLY_PRESENCE_UNAVAILABLE',r.lead_id,{stage:'PREPARING'});}}:undefined});
 if(!current||stale())return finish(stale()||'SUPERSEDED');
 run("UPDATE groq_auto_events SET state='SENDING' WHERE provider_id=?",providerId);
 const accepted=[];
 const mark=(part)=>{acceptPart(providerId,part);accepted.push(part);
  // Record acknowledged delivery before a later transport can fail.
  addMessage({threadId:r.thread_id,providerId:'groq:'+providerId,direction:'out',body:(part==='VOICE'&&!accepted.includes('TEXT')?'[Áudio Francisca] ':'')+replyText,status:'sent'});
 };
 try{
  if(routing.text){
   if(!reservePart(providerId,'TEXT'))return finish('UNKNOWN','DUPLICATE_TEXT_ATTEMPT');
   const ack=await (deps.send||waRequest)('/api/messages/'+encodeURIComponent(session)+'/'+encodeURIComponent(r.jid)+'/send',
    {method:'POST',data:{message:{text:replyText}}});
   if(ack.status!==true)return finish('UNKNOWN','TEXT_UNCONFIRMED');
   mark('TEXT');
  }
  if(routing.voice){
   if(stale())return finish(accepted.length?'PARTIAL':stale(),'STATE_CHANGED');
   if(!reservePart(providerId,'VOICE'))return finish(accepted.length?'PARTIAL':'UNKNOWN','DUPLICATE_VOICE_ATTEMPT');
   const ack=await (deps.sendVoice||sendVoiceMedia)({jid:r.jid,session,bytes:voiceBytes});
   if(ack?.accepted!==true)return finish(accepted.length?'PARTIAL':'UNKNOWN','VOICE_UNCONFIRMED');
   mark('VOICE');
  }
  const prefix=routing.mode==='VOICE'?'[Áudio Francisca] ':
    routing.mode==='BOTH'?'[Texto + áudio Francisca] ':'';
  run('UPDATE messages SET body=? WHERE provider_id=?',prefix+replyText,'groq:'+providerId);
  if(accepted.includes('TEXT')&&isFinalGoodbye(replyText))
   finishConversation({leadId:r.lead_id,sessionId:r.session_id,providerId:'groq:'+providerId,body:replyText});
  if(scripted?.notifyOwner)queueNotice('portfolio-return:'+providerId,'GROQ_HOT_LEAD',
   ['Pedido de retorno — não é uma venda confirmada',
    'Empresa: '+r.business,'Telefone: '+r.phone,
    'Pedido do contato: '+String(r.body).slice(0,240),
    'Próximo passo: Wesley confirmar data e horário antes de novo contato.'].join('\n'),r.lead_id);
  audit('GROQ_AUTOMATED_INBOUND_REPLY',r.lead_id,{inbound:true,testOnly:allowTest,
    replyLength:replyText.length,deliveryMode:routing.mode,channelReason:routing.reason,contactRole:identity.role,parts:accepted});
  return finish('SENT');
 }catch(e){
  // If the written part was accepted but a voice send fails, NEVER send it again.
  const result=accepted.length?'PARTIAL':'UNKNOWN';
  audit('GROQ_REPLY_DELIVERY_UNCERTAIN',r.lead_id,{deliveryMode:routing.mode,
    partsAccepted:accepted,partsLedger:partsFor(providerId),result});
  return finish(result,'TRANSPORT_UNCERTAIN');
 }
 }finally{
  if(typingStarted)try{await presence(presencePath,{method:'POST',data:{presence:'paused'}});}catch{}
 }
}
let workerBusy=false;
export async function tickSalesAgent(deps={}){
 if(workerBusy)return {status:'BUSY'};
 workerBusy=true;
 try{
  const queue=all("SELECT provider_id,jid FROM groq_auto_events WHERE state='PENDING' AND at<=? ORDER BY at LIMIT 12",now());
  const candidates=queue.filter(x=>!active.has(x.jid)).slice(0,4);
  for(const row of candidates)active.add(row.jid);
  const outcomes=await Promise.all(candidates.map(x=>handleSalesTurn(x.provider_id,deps).catch(()=>({state:'ERROR'})).finally(()=>active.delete(x.jid))));
  return {status:'OK',processed:outcomes.length,states:outcomes.map(x=>x.state)};
 }finally{workerBusy=false;}
}
let notifying=false;
export async function flushInterestAlerts(deps={}){
 const target=ownerTarget();if(notifying||!one("SELECT id FROM owner_notices WHERE kind IN ('GROQ_HOT_LEAD','SALES_OUTCOME','DAILY_REPORT','PAYMENT_RECEIPT') AND status='PENDING' LIMIT 1"))return 0;
 notifying=true;
 try{
  const wa=deps.status?await deps.status():await waControlStatus(),session=selectedWaSession()||wa.sessionId;
  if(!wa.connected||!session)return 0;
  let delivered=0;
  for(const entry of all("SELECT * FROM owner_notices WHERE kind IN ('GROQ_HOT_LEAD','SALES_OUTCOME','DAILY_REPORT','PAYMENT_RECEIPT') AND status='PENDING' ORDER BY created_at LIMIT 5")){
   const toGroup=entry.kind==='GROQ_HOT_LEAD';
   const group=String(process.env.PROSPECTOR_GROUP_IMPORT_JID||'').trim();
   if(toGroup){
    if(!/^\d{8,24}(?:-\d{8,15})?@g\.us$/.test(group))continue;
    if(one('SELECT stage FROM leads WHERE id=?',entry.lead_id)?.stage!=='INTERESTED')continue;
    try{
     const reply=await (deps.groupInfo||waRequest)('/api/groups/'+encodeURIComponent(session)+'/'+encodeURIComponent(group));
     const info=reply?.data?.group||reply?.data||reply;
     if(info?.subject!=='Meu Prospector'||String(info?.jid||info?.id||'')!==group)continue;
    }catch{continue;}
   }else if(!target)continue;
   if(!run("UPDATE owner_notices SET status='SENDING',updated_at=? WHERE id=? AND status='PENDING'",now(),entry.id).changes)continue;
   try{
    const send=deps.send||waRequest;
    const to=toGroup?group:target+'@s.whatsapp.net';
    const ack=await send('/api/messages/'+encodeURIComponent(session)+'/'+encodeURIComponent(to)+'/send',{method:'POST',data:{message:{text:entry.message}}});
    if(ack.status!==true)throw Error('UNCONFIRMED');
    run("UPDATE owner_notices SET status='SENT',updated_at=? WHERE id=?",now(),entry.id);
    audit('GROQ_HOT_LEAD_ALERT_SENT',entry.lead_id,{owner:true,group:toGroup});delivered++;
   }catch{run("UPDATE owner_notices SET status='UNKNOWN',updated_at=?,error=? WHERE id=?",now(),'Unknown delivery, do not automatically retry',entry.id);}
  }
  return delivered;
 }finally{notifying=false;}
}
