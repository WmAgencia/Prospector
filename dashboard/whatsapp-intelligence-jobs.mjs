// Read-only conversation analytics for the authenticated single-company Prospector console.
// No WhatsApp sending, media downloads, transcription, or third-party model calls occur here.
import crypto from 'node:crypto';
import {db,one,all,run,now} from './db.mjs';
import {waRequest,selectedWaSession} from './waakg-control.mjs';
import {analyzeAuthorizedConversations,summarizeConversationSignals} from './whatsapp-intelligence.mjs';

db.exec("CREATE TABLE IF NOT EXISTS wa_intelligence_jobs(id TEXT PRIMARY KEY, company_id TEXT NOT NULL, state TEXT NOT NULL, percent INTEGER NOT NULL, processed INTEGER NOT NULL, total INTEGER NOT NULL, skipped INTEGER NOT NULL, failed INTEGER NOT NULL, session_count INTEGER NOT NULL, report_md TEXT, playbook_md TEXT, summary_json TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS wa_intelligence_approvals(company_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, reviewed_at TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)))");
run("UPDATE wa_intelligence_jobs SET state='INTERRUPTED',error='Interrompida por reinício; execute nova análise.',updated_at=? WHERE state IN ('RUNNING','CANCELLING')",now());
const COMPANY='consecom';
const SAFE_ID=/^[a-zA-Z0-9_-]{3,70}$/;
let running=null;
let cancelling=false;
const jobRow=id=>one("SELECT * FROM wa_intelligence_jobs WHERE id=? AND company_id=?",id,COMPANY);
const normalize=x=>String(x||'').replace(/\D/g,'');
export function authorizedSessionIds({configured=process.env.WA_AKG_ANALYTICS_ALLOWED_SESSIONS,defaultId=selectedWaSession()}={}){
 const explicit=String(configured||'').split(',').map(s=>s.trim()).filter(x=>SAFE_ID.test(x));
 return [...new Set(explicit.length?explicit:(SAFE_ID.test(defaultId)?[defaultId]:[]))];
}
export async function intelligenceSessions(request=waRequest){
 const allowed=new Set(authorizedSessionIds());
 if(!allowed.size)return {sessions:[],reason:'Defina uma sessão WhatsApp autorizada em Conexões.'};
 const result=await request('/api/sessions');
 const array=Array.isArray(result?.data)?result.data:[];
 return {sessions:array.filter(s=>allowed.has(s.sessionId)).map(s=>({id:s.sessionId,name:String(s.name||'WhatsApp').slice(0,80),connected:s.status==='CONNECTED'})),reason:null};
}
function outcomeForPhone(value){
 const digits=normalize(value);
 if(!/^55\d{10,11}$/.test(digits))return 'unclassified';
 const row=one("SELECT s.status FROM sales_outcomes s JOIN leads l ON l.id=s.lead_id WHERE l.phone=? LIMIT 1",digits);
 return ({INTERESTED:'interested',CLOSED_WON:'sale',NO_INTEREST:'no_interest',OPT_OUT:'no_interest'})[row?.status]||'unclassified';
}
export function filterRemoteChats(list){
 return (Array.isArray(list)?list:[]).filter(x=>x&&/^\d{10,15}@s\.whatsapp\.net$/.test(String(x.jid||'')));
}
export async function collectReadOnly({request=waRequest,sessionIds,onProgress=()=>{},shouldStop=()=>false}){
 if(!Array.isArray(sessionIds)||sessionIds.length===0||sessionIds.length>30||!sessionIds.every(s=>SAFE_ID.test(s)))throw Error('Seleção de sessões inválida');
 const perSession=[];
 for(const sid of sessionIds){
  if(shouldStop())throw Error('CANCELLED');
  const value=await request('/api/chat/'+encodeURIComponent(sid));
  perSession.push({sid,chats:filterRemoteChats(value?.data)});
 }
 const total=perSession.reduce((sum,x)=>sum+x.chats.length,0);
 if(total>10000)throw Error('Acima de 10 mil conversas. Divida a análise por sessão.');
 const conversations=[];let processed=0,skipped=0,failed=0;
 onProgress({processed,total,failed,skipped,percent:0});
 for(const {sid,chats} of perSession){
  for(const chat of chats){
   if(shouldStop())throw Error('CANCELLED');
   try{
    const res=await request('/api/chat/'+encodeURIComponent(sid)+'/'+encodeURIComponent(chat.jid));
    if(!Array.isArray(res?.data))throw Error('Formato inválido');
    // Never persist any raw WhatsApp text, user names, phone numbers or chat identifiers.
    const messages=res.data.slice(-5000).filter(m=>m&&typeof m==='object')
      .map(m=>({id:m.id||m.keyId||undefined,direction:m.fromMe?'out':'in',
        body:(typeof m.content==='string'?m.content:String(m.caption||'')).slice(0,2000)}));
    const signals=summarizeConversationSignals(messages);
    const fromCrm=outcomeForPhone(chat.jid.split('@')[0]);
    const outcome=fromCrm!=='unclassified'?fromCrm:
      signals.outbound>0&&signals.inbound===0?'no_response':'unclassified';
    // Keep only non-identifying statistics, not message bodies or chat identifiers.
    conversations.push({tenantId:COMPANY,outcome,signals,isGroup:false});
   }catch(e){failed++;}
   processed++;
   if(processed%2===0||processed===total)onProgress({processed,total,failed,skipped,percent:total?Math.floor(processed*100/total):100});
  }
 }
 if(total===0)onProgress({processed:0,total:0,failed,skipped,percent:100});
 return {conversations,processed,total,skipped,failed};
}
export function intelligenceStatus(){
 const job=one("SELECT * FROM wa_intelligence_jobs WHERE company_id=? ORDER BY created_at DESC LIMIT 1",COMPANY);
 const approval=one('SELECT job_id,reviewed_at,enabled FROM wa_intelligence_approvals WHERE company_id=?',COMPANY);
 return {job:job?{id:job.id,state:job.state,percent:job.percent,processed:job.processed,total:job.total,skipped:job.skipped,failed:job.failed,sessionCount:job.session_count,createdAt:job.created_at,updatedAt:job.updated_at,error:job.error,hasReport:!!job.report_md,summary:job.summary_json?JSON.parse(job.summary_json):null}:null,
 approval:approval?{jobId:approval.job_id,reviewedAt:approval.reviewed_at,enabled:!!approval.enabled}:null,
 running:!!running};
}
function progress(jobId,v){
 run("UPDATE wa_intelligence_jobs SET processed=?,total=?,failed=?,skipped=?,percent=?,updated_at=? WHERE id=? AND state IN ('RUNNING','CANCELLING')",v.processed,v.total,v.failed,v.skipped,v.percent,now(),jobId);
}
async function executeJob(jobId,sessionIds,request){
 try{
  const output=await collectReadOnly({request,sessionIds,onProgress:v=>progress(jobId,v),shouldStop:()=>cancelling});
  if(cancelling)throw Error('CANCELLED');
  const analytics=analyzeAuthorizedConversations({tenantId:COMPANY,authorized:true,conversations:output.conversations});
  const extra=output.failed?'\n\nAtenção: '+output.failed+' conversa(s) não puderam ser lidas. O relatório não representa 100% do histórico.\n':'';
  const state=output.failed?'PARTIAL':'REVIEW';
  run("UPDATE wa_intelligence_jobs SET state=?,percent=100,processed=?,total=?,skipped=?,failed=?,report_md=?,playbook_md=?,summary_json=?,updated_at=? WHERE id=?",
    state,output.processed,output.total,output.skipped,output.failed,
    analytics.reportMarkdown+extra,analytics.playbookMarkdown,JSON.stringify(analytics.summary),now(),jobId);
 }catch(e){
  const cancelled=String(e?.message||'')==='CANCELLED';
  run("UPDATE wa_intelligence_jobs SET state=?,error=?,updated_at=? WHERE id=?",cancelled?'CANCELLED':'FAILED',cancelled?'Cancelada pelo operador.':String(e?.message||'Erro ao ler conversas').slice(0,200),now(),jobId);
 }finally{running=null;cancelling=false;}
}
export async function startIntelligence({sessionIds,acknowledged=false,request=waRequest}={}){
 if(running)return {status:409,body:{error:'Uma análise já está em execução.'}};
 if(acknowledged!==true)return {status:403,body:{error:'Confirme que possui autorização para analisar as conversas.'}};
 const allowed=new Set(authorizedSessionIds());
 if(!Array.isArray(sessionIds)||!sessionIds.length||sessionIds.length>30||sessionIds.some(s=>!allowed.has(s)))return {status:403,body:{error:'Sessão não autorizada para análise.'}};
 const existing=await intelligenceSessions(request);
 if(sessionIds.some(id=>!existing.sessions.some(x=>x.id===id&&x.connected)))return {status:409,body:{error:'Conecte todas as sessões selecionadas antes de analisar.'}};
 const jobId=crypto.randomUUID();
 run("INSERT INTO wa_intelligence_jobs(id,company_id,state,percent,processed,total,skipped,failed,session_count,created_at,updated_at) VALUES(?,?, 'RUNNING',0,0,0,0,0,?,?,?)",
   jobId,COMPANY,sessionIds.length,now(),now());
 cancelling=false;
 running=Promise.resolve().then(()=>executeJob(jobId,[...new Set(sessionIds)],request));
 return {status:202,body:{ok:true,jobId}};
}
export function cancelIntelligence(){
 if(!running)return {status:409,body:{error:'Nenhuma análise em execução.'}};
 cancelling=true;
 run("UPDATE wa_intelligence_jobs SET state='CANCELLING',updated_at=? WHERE company_id=? AND state='RUNNING'",now(),COMPANY);
 return {status:202,body:{ok:true}};
}
export function intelligenceDocument(jobId,kind){
 const job=jobRow(jobId);
 if(!job||!['REVIEW','PARTIAL','APPROVED'].includes(job.state))return null;
 if(kind==='report')return job.report_md;
 if(kind==='playbook')return job.playbook_md;
 return null;
}
export function reviewIntelligence({jobId,approve,acknowledged=false}={}){
 if(typeof jobId!=='string'||typeof approve!=='boolean'||acknowledged!==true)return {status:400,body:{error:'Revisão explícita obrigatória.'}};
 const job=jobRow(jobId);
 if(!job||!['REVIEW','PARTIAL','APPROVED'].includes(job.state)||!job.playbook_md)return {status:409,body:{error:'Nenhum relatório concluído para aprovar.'}};
 if(approve&&job.state==='PARTIAL')return {status:409,body:{error:'Análise parcial: revise falhas e execute novamente antes de aplicar.'}};
 if(approve&&(!job.summary_json||JSON.parse(job.summary_json).total<1))return {status:409,body:{error:'Não há conversas analisadas para aprovar.'}};
 if(approve){
  run("INSERT INTO wa_intelligence_approvals(company_id,job_id,reviewed_at,enabled) VALUES(?,?,?,1) ON CONFLICT(company_id) DO UPDATE SET job_id=excluded.job_id,reviewed_at=excluded.reviewed_at,enabled=1",
    COMPANY,jobId,now());
  run("UPDATE wa_intelligence_jobs SET state='APPROVED',updated_at=? WHERE id=?",now(),jobId);
 }else{
  run("DELETE FROM wa_intelligence_approvals WHERE company_id=?",COMPANY);
  run("UPDATE wa_intelligence_jobs SET state='REVIEW',updated_at=? WHERE id=? AND state='APPROVED'",now(),jobId);
 }
 return {status:200,body:{ok:true,enabled:approve}};
}
export function approvedIntelligenceGuidance(){
 const row=one("SELECT j.playbook_md FROM wa_intelligence_approvals a JOIN wa_intelligence_jobs j ON j.id=a.job_id WHERE a.company_id=? AND a.enabled=1 AND j.state='APPROVED' LIMIT 1",COMPANY);
 if(!row)return '';
 // Static, operator-approved content: NEVER include raw chat text or arbitrary model instructions.
 return String(row.playbook_md).replace('PENDENTE_DE_APROVACAO','APROVADO_PELO_OPERADOR').slice(0,2500);
}
