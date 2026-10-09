// Sample production state machine: ChatGPT authoring is manual, customer delivery requires approval.
import {one,all,run,tx,id,now,audit,stage,suppressed,getThread} from './db.mjs';
import {queueNotice} from './notifications.mjs';
const statuses=['OFFER_QUEUED','OFFER_SENT','REQUESTED','IN_PROGRESS','READY','SEND_QUEUED','DELIVERED','NEEDS_REVIEW','DECLINED','CANCELLED'];
export function interpretOfferReply(raw){
 const s=String(raw||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
 if(/\b(?:nao|nunca|pare|dispenso|sem interesse|nao quero)\b/.test(s))return 'DECLINED';
 if(/^(?:sim|pode|pode sim|pode mandar|pode enviar|manda|manda sim|me manda|quero|quero ver|quero sim|claro|com certeza|por favor|pode ser|beleza|ok|envia|manda ai|gostaria de ver|tenho interesse)$/.test(s))return 'ACCEPTED';
 return 'UNCERTAIN';
}
export function explicitSampleRequest(text){
 const s=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 return /\b(?:quero|gostaria|pode|manda|me mostra|me envie|me manda)\b.{0,45}\b(?:exemplo|previa|modelo)\b.{0,45}\b(?:site|pagina|landing)\b/.test(s);
}
const get=leadId=>one('SELECT * FROM production_requests WHERE lead_id=?',leadId);
export const productionList=()=>all('SELECT p.*,l.business,l.name,l.phone,l.instagram,l.city,l.segment,l.notes,l.source FROM production_requests p JOIN leads l ON l.id=p.lead_id ORDER BY p.created_at DESC');
function link(leadId){const base=String(process.env.APP_BASE_URL||'http://127.0.0.1:3030').replace(/\/$/,'');return base+'/#/production/'+encodeURIComponent(leadId);}
function notify(leadId,event,key){
 const l=one('SELECT business FROM leads WHERE id=?',leadId);
 return queueNotice(key,event,'🔔 *Prospector — '+(event==='SITE_REQUEST'?'Novo pedido de site':event==='SITE_READY'?'Site pronto para revisar':'Aviso de produção')+'*\n\n'+(l?.business||'Prospect')+'\n\nAbra o card: '+link(leadId),leadId);
}
function accepted(leadId,origin) {
 const req=get(leadId),t=getThread(leadId),at=now();
 if(!req||!['OFFER_SENT','NEEDS_REVIEW'].includes(req.status))throw Error('Solicitação não aguarda confirmação');
 run("UPDATE production_requests SET status='REQUESTED',accepted_at=?,due_at=?,updated_at=? WHERE id=?",at,new Date(Date.now()+600000).toISOString(),at,req.id);
 run('UPDATE threads SET manual_takeover=1 WHERE id=?',t.id);
 run("UPDATE jobs SET status='CANCELLED',updated_at=? WHERE lead_id=? AND status='PENDING' AND execution_id IS NOT NULL",at,leadId);
 run("UPDATE executions SET state='NEEDS_REVIEW',updated_at=? WHERE lead_id=? AND state NOT IN ('COMPLETE','CANCELLED')",at,leadId);
 stage(leadId,'INTERESTED','cliente solicitou exemplo');
 audit('SITE_SAMPLE_REQUESTED',leadId,{origin,request:req.id});
 notify(leadId,'SITE_REQUEST','sample:requested:'+req.id);
 return get(leadId);
}
export function offer(leadId,mediaId){
 return tx(()=>{
  const l=one('SELECT * FROM leads WHERE id=?',leadId);
  if(!l||!l.phone||!l.contact_permission||suppressed(l.phone))throw Error('Contato não autorizado');
  if(get(leadId))throw Error('Oferta já registrada');
  if(!one("SELECT id FROM messages WHERE direction='in' AND thread_id IN (SELECT id FROM threads WHERE lead_id=?)",leadId))throw Error('A oferta requer conversa prévia');
  if(!one("SELECT id FROM media WHERE id=? AND kind='audio'",mediaId))throw Error('Selecione um áudio existente');
  const jobId=id(),requestId=id(),at=now();
  run("INSERT INTO jobs(id,lead_id,type,text,media_id,key,status,created_at,updated_at) VALUES(?,?,'audio','',?,?,'PENDING',?,?)",jobId,leadId,mediaId,'sample-offer:'+requestId,at,at);
  run("INSERT INTO production_requests(id,lead_id,status,offer_job_id,created_at,updated_at) VALUES(?,?,'OFFER_QUEUED',?,?,?)",requestId,leadId,jobId,at,at);
  audit('SAMPLE_OFFER_QUEUED',leadId,{requestId});return get(leadId);
 });
}
export function onSent(jobId){
 const a=one('SELECT * FROM production_requests WHERE offer_job_id=?',jobId);
 if(a?.status==='OFFER_QUEUED')run("UPDATE production_requests SET status='OFFER_SENT',updated_at=? WHERE id=?",now(),a.id);
 const d=one('SELECT * FROM production_requests WHERE delivery_job_id=?',jobId);
 if(d?.status==='SEND_QUEUED'){
  run("UPDATE production_requests SET status='DELIVERED',delivered_at=?,updated_at=? WHERE id=?",now(),now(),d.id);
  audit('SAMPLE_DELIVERED',d.lead_id,{request:d.id});
 }
}
export function onUnknown(jobId){
 const r=one('SELECT * FROM production_requests WHERE offer_job_id=? OR delivery_job_id=?',jobId,jobId);
 if(r&&['OFFER_QUEUED','SEND_QUEUED'].includes(r.status))run("UPDATE production_requests SET status='NEEDS_REVIEW',updated_at=? WHERE id=?",now(),r.id);
}
export function onReply(leadId,body,isText=true){
 if(!isText)return null;
 const r=get(leadId);
 if(!r){
  if(!explicitSampleRequest(body))return null;
  const requestId=id(),at=now();
  run("INSERT OR IGNORE INTO production_requests(id,lead_id,status,created_at,updated_at) VALUES(?,?,'OFFER_SENT',?,?)",requestId,leadId,at,at);
  return accepted(leadId,'pedido_explicito');
 }
 if(r.status!=='OFFER_SENT')return null;
 const intent=interpretOfferReply(body);
 if(intent==='ACCEPTED')accepted(leadId,'resposta_ao_audio');
 else if(intent==='DECLINED'){
  run("UPDATE production_requests SET status='DECLINED',updated_at=? WHERE id=?",now(),r.id);
  audit('SAMPLE_OFFER_DECLINED',leadId,{request:r.id});
 }else{
  run("UPDATE production_requests SET status='NEEDS_REVIEW',updated_at=? WHERE id=?",now(),r.id);
  audit('SAMPLE_OFFER_AMBIGUOUS',leadId,{request:r.id});
 }
 return intent;
}
export const manualAccept=leadId=>tx(()=>{
 const r=get(leadId);
 if(!r||!['OFFER_SENT','NEEDS_REVIEW'].includes(r.status))throw Error('Oferta não está aguardando confirmação');
 if(!one("SELECT id FROM messages WHERE direction='in' AND thread_id IN (SELECT id FROM threads WHERE lead_id=?)",leadId))throw Error('Sem resposta do cliente');
 return accepted(leadId,'revisao_humana');
});
export function move(leadId,status,siteUrl){
 const r=get(leadId);if(!r)throw Error('Solicitação não encontrada');
 const next={REQUESTED:['IN_PROGRESS','CANCELLED'],IN_PROGRESS:['READY','CANCELLED'],READY:['IN_PROGRESS','CANCELLED'],NEEDS_REVIEW:['CANCELLED']};
 if(!next[r.status]?.includes(status))throw Error('Transição inválida');
 let url=r.site_url;
 if(status==='READY'){
  const parsed=new URL(String(siteUrl||r.site_url||''));
  const allowed=String(process.env.SITE_STUDIO_ALLOWED_HOSTS||'prospector-ui-production.up.railway.app').split(',').map(x=>x.trim());
  if(parsed.protocol!=='https:'||!allowed.includes(parsed.hostname)||!/^\/studio\/sites\/[a-z0-9-]{2,80}\.html$/.test(parsed.pathname))throw Error('Informe uma URL publicada no Site Studio');
  url=parsed.href;
 }
 run('UPDATE production_requests SET status=?,site_url=?,updated_at=? WHERE id=?',status,url||null,now(),r.id);
 audit('SAMPLE_STATUS',leadId,{status});
 if(status==='READY')notify(leadId,'SITE_READY','sample:ready:'+r.id+':'+url);
 return get(leadId);
}
export function approveAndQueue(leadId){
 return tx(()=>{
  const r=get(leadId),l=one('SELECT * FROM leads WHERE id=?',leadId);
  if(!r||r.status!=='READY'||!r.accepted_at||!r.site_url)throw Error('Prévia não pronta ou sem aceite');
  if(!l||!l.phone||!l.contact_permission||suppressed(l.phone))throw Error('Contato bloqueado ou sem autorização');
  const text='Como combinado, preparei um *exemplo visual* de como seu site poderia ficar! 😊\n\n'+r.site_url+'\n\nÉ uma proposta inicial para você visualizar a ideia. Se gostar, podemos conversar sobre os próximos passos.';
  const job=id(),at=now();
  run("INSERT INTO jobs(id,lead_id,type,text,key,status,created_at,updated_at) VALUES(?,?,'message',?,?,'PENDING',?,?)",job,leadId,text,'sample-delivery:'+r.id,at,at);
  run("UPDATE production_requests SET status='SEND_QUEUED',delivery_job_id=?,updated_at=? WHERE id=?",job,at,r.id);
  audit('SAMPLE_APPROVED',leadId,{request:r.id});
  return get(leadId);
 });
}
export function closeDeal(leadId){
 const req=get(leadId);if(!req||req.status!=='DELIVERED')throw Error('Conclua a entrega primeiro');
 stage(leadId,'CLOSED_WON','Fechamento confirmado manualmente');audit('SAMPLE_DEAL_CLOSED',leadId,{request:req.id});
}
export function cancelForOptOut(leadId){
 run("UPDATE production_requests SET status='CANCELLED',updated_at=? WHERE lead_id=? AND status NOT IN ('DECLINED','CANCELLED','DELIVERED')",now(),leadId);
}
export function brief(leadId){
 const l=one('SELECT * FROM leads WHERE id=?',leadId),r=get(leadId);
 if(!l||!r)throw Error('Solicitação não encontrada');
 return {job_reference:r.id,company:l.business,instagram:l.instagram?'https://instagram.com/'+l.instagram:null,
 category:l.segment||null,city:l.city||null,website:l.website||null,site_verification:l.website_status,
 origin:l.source,notes:l.notes||null,requested_at:r.accepted_at,deadline_target:r.due_at,
 instructions:'Criar landing page demonstrativa premium, responsiva, autoral e fluida sem layout padronizado. Pesquisar fontes públicas e não inventar fatos, serviços ou portfólio. Criar arquivo studio/sites/<slug>.html no GitHub WmAgencia/Prospector, cadastrar em studio/projects.json com production_ref igual a job_reference, publicar e retornar link. O lead deve revisar antes de qualquer envio ao cliente.'};
}
