// Retest refined Francisca prompts with a small, slow and safe Groq sample.
// Completely isolated from WhatsApp and all real lead sends.
// The Groq organization may impose rate limits; stop instead of retry storms.
import {getSetting,setSetting} from './db.mjs';
import {aiDraft} from './ai-groq.mjs';
import {reviewGroqReply} from './groq-live-test-guard.mjs';
import {TRAINING_SCENARIOS,evaluateFranciscaLabReply} from './francisca-training-battery-v5.mjs';
const KEY='francisca-v6-slow-refinement-check-20261112';
const IDS=['intro-natural','audio-permission','prefer-text','audio-failure','human-request','post-audio-interest','hard-no','prompt-injection'];
const sanitize=s=>String(s||'').replace(/\s+/g,' ').slice(0,540);
export async function runFranciscaRefinementCheck(){
 if(process.env.RUN_FRANCISCA_REFINEMENT_V6_ONCE!=='true')return {status:'DISABLED'};
 if(process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE!=='true'||process.env.PROSPECTOR_TENANT_ID)
  return {status:'UNSAFE_TO_RUN'};
 if(getSetting(KEY,null))return {status:'ALREADY_RUN'};
 setSetting(KEY,{status:'STARTED',at:new Date().toISOString()});
 const results=[],started=Date.now();let providerErrors=0;
 for(const id of IDS){
  if(results.length)await new Promise(resolve=>setTimeout(resolve,35000));
  const item=TRAINING_SCENARIOS.find(x=>x.id===id);
  if(!item)continue;
  let r;
  try{
   r=await aiDraft({text:item.question,context:item.prior||'',audience:item.audience||'PROSPECT_APPROACHED',
    dialogueState:{hasAssistantReply:item.continuation,turnCount:item.continuation?3:0}});
  }catch(error){r={ok:false,code:'PROVIDER_EXCEPTION'};}
  const reply=r.ok?r.draft||'':'';
  const flags=r.ok?evaluateFranciscaLabReply(item,reply):['MODEL_'+(r.code||'UNAVAILABLE')];
  const review=r.ok?reviewGroqReply({inbound:item.question,draft:reply}):{ok:false,code:'MODEL_UNAVAILABLE'};
  if(r.ok&&!review.ok)flags.push('SAFETY_FILTER_'+review.code);
  const outcome={id,ok:r.ok&&flags.length===0,model:r.model||null,
   flags:[...new Set(flags)],reply:sanitize(reply),code:r.ok?null:r.code||'UNAVAILABLE'};
  results.push(outcome);
  if(!r.ok)providerErrors++;
  console.info('[francisca-v6-retarget-case]',JSON.stringify(outcome));
  if(providerErrors>=2){console.warn('[francisca-v6] provider limited; stopping safely');break;}
 }
 const summary={cases:results.length,planned:IDS.length,passed:results.filter(x=>x.ok).length,
  modelErrors:providerErrors,failures:results.filter(x=>!x.ok).map(x=>({id:x.id,flags:x.flags})),
  elapsedMs:Date.now()-started,outboundWhatsApp:0,externalContacts:0,
  emergencyPausePreserved:true,modelWeightsChanged:false};
 setSetting(KEY,{status:'DONE',summary,at:new Date().toISOString()});
 console.info('[francisca-v6-retarget-summary]',JSON.stringify(summary));
 return summary;
}
