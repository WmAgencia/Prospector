// This one-shot script runs in the verified demo tenant's own data directory.
// It uses the same profile approval endpoint as the user interface, never the
// Consecom owner profile, and performs no WhatsApp transport operation.
import crypto from 'node:crypto';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {getSetting,setSetting,now,one} from './db.mjs';
import {readActiveTrainingMarkdown,handleTraining,trainingStatus,trainingPrompt} from './training.mjs';
import {configuredClosing,saveSalesClosingConfig} from './training-sales-extras.mjs';
import {TW_DEMO_REPLY_GUARD_KEY,twDemoReplyAllowed} from './tw-demo-reply-guard.mjs';

const trainingText=fs.readFileSync(fileURLToPath(new URL('./demo-profiles/twco-premium-demo.md',import.meta.url)),'utf8').trim();
const banned=/R\$\s*(?:350|550)(?:\b|,|\.)/;
function check(value,message){if(!value)throw Error('TW_DEMO_SAFETY_'+message);}
export async function approveTwDemoTraining({
  tenantId=process.env.PROSPECTOR_TENANT_ID,
  tenantName=process.env.PROSPECTOR_TENANT_NAME,
  sessionId=process.env.TW_DEMO_OWNED_SESSION_ID,
  senderJid=process.env.TW_DEMO_VERIFIED_SENDER_JID,
  mode=process.env.TW_DEMO_TRAINING_MODE
}={}){
 if(mode!=='APPROVE'&&mode!=='CHECK')return {status:'NOT_ENABLED'};
 check(process.env.PROSPECTOR_TENANT_INTERNAL==='false','EXTERNAL_ONLY');
 check(/^[0-9a-f-]{36}$/i.test(String(tenantId||'')),'TENANT_ID');
 check(/^Ag[eê]ncia Exemplo.*Demonstra[cç][aã]o$/i.test(String(tenantName||'').trim()),'DEMO_CLIENT_ONLY');
 check(/^prospector-[0-9a-f-]{36}$/i.test(String(sessionId||'')),'DEMO_SESSION_ONLY');
 check(/^55\d{10,11}@s\.whatsapp\.net$/.test(String(senderJid||''))&&senderJid.endsWith('7336@s.whatsapp.net'),'VERIFIED_TEST_SENDER');
 check(one('SELECT 1 FROM managed_whatsapp_sessions WHERE session_id=?',sessionId),'SESSION_NOT_OWNED');
 check(trainingText.length>=800&&trainingText.length<=9000,'MANUAL_LIMIT');
 check(!banned.test(trainingText),'OWNER_OFFER_IN_TW_MANUAL');
 if(mode==='CHECK'){
  const active=readActiveTrainingMarkdown();
  const guard=twDemoReplyAllowed({jid:senderJid,sessionId});
  const closed=configuredClosing();
  return {status:active?.includes('TW & CO Premium')?'VERIFIED':'NOT_TRAINED',
   trainingActive:!!active,trainingBytes:active?.length||0,
   guardAllowsTestSender:guard.allowed,
   restricted:guard.restricted===true,
   handoffOnly:closed?.mode==='handoff',
   firstApproachEnabled:getSetting('autonomous_outreach_enabled',false)===true};
 }
 const active=readActiveTrainingMarkdown();
 if(active)return {status:'ALREADY_TRAINED_NO_OVERWRITE',trainingActive:true};
 if(getSetting('training_active',null)||getSetting('training_draft',null))
  return {status:'EXISTING_TRAINING_OR_DRAFT_NO_OVERWRITE'};
 // Apply permanent reply restriction BEFORE activating the AI.
 setSetting(TW_DEMO_REPLY_GUARD_KEY,{
  enabled:true,sessionId,senderJid,kind:'OWNER_AUTHORIZED_WHATSAPP_TEST',createdAt:now()
 });
 check(twDemoReplyAllowed({jid:senderJid,sessionId}).allowed,'ALLOWED_TESTER_GUARD');
 check(!twDemoReplyAllowed({jid:'5511999990000@s.whatsapp.net',sessionId}).allowed,'OUTSIDER_BLOCKED');
 // Prevent first-contact marketing; reception-only simulation.
 setSetting('paused',true);
 setSetting('autonomous_outreach_enabled',false);
 setSetting('cold_first_approach_enabled',false);
 setSetting('auto_initial',false);
 const id=crypto.randomUUID();
 setSetting('training_draft',{id,source:'manual',text:trainingText,at:now()});
 let result;
 await handleTraining({method:'POST'},null,new URL('http://local/api/training/approve'),{
  json:async()=>({id,text:trainingText}),
  respond:(_res,status,body)=>{result={status,body}}
 });
 check(result?.status===200,'APPROVAL_REJECTED');
 // Configure only the demo tenant's business metadata and handoff policy.
 let business;
 await handleTraining({method:'POST'},null,new URL('http://local/api/training/business'),{
  json:async()=>({name:'TW & CO Premium — demonstração',
   description:'Oficina mecânica especializada usada somente como cenário de teste em Sorocaba/SP; atendimento receptivo, diagnóstico e revisões sob avaliação técnica. O WhatsApp final 3900 não pertence à TW & CO oficial.'}),
  respond:(_res,status,body)=>{business={status,body}}
 });
 check(business?.status===200,'BUSINESS_CONFIG');
 saveSalesClosingConfig({mode:'handoff',methods:[],depositPercent:0});
 const verified=readActiveTrainingMarkdown();
 const profile=trainingStatus().profile;
 check(!!verified&&verified.includes('TW & CO Premium')&&
  verified.includes('Rua Júlio Ribeiro, 876')&&
  verified.includes('câmbio automático'), 'PROFILE_CONTENT');
 check(profile?.sha256===crypto.createHash('sha256').update(verified).digest('hex'),'INTEGRITY');
 check(!banned.test(trainingPrompt()),'OWNER_PRICES_LEAK');
 check(configuredClosing()?.mode==='handoff','NOT_HANDOFF_ONLY');
 check(getSetting('autonomous_outreach_enabled',true)===false,'OUTBOUND_NOT_PAUSED');
 return {status:'APPROVED',trainingApproved:true,manualChars:verified.length,
  profileHashPrefix:profile.sha256.slice(0,12),handoffOnly:true,
  testSenderAllowed:true,otherSendersBlocked:true,firstApproachEnabled:false,
  businessName:business.body?.business?.name||getSetting('training_business',{})?.name||'TW & CO Premium — demonstração'};
}

if(process.argv.includes('--run')){
 try{
  const result=await approveTwDemoTraining();
  console.log('TW_DEMO_TRAINING_RESULT='+JSON.stringify(result));
  if(!['APPROVED','VERIFIED','ALREADY_TRAINED_NO_OVERWRITE'].includes(result.status))process.exitCode=2;
 }catch(e){
  console.error('TW_DEMO_TRAINING_ERROR='+String(e?.message||e).slice(0,150));
  process.exitCode=1;
 }
}
