// Prospector owner-only go-live readiness assessment.
// Reads current state and gateway GET routes. Never sends WhatsApp, creates
// opt-in evidence, changes a contact or unpauses the service.
import {all,getSetting} from './db.mjs';
import {documentedOptIn} from './outreach-queue.mjs';
import {recontactDecision} from './prospecting-recontact.mjs';
import {approvedOwnerRecordingStatus} from './owner-approved-pitch.mjs';
import {waSessionList,waRequest,selectedWaSession} from './waakg-control.mjs';
import {runFiveApprovedPreflight} from './five-approved-preflight.mjs';

const normalize=s=>String(s||'').trim();
const fmt=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function nextWindow(){
 const [y,m,d]=fmt().split('-').map(Number);
 return new Date(Date.UTC(y,m-1,d+1,11,0,0));
}
function consentAudit(at){
 const candidates=all("SELECT l.id,l.phone,l.stage,l.created_at,l.contact_permission, a.detail FROM leads l JOIN audit a ON a.rowid=(SELECT MAX(z.rowid) FROM audit z WHERE z.lead_id=l.id AND z.action='CONSENT_UPDATED') WHERE l.stage IN ('DISCOVERED','NO_INTEREST') AND l.phone IS NOT NULL AND l.contact_permission=1 AND l.source<>'WA_PAIR_QA' LIMIT 10000");
 let documented=0,quickAttestations=0,individualEvidence=0,legacyEvidence=0,unknownOrExpired=0,missingProof=0;
 const types={};
 for(const item of candidates){
  if(!recontactDecision(item,at.getTime()).eligible){unknownOrExpired++;continue;}
  let record={};try{record=JSON.parse(item.detail||'{}')}catch{}
  const method=normalize(record.method),type=normalize(record.evidenceType);
  types[method||'UNSPECIFIED']=(types[method||'UNSPECIFIED']||0)+1;
  if(!record.evidence)missingProof++;
  const quick=method==='manual_quick_approval'||type==='OPERATOR_ATTESTATION'||record.evidenceVerified===false;
  if(quick){quickAttestations++;continue;}
  if(documentedOptIn(item.id)){
   documented++;individualEvidence++;
  }else legacyEvidence++;
 }
 return {candidates:candidates.length,currentlyEligible:documented,
   individuallyDocumented:individualEvidence,quickOperatorAttestations:quickAttestations,
   legacyOrUnclassified:legacyEvidence,ineligibleOrExpired:unknownOrExpired,
   missingEvidence:missingProof,byMethod:types,
   sendableWithoutBulkAttestations:individualEvidence,
   evidenceAuditOnly:true,independentlyVerifiedByWhatsApp:false};
}
const safeGet=async(fn)=>{try{return await fn()}catch(error){return {error:String(error?.message||error).slice(0,110)}}};
export async function assessProspectorGoLive({at=nextWindow()}={}){
 if(process.env.PROSPECTOR_TENANT_ID)return {status:'OWNER_ONLY'};
 const raw=approvedOwnerRecordingStatus();
 const audio=raw.ready===true&&raw.sourceSha256===
  '9579652b25cf3c29aaff0c2972f2452bb847d00c697abdcfc9601f510c30a389'&&raw.bytes===154890;
 const sessions=await safeGet(()=>waSessionList());
 const connected=Array.isArray(sessions.items)?sessions.items.filter(x=>x.connected):[];
 const main=connected.find(x=>x.numberSuffix==='7336'&&x.sessionId===selectedWaSession());
 const other=connected.find(x=>x.numberSuffix==='2994');
 const key=normalize(process.env.PROSPECTOR_GROUP_IMPORT_JID);
 let groupReady=false,groupReason='NOT_CONFIGURED';
 if(main&&/^\d{8,24}(?:-\d{8,15})?@g\.us$/.test(key)){
  const result=await safeGet(()=>waRequest('/api/groups/'+encodeURIComponent(main.sessionId)+'/'+encodeURIComponent(key)));
  const value=result.data?.group||result.data||result;
  groupReady=value?.subject==='Meu Prospector'&&String(value?.jid||value?.id||'')===key;
  groupReason=groupReady?'VERIFIED':'GROUP_NOT_VERIFIED';
 }
 let webhookReady=false;
 if(main){
  const hooks=await safeGet(()=>waRequest('/api/webhooks/'+encodeURIComponent(main.sessionId)));
  webhookReady=Array.isArray(hooks.data)&&hooks.data.some(x=>x.isActive!==false&&
   String(x.url||'').includes('/api/wa-akg/webhook')&&
   Array.isArray(x.events)&&x.events.includes('message.received'));
 }
 const consent=consentAudit(at);
 const preflight=await safeGet(()=>runFiveApprovedPreflight({at}));
 const localSettings={
  pauseFlag:process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE==='true',
  dbPaused:getSetting('paused',true)===true,
  autonomousEnabled:getSetting('autonomous_outreach_enabled',false)===true,
  coldApproachEnabled:getSetting('cold_first_approach_enabled',false)===true,
  dailyLimit:Number(getSetting('daily_limit',0)),
  dailyRemaining:preflight.dailyRemaining||0,
  hours:getSetting('client_outreach_hours',null),
  initialInterval:Number(getSetting('initial_interval_seconds',0)),
 };
 const conditions={
  originalOwnerAudioReady:audio,
  main7336Connected:!!main,
  secondary2994Connected:!!other,
  notificationGroupVerified:groupReady,
  inboundWebhookConnected:webhookReady,
  dailyLimit80:localSettings.dailyLimit===80,
  window0800to1740:localSettings.hours?.start==='08:00'&&localSettings.hours?.end==='17:40',
  interval435s:localSettings.initialInterval===435,
  coldFirstApproachDisabled:localSettings.coldApproachEnabled===false,
  fiveAuthorizedDryRun:preflight.checks?.fiveRealApprovedRecipients===true&&
   preflight.checks?.authorized===true&&preflight.checks?.greetingReady===true&&
   preflight.checks?.cadenceValid===true,
  individualConsentEvidenceAvailable:consent.individuallyDocumented>=5
 };
 // Being intentionally paused is not an infrastructure failure.
 const report={kind:'PROSPECTOR_READ_ONLY_GO_LIVE_AUDIT',at:at.toISOString(),
   readiness:Object.values(conditions).every(Boolean)?'READY_FOR_AUTHORIZED_ACTIVATION':'BLOCKED',
   conditions,settings:localSettings,consent,
   connectedSenderSuffixes:connected.map(x=>x.numberSuffix||'UNKNOWN'),
   groupReason,webhookReady,preflightChecks:preflight.checks||null,
   realMessagesSent:0,contactsChanged:0,storageChanged:false,
   requireActualOptIn:true,
   notes:'Operator attestations without individual evidence are not independently verified opt-in.'};
 console.info('[prospector-go-live-audit]',JSON.stringify(report));
 return report;
}