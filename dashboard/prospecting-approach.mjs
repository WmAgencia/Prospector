// Consent-aware, side-effect-free previews for manually selected businesses.
// Initial greeting is deterministic by Brazil local time; Groq can enrich replies
// after the operator supplies an approved playbook and example conversations.
import {one,all} from './db.mjs';
import {documentedOptIn} from './outreach-queue.mjs';
import {greetingForProspect} from './prospecting-introduction.mjs';

export function greetingForTime(at=new Date(),timeZone='America/Sao_Paulo'){
 const fmt=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone});
 const hour=Number(fmt.format(new Date(at)));
 return hour>=5&&hour<12?'bom dia':hour>=12&&hour<18?'boa tarde':'boa noite';
}

export function prepareApproaches(input={}){
 if(!Array.isArray(input.leadIds)||input.leadIds.length===0||input.leadIds.length>100)throw Error('Selecione entre 1 e 100 empresas');
 const ids=[...new Set(input.leadIds.map(x=>String(x||'')))];
 if(ids.length>100||ids.some(x=>!/^[a-f0-9-]{36}$/i.test(x)))throw Error('Seleção de empresas inválida');
 const greeting=greetingForTime();
 const message='Olá, [nome da empresa ou pessoa], tudo bem?';
 const items=[];
 for(const leadId of ids){
  const row=one("SELECT l.id,l.name,l.business,l.phone,l.contact_permission,l.stage,EXISTS(SELECT 1 FROM initial_contacts WHERE lead_id=l.id) approached, EXISTS(SELECT 1 FROM threads t JOIN messages m ON m.thread_id=t.id WHERE t.lead_id=l.id AND m.direction='out') sent,EXISTS(SELECT 1 FROM suppressions WHERE phone=l.phone) suppressed FROM leads l WHERE l.id=?",leadId);
  if(!row){items.push({id:leadId,status:'MISSING',eligible:false});continue;}
  const contacted=row.approached||row.sent||row.stage!=='DISCOVERED';
  const eligible=!!row.phone&&!contacted&&!row.suppressed;
  const authorized=eligible&&row.contact_permission===1&&documentedOptIn(row.id);
  items.push({id:row.id,business:row.business,phoneSuffix:row.phone?row.phone.slice(-4):null,message:eligible?greetingForProspect(row):null,eligible,authorized,
   // A manual one-to-one link does not call the WA-AKG sender. Only the human
   // operating the browser can choose whether to submit the message.
   manualUrl:eligible&&row.phone?'https://wa.me/'+encodeURIComponent(row.phone):null,
   status:!eligible?'UNAVAILABLE':authorized?'READY_FOR_APPROVAL':'NEEDS_PERMISSION'});
 }
 return {ok:true,greeting,message:items.find(x=>x.eligible)?.message||message,items,selected:ids.length,ready:items.filter(x=>x.authorized).length,
  manualReady:items.filter(x=>x.eligible&&!x.authorized).length,
  needsPermission:items.filter(x=>x.status==='NEEDS_PERMISSION').length,
  requiresHumanApproval:true,autoSent:false,groqTraining:'CUSTOMIZED_DRAFT_ONLY'};
}
