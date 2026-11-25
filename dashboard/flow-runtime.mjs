// Opt-in external tenant adapter. The internal Consecom operation always
// returns before accessing these tables. Initial sends use the existing queue.
import {db,one,all,run,now,tx} from './db.mjs';
import {assignVariant,normalizedNiche,newExecution,reduceExecution} from './flow-engine.mjs';
import {documentedOptIn} from './outreach-queue.mjs';
import {isManagedSession,leadSession} from './waakg-session-registry.mjs';
import {conversationAuthorized} from './operator-outreach.mjs';
import {waControlStatus,waRequest} from './waakg-control.mjs';
import {registerApiOutboundIntent} from './waakg-outbound-intents.mjs';
import {loadProspectorHistory,outboundId} from './prospecting-chat-history.mjs';
import {acceptsProposalAudio,interestedAfterProposal} from './prospector-sales-signals.mjs';
import {detectAutomaticReply} from './portfolio-offer-550.mjs';
import {salesEnding} from './sales-policy.mjs';
import {queueNotice} from './notifications.mjs';
import {ownerProspectionPaused} from './prospection-pause.mjs';
const external=()=>!!process.env.PROSPECTOR_TENANT_ID&&process.env.PROSPECTOR_TENANT_INTERNAL!=='true'&&process.env.PROSPECTOR_DEMO_MODE!=='true';
export const liveFlowSupported=()=>external()&&process.env.PROSPECTOR_FLOW_LIVE_ENABLED==='true';
const supported=new Set(['text','reply','delay','condition','handoff']);
const confirmed=new Set(['SENT','DELIVERED','READ']);
function init(){
 db.exec("CREATE TABLE IF NOT EXISTS flow_live_routes(niche TEXT PRIMARY KEY,project_id TEXT NOT NULL,version INTEGER NOT NULL,definition TEXT NOT NULL,enabled INTEGER NOT NULL,updated_at TEXT NOT NULL)");
 db.exec("CREATE TABLE IF NOT EXISTS flow_live_runs(greeting_id TEXT PRIMARY KEY,lead_id TEXT NOT NULL,project_id TEXT NOT NULL,version INTEGER NOT NULL,session_id TEXT NOT NULL,jid TEXT NOT NULL,definition TEXT NOT NULL,execution TEXT NOT NULL,first_text TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
 db.exec("CREATE INDEX IF NOT EXISTS idx_flow_live_lead ON flow_live_runs(lead_id,created_at)");
 db.exec("CREATE TABLE IF NOT EXISTS flow_live_variants(project_id TEXT NOT NULL,version INTEGER NOT NULL,step_id TEXT NOT NULL,variant_id TEXT NOT NULL,total INTEGER NOT NULL,PRIMARY KEY(project_id,version,step_id,variant_id))");
}
export function setLiveRoute({projectId,niche,version,definition,enabled}){
 if(!liveFlowSupported())throw Error('Execução real indisponível nesta conta.');
 init();
 const key=normalizedNiche(niche);if(!key)throw Error('Defina um nicho exato.');
 if(enabled&&(!definition?.steps?.length||definition.steps[0].kind!=='text'||definition.steps.some(s=>!supported.has(s.kind))))throw Error('Esta versão aceita texto, espera, resposta, condições e transferência humana. Mídia e IA exigem validação adicional.');
 const prior=one('SELECT project_id FROM flow_live_routes WHERE niche=? AND enabled=1',key);
 if(enabled&&prior&&prior.project_id!==projectId)throw Error('Já existe um fluxo ativo neste nicho.');
 if(!enabled){run('UPDATE flow_live_routes SET enabled=0,updated_at=? WHERE project_id=?',now(),projectId);return;}
 run('INSERT INTO flow_live_routes(niche,project_id,version,definition,enabled,updated_at) VALUES(?,?,?,?,1,?) ON CONFLICT(niche) DO UPDATE SET project_id=excluded.project_id,version=excluded.version,definition=excluded.definition,enabled=1,updated_at=excluded.updated_at',key,projectId,version,JSON.stringify(definition),now());
}
const render=(text,lead)=>String(text||'').replace(/\{\{(nome|empresa|cidade|segmento)\}\}/g,(_,key)=>String(({nome:lead.name,empresa:lead.business,cidade:lead.city,segmento:lead.segment})[key]||'').slice(0,120)).replace(/\s+/g,' ').trim();
function pick(project,version,step,commit=false){
 const counts=Object.fromEntries(all('SELECT variant_id,total FROM flow_live_variants WHERE project_id=? AND version=? AND step_id=?',project,version,step.id).map(r=>[r.variant_id,r.total]));
 const v=assignVariant(step.variants,counts);
 if(commit)run('INSERT INTO flow_live_variants(project_id,version,step_id,variant_id,total) VALUES(?,?,?,?,1) ON CONFLICT(project_id,version,step_id,variant_id) DO UPDATE SET total=total+1',project,version,step.id,v.id);
 return v;
}
export function previewLiveGreeting(leadId){
 if(!liveFlowSupported())return null;init();
 const lead=one('SELECT * FROM leads WHERE id=?',leadId);
 const route=lead&&one('SELECT * FROM flow_live_routes WHERE niche=? AND enabled=1',normalizedNiche(lead.segment));
 if(!route)return null;
 if(!documentedOptIn(leadId))return {blocked:true};
 const definition=JSON.parse(route.definition),step=definition.steps[0],v=pick(route.project_id,route.version,step),text=render(v.text,lead);
 if(!text||text.length>1500||/\{\{/.test(text))return {blocked:true};
 return {projectId:route.project_id,version:route.version,niche:route.niche,definition,variantId:v.id,text};
}
// Called inside existing queue reservation transaction, never sends.
export function reserveLiveGreeting({plan,leadId,greetingId,sessionId,jid,at}){
 if(!plan)return true;
 if(!liveFlowSupported()||plan.blocked||!documentedOptIn(leadId)||!isManagedSession(sessionId))return false;
 const route=one('SELECT * FROM flow_live_routes WHERE niche=? AND enabled=1',plan.niche);
 if(!route||route.project_id!==plan.projectId||route.version!==plan.version)return false;
 const current=previewLiveGreeting(leadId);
 if(!current||current.blocked||current.variantId!==plan.variantId||current.text!==plan.text)return false;
 const initial=reduceExecution(plan.definition,newExecution(plan.definition,at),{type:'start'},{at,choose:()=>pick(plan.projectId,plan.version,plan.definition.steps[0],true)});
 run('INSERT INTO flow_live_runs(greeting_id,lead_id,project_id,version,session_id,jid,definition,execution,first_text,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',greetingId,leadId,plan.projectId,plan.version,sessionId,jid,JSON.stringify(plan.definition),JSON.stringify(initial),plan.text,'FIRST_PROOF',now(),now());
 return true;
}
export function liveFirstText(greetingId){
 if(!external()||!one("SELECT 1 FROM sqlite_master WHERE name='flow_live_runs'"))return null;
 return one('SELECT first_text FROM flow_live_runs WHERE greeting_id=?',greetingId)?.first_text||null;
}
export function liveOwnsLead(leadId){
 if(!external()||!one("SELECT 1 FROM sqlite_master WHERE name='flow_live_runs'"))return false;
 return !!one('SELECT 1 FROM flow_live_runs WHERE lead_id=?',leadId);
}
function persist(row,e,state=e.state){
 run('UPDATE flow_live_runs SET execution=?,state=?,updated_at=? WHERE greeting_id=?',JSON.stringify(e),state,now(),row.greeting_id);
}
function hold(row,e,reason){
 e.state='REVIEW';persist(row,e);
 queueNotice('flow-review:'+row.greeting_id+':'+e.cursor,'FLOW_REVIEW','Prospector Flow: etapa requer revisão humana ('+reason+').',row.lead_id);
}
let busy=false;
export async function tickLiveFlows(deps={}){
 if(!liveFlowSupported()||ownerProspectionPaused()||busy)return {processed:0};
 init();busy=true;let processed=0;
 try{
  const rows=all("SELECT * FROM flow_live_runs WHERE state NOT IN ('COMPLETE','CANCELLED','HUMAN','REVIEW') ORDER BY updated_at LIMIT 20");
  for(const row of rows){
   const def=JSON.parse(row.definition);let e=JSON.parse(row.execution);const at=Date.now();
   const lead=one('SELECT * FROM leads WHERE id=?',row.lead_id);
   if(!lead||leadSession(row.lead_id)!==row.session_id||row.jid!==lead.phone+'@s.whatsapp.net'||!documentedOptIn(row.lead_id)||one('SELECT 1 FROM suppressions WHERE phone=?',lead?.phone||'')||['NO_INTEREST','INTERESTED','CLOSED_WON'].includes(lead?.stage)||one('SELECT 1 FROM threads WHERE lead_id=? AND manual_takeover=1',row.lead_id)){
    persist(row,reduceExecution(def,e,{type:'takeover'},{at}),'HUMAN');continue;
   }
   const apply=(event,opts={})=>{e=reduceExecution(def,e,event,{at,...opts});persist(row,e);};
   if(row.state==='FIRST_PROOF'){
    const receipt=one("SELECT status,provider_id FROM prospecting_text_receipts WHERE lead_id=? AND greeting_id=? AND kind='GREETING'",row.lead_id,row.greeting_id);
    const batch=one('SELECT status FROM prospecting_batch_items WHERE id=?',row.greeting_id);
    if(batch?.status==='SENT'&&receipt?.provider_id&&confirmed.has(receipt.status)){
     e=reduceExecution(def,e,{type:'accepted',providerId:receipt.provider_id},{at});
     apply({type:'proof',providerId:receipt.provider_id,status:receipt.status});processed++;
    }else if(receipt?.status==='FAILED'||batch?.status==='UNKNOWN'){hold(row,e,'primeira abordagem incerta');}
    continue;
   }
   if(!conversationAuthorized(row.lead_id)){hold(row,e,'autorização indisponível');continue;}
   const step=def.steps[e.cursor];if(!step){persist(row,e,'COMPLETE');continue;}
   if(e.state==='WAIT_REPLY'){
    const incoming=all("SELECT provider_id,body,state,received_at FROM waakg_inbox WHERE lead_id=? AND session_id=? AND received_at>=? ORDER BY received_at,rowid LIMIT 100",row.lead_id,row.session_id,new Date(e.enteredAt).toISOString());
    const next=incoming.find(x=>!e.history.some(h=>h.inboundId===x.provider_id||h.id===x.provider_id));
    if(!next){run('UPDATE flow_live_runs SET updated_at=? WHERE greeting_id=?',now(),row.greeting_id);continue;}
    const ending=salesEnding(next.body);
    if(next.state==='OPT_OUT'||ending==='OPT_OUT'||next.state==='NO_INTEREST'||ending==='NO_INTEREST')apply({type:'refusal'});
    else if(next.state==='HUMAN')apply({type:'takeover'});
    else {
     const intent=acceptsProposalAudio(next.body)?'permission':interestedAfterProposal(next.body)?'interest':'reply';
     e=reduceExecution(def,e,{type:'inbound',id:next.provider_id,intent,automatic:next.state!=='REVIEW'||detectAutomaticReply(next.body)},{at});
     e.history.push({type:'inbound_consumed',inboundId:next.provider_id,at});persist(row,e);
    }
    processed++;continue;
   }
   if(e.state==='WAIT_TIME'){apply({type:'tick'});continue;}
   if(e.state==='WAIT_PROOF'){
    const history=await (deps.history||loadProspectorHistory)({sessionId:row.session_id,jid:row.jid,fetchChat:deps.send||waRequest});
    const exact=history.messages?.find(m=>m.fromMe===true&&outboundId(m)===e.providerId&&(!m.remoteJid||m.remoteJid===row.jid)&&confirmed.has(String(m.status).toUpperCase()));
    if(exact){apply({type:'proof',providerId:e.providerId,status:String(exact.status).toUpperCase()});processed++;}
    else if(at-Date.parse(row.updated_at)>15*60000)hold(row,e,'comprovante não localizado');
    continue;
   }
   if(e.state==='RESERVED'){hold(row,e,'processamento interrompido');continue;}
   if(e.state!=='READY')continue;
   if(step.kind==='handoff'){
    tx(()=>{run('UPDATE threads SET manual_takeover=1 WHERE lead_id=?',row.lead_id);apply({type:'start'});queueNotice('flow-handoff:'+row.greeting_id,'FLOW_HANDOFF','Prospector Flow: conversa pronta para atendimento humano. https://wa.me/'+lead.phone,row.lead_id);});processed++;continue;
   }
   if(step.kind!=='text'){apply({type:'start'});continue;}
   const status=await (deps.status||waControlStatus)(row.session_id);
   if(!status.connected){run('UPDATE flow_live_runs SET updated_at=? WHERE greeting_id=?',now(),row.greeting_id);continue;}
   if(!conversationAuthorized(row.lead_id)||!documentedOptIn(row.lead_id)||leadSession(row.lead_id)!==row.session_id){hold(row,e,'permissão alterada');continue;}
   let text='';
   tx(()=>{apply({type:'start'},{choose:()=>{const v=pick(row.project_id,row.version,step,true);text=render(v.text,lead);return v;}});});
   if(!text||text.length>1500||/\{\{/.test(text)){hold(row,e,'mensagem inválida');continue;}
   try{
    registerApiOutboundIntent({session:row.session_id,jid:row.jid,type:'TEXT',text});
    const ack=await (deps.send||waRequest)('/api/messages/'+encodeURIComponent(row.session_id)+'/'+encodeURIComponent(row.jid)+'/send',{method:'POST',data:{message:{text}}});
    const providerId=String(ack?.data?.key?.id||ack?.data?.message?.key?.id||ack?.data?.keyId||ack?.data?.id||'');
    if(ack?.status!==true||!/^[\w-]{5,150}$/.test(providerId)){hold(row,e,'aceite incerto');continue;}
    apply({type:'accepted',providerId});processed++;
   }catch{hold(row,e,'transporte incerto');}
  }
  return {processed};
 }finally{busy=false;}
}
