// Opt-in external tenant adapter. The internal Consecom operation always
// returns before accessing these tables. Initial sends use the existing queue.
import fs from 'node:fs';
import path from 'node:path';
import {sendRecordedOfferVoiceMedia,sendOfferVideoMedia,MAX_MEDIA_BYTES} from './waakg-media.mjs';
import {db,one,all,run,now,tx,getThread,addMessage} from './db.mjs';
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
const supported=new Set(['text','reply','delay','condition','handoff','audio','video','ai']);
const mediaKind=k=>k==='audio'||k==='video';
function mediaAsset(variant,kind){
 const m=one('SELECT * FROM media WHERE id=? AND kind=?',variant?.mediaId||'',kind);
 if(!m||path.basename(m.filename)!==m.filename||!m.bytes||m.bytes>MAX_MEDIA_BYTES)return null;
 if(kind==='audio'&&!/^audio\/(ogg|opus)(;|$)/i.test(m.mime))return null;
 if(kind==='video'&&m.mime!=='video/mp4')return null;
 return m;
}
function loadFlowMedia(variant,kind){
 const m=mediaAsset(variant,kind);if(!m)throw Error('Mídia inválida');
 const dir=path.resolve(process.env.PROSPECTOR_DATA_DIR||'data','media'),file=path.join(dir,m.filename);
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size!==m.bytes||stat.size>MAX_MEDIA_BYTES)throw Error('Arquivo de mídia indisponível');
 const bytes=fs.readFileSync(file);
 if(kind==='audio'&&(bytes.length<256||bytes.toString('ascii',0,4)!=='OggS'))throw Error('Áudio não é OGG/Opus');
 if(kind==='video'&&(bytes.length<1024||bytes.toString('ascii',4,8)!=='ftyp'))throw Error('Vídeo não é MP4');
 return {m,bytes};
}
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
 if(enabled&&(!definition?.steps?.length||definition.steps[0].kind!=='text'||definition.steps.some(s=>!supported.has(s.kind))))throw Error('O fluxo real deve começar com texto e usar apenas etapas suportadas: texto, áudio, vídeo, resposta, espera, condição, Francisca e transferência humana.');
 if(enabled){
  let permission=false;
  for(const [index,step] of definition.steps.entries()){
   if(step.kind==='ai'&&(process.env.PROSPECTOR_FLOW_AI_ENABLED!=='true'||index!==definition.steps.length-1))throw Error('A Francisca exige adaptador habilitado e deve ser a última etapa.');
   if(step.kind==='condition'&&step.condition==='permission')permission=true;
   if(mediaKind(step.kind)){
    if(process.env.PROSPECTOR_FLOW_MEDIA_ENABLED!=='true'||!permission||step.variants.some(v=>!mediaAsset(v,step.kind)))throw Error('Mídia requer autorização específica, arquivo válido e habilitação do adaptador.');
   }
  }
 }
 const prior=one('SELECT project_id FROM flow_live_routes WHERE niche=? AND enabled=1',key);
 if(enabled&&prior&&prior.project_id!==projectId)throw Error('Já existe um fluxo ativo neste nicho.');
 if(!enabled){run('UPDATE flow_live_routes SET enabled=0,updated_at=? WHERE project_id=?',now(),projectId);return;}
 run('UPDATE flow_live_routes SET enabled=0,updated_at=? WHERE project_id=? AND niche<>?',now(),projectId,key);
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
 if(!plan)return !liveFlowSupported()||!previewLiveGreeting(leadId);
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
// Only future inbound events may be delegated; no replay of earlier messages.
export function liveAiOwnsLead(leadId,sessionId){
 if(!liveFlowSupported()||process.env.PROSPECTOR_FLOW_AI_ENABLED!=='true'||ownerProspectionPaused()||!documentedOptIn(leadId)||!conversationAuthorized(leadId)||!isManagedSession(sessionId)||leadSession(leadId)!==sessionId)return false;
 if(!one("SELECT 1 FROM sqlite_master WHERE name='flow_live_runs'"))return false;
 const row=one('SELECT state,session_id FROM flow_live_runs WHERE lead_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',leadId);
 return row?.state==='AI'&&row.session_id===sessionId;
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
  const rows=all("SELECT * FROM flow_live_runs WHERE state NOT IN ('COMPLETE','CANCELLED','HUMAN','REVIEW','AI') ORDER BY updated_at LIMIT 20");
  for(const row of rows){
   const def=JSON.parse(row.definition);let e=JSON.parse(row.execution);const at=Date.now();
   const lead=one('SELECT * FROM leads WHERE id=?',row.lead_id);
   if(!lead||leadSession(row.lead_id)!==row.session_id||row.jid!==lead.phone+'@s.whatsapp.net'||!documentedOptIn(row.lead_id)||one('SELECT 1 FROM suppressions WHERE phone=?',lead?.phone||'')||['NO_INTEREST','INTERESTED','CLOSED_WON'].includes(lead?.stage)||one('SELECT 1 FROM threads WHERE lead_id=? AND manual_takeover=1',row.lead_id)){
    persist(row,reduceExecution(def,e,{type:'takeover'},{at}),'HUMAN');continue;
   }
   const apply=(event,opts={})=>{e=reduceExecution(def,e,event,{at,...opts});persist(row,e);};
   if(row.state==='FIRST_PROOF'){
    const receipt=one("SELECT status,provider_id,attempted_at FROM prospecting_text_receipts WHERE lead_id=? AND greeting_id=? AND kind='GREETING'",row.lead_id,row.greeting_id);
    const batch=one('SELECT status FROM prospecting_batch_items WHERE id=?',row.greeting_id);
    if(batch?.status==='SENT'&&receipt?.provider_id&&confirmed.has(receipt.status)){
     e=reduceExecution(def,e,{type:'accepted',providerId:receipt.provider_id},{at});
     e=reduceExecution(def,e,{type:'proof',providerId:receipt.provider_id,status:receipt.status},{at});
     e.enteredAt=Math.min(at,Date.parse(receipt.attempted_at)||at);persist(row,e);processed++;
    }else if(receipt?.status==='FAILED'||batch?.status==='UNKNOWN'){hold(row,e,'primeira abordagem incerta');}
    continue;
   }
   if(!conversationAuthorized(row.lead_id)){hold(row,e,'autorização indisponível');continue;}
   const step=def.steps[e.cursor];if(!step){persist(row,e,'COMPLETE');continue;}
   if(e.state==='WAIT_REPLY'){
    const consumed=e.history.filter(h=>h.inboundId||h.id).map(h=>h.inboundId||h.id);
    const next=one("SELECT provider_id,body,state,received_at FROM waakg_inbox WHERE lead_id=? AND session_id=? AND received_at>=? AND provider_id NOT IN (SELECT value FROM json_each(?)) ORDER BY received_at,rowid LIMIT 1",row.lead_id,row.session_id,new Date(e.enteredAt).toISOString(),JSON.stringify(consumed));
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
    const exact=history.messages?.find(m=>m.fromMe===true&&outboundId(m)===e.providerId&&(!m.remoteJid||m.remoteJid===row.jid)&&confirmed.has(String(m.status).toUpperCase())&&(!mediaKind(step.kind)||String(m.type||'').toUpperCase()===(step.kind==='audio'?'AUDIO':'VIDEO')));
    if(exact){
     const providerId=e.providerId,variant=step.variants.find(v=>v.id===e.assignments[step.id]);
     tx(()=>{const thread=getThread(row.lead_id,row.jid);addMessage({threadId:thread.id,providerId:row.session_id+':'+providerId,direction:'out',type:step.kind,mediaId:variant?.mediaId||null,body:e.renderedText||render(variant?.text,lead),status:'sent'});apply({type:'proof',providerId,status:String(exact.status).toUpperCase()});delete e.renderedText;persist(row,e);});processed++;
    }
    else if(at-Date.parse(row.updated_at)>15*60000)hold(row,e,'comprovante não localizado');
    continue;
   }
   if(e.state==='RESERVED'){hold(row,e,'processamento interrompido');continue;}
   if(e.state!=='READY')continue;
   if(step.kind==='ai'){
    if(process.env.PROSPECTOR_FLOW_AI_ENABLED!=='true'||!isManagedSession(row.session_id)){hold(row,e,'Francisca indisponível');continue;}
    e.state='AI';e.history.push({type:'ai_delegated',stepId:step.id,at});persist(row,e);processed++;continue;
   }
   if(step.kind==='handoff'){
    tx(()=>{run('UPDATE threads SET manual_takeover=1 WHERE lead_id=?',row.lead_id);apply({type:'start'});queueNotice('flow-handoff:'+row.greeting_id,'FLOW_HANDOFF','Prospector Flow: conversa pronta para atendimento humano. https://wa.me/'+lead.phone,row.lead_id);});processed++;continue;
   }
   if(step.kind!=='text'&&!mediaKind(step.kind)){apply({type:'start'});continue;}
   if(mediaKind(step.kind)&&process.env.PROSPECTOR_FLOW_MEDIA_ENABLED!=='true'){hold(row,e,'adaptador de mídia desabilitado');continue;}
   const status=await (deps.status||waControlStatus)(row.session_id);
   if(!status.connected){run('UPDATE flow_live_runs SET updated_at=? WHERE greeting_id=?',now(),row.greeting_id);continue;}
   if(ownerProspectionPaused()||!isManagedSession(row.session_id)||!conversationAuthorized(row.lead_id)||!documentedOptIn(row.lead_id)||leadSession(row.lead_id)!==row.session_id){hold(row,e,'permissão alterada');continue;}
   let text='';
   tx(()=>{apply({type:'start'},{choose:()=>{const v=pick(row.project_id,row.version,step,true);text=render(v.text,lead);return v;}});});
   if((step.kind==='text'&&!text)||(step.kind==='video'&&!text)||text.length>(step.kind==='video'?1024:1500)||/\{\{/.test(text)){hold(row,e,'mensagem inválida');continue;}
   e.renderedText=text;persist(row,e);
   try{
    let providerId='',accepted=false;
    if(mediaKind(step.kind)){
     const variant=step.variants.find(v=>v.id===e.assignments[step.id]);
     const {bytes}=loadFlowMedia(variant,step.kind);
     if(ownerProspectionPaused()||!conversationAuthorized(row.lead_id)||!documentedOptIn(row.lead_id)||leadSession(row.lead_id)!==row.session_id||!isManagedSession(row.session_id)){hold(row,e,'permissão alterada');continue;}
     const sendMedia=step.kind==='audio'?(deps.sendAudio||sendRecordedOfferVoiceMedia):(deps.sendVideo||sendOfferVideoMedia);
     const ack=await sendMedia({jid:row.jid,session:row.session_id,bytes,caption:text});
     providerId=String(ack?.messageId||'');accepted=ack?.accepted===true;
    }else{
     registerApiOutboundIntent({session:row.session_id,jid:row.jid,type:'TEXT',text});
     const ack=await (deps.send||waRequest)('/api/messages/'+encodeURIComponent(row.session_id)+'/'+encodeURIComponent(row.jid)+'/send',{method:'POST',data:{message:{text}}});
     providerId=String(ack?.data?.key?.id||ack?.data?.message?.key?.id||ack?.data?.keyId||ack?.data?.id||'');accepted=ack?.status===true;
    }
    if(!accepted||!/^[\w-]{5,150}$/.test(providerId)){hold(row,e,'aceite incerto');continue;}
    apply({type:'accepted',providerId});processed++;
   }catch{hold(row,e,'transporte incerto');}
  }
  return {processed};
 }finally{busy=false;}
}
