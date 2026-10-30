// Deterministic, per-customer approvals. Transport reservations are never retried.
import {db,one,all,run,id,now,getThread,addMessage,audit} from './db.mjs';
import {selectedWaSession,waControlStatus,waRequest} from './waakg-control.mjs';
import {verifiedOwnerPhone,classifyContact,hasExistingClientRelationship} from './whatsapp-roles.mjs';
import {personalPhone} from './personal-concierge.mjs';
import {conversationAuthorized,operatorOffer} from './operator-outreach.mjs';

const TARGET='5515981817336';
db.exec("CREATE TABLE IF NOT EXISTS owner_price_demos(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,state TEXT NOT NULL,choice TEXT,created_at TEXT NOT NULL)");
db.exec(`CREATE TABLE IF NOT EXISTS owner_price_approvals(
 id TEXT PRIMARY KEY,lead_id TEXT NOT NULL REFERENCES leads(id),provider_id TEXT UNIQUE NOT NULL,
 session_id TEXT NOT NULL,phone TEXT NOT NULL,lead_stage TEXT NOT NULL,question TEXT NOT NULL,
 suggested_price INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'PENDING',notice_state TEXT NOT NULL DEFAULT 'PENDING',
 price INTEGER,decision_provider_id TEXT UNIQUE,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,updated_at TEXT NOT NULL,error TEXT)`);
run("UPDATE owner_price_approvals SET state='UNKNOWN',error='Interrupted; verify delivery' WHERE state='SENDING'");
run("UPDATE owner_price_approvals SET notice_state='UNKNOWN' WHERE notice_state='SENDING'");
if(!all('PRAGMA table_info(owner_price_approvals)').some(c=>c.name==='buttons_state'))db.exec("ALTER TABLE owner_price_approvals ADD COLUMN buttons_state TEXT NOT NULL DEFAULT 'PENDING'");
run("UPDATE owner_price_approvals SET buttons_state='UNKNOWN' WHERE buttons_state='SENDING'");
const clock=deps=>deps.nowMs?.()??Date.now();
const selected=deps=>deps.selectedSession?.()??selectedWaSession();
const configured=()=>verifiedOwnerPhone()===TARGET&&(personalPhone()||verifiedOwnerPhone())===TARGET;
function eligible(r,deps={}){
 const l=one('SELECT l.*,t.manual_takeover FROM leads l JOIN threads t ON t.lead_id=l.id WHERE l.id=?',r.lead_id);
 const trigger=one("SELECT m.rowid,m.thread_id FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.lead_id=? AND m.provider_id=? AND m.direction='in'",r.lead_id,r.provider_id||'');
 if(trigger&&one("SELECT 1 FROM messages WHERE thread_id=? AND direction='in' AND rowid>? LIMIT 1",trigger.thread_id,trigger.rowid))return false;
 return !!l&&l.phone===r.phone&&l.stage===r.lead_stage&&!l.manual_takeover&&
 !['CLOSED_WON','CLOSED_LOST','OPTED_OUT','BLOCKED'].includes(l.stage)&&l.phone!==TARGET&&
 !hasExistingClientRelationship(l.phone)&&!one('SELECT 1 FROM suppressions WHERE phone=?',l.phone)&&
 conversationAuthorized(l.id)&&(deps.isEligible?deps.isEligible(l,r)===true:true);
}
export function requestPriceApproval(input={},deps={}){
 const prior=one('SELECT * FROM owner_price_approvals WHERE provider_id=?',String(input.providerId||''));
 if(prior)return {ok:prior.lead_id===input.leadId,request:prior};
 const lead=one('SELECT * FROM leads WHERE id=?',String(input.leadId||''));
 const session=input.sessionId||selected(deps);
 const base={lead_id:lead?.id,phone:lead?.phone,lead_stage:lead?.stage};
 if(!configured()||!input.providerId||!lead?.phone||!session||session!==selected(deps)||!eligible(base,deps))return {ok:false,message:'Conversa indisponível para aprovação.'};
 const pending=one("SELECT * FROM owner_price_approvals WHERE lead_id=? AND state='PENDING' AND expires_at>?",lead.id,new Date(clock(deps)).toISOString());
 if(pending&&eligible(pending,deps))return {ok:true,request:pending};
 if(pending)run("UPDATE owner_price_approvals SET state='INVALIDATED',updated_at=? WHERE id=? AND state='PENDING'",now(),pending.id);
 const requestId=id(),at=new Date(clock(deps)).toISOString();
 const suggested=({portfolio:350,promotion:550,corporate:1500})[operatorOffer(lead.id)]||550;
 run('INSERT INTO owner_price_approvals(id,lead_id,provider_id,session_id,phone,lead_stage,question,suggested_price,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',requestId,lead.id,String(input.providerId),session,lead.phone,lead.stage,String(input.question||input.inbound||'Pedido de proposta').slice(0,1200),[350,550,1500].includes(input.suggestedPrice)?input.suggestedPrice:suggested,at,new Date(clock(deps)+24*3600000).toISOString(),at);
 audit('PRICE_APPROVAL_REQUESTED',lead.id,{requestId});
 return {ok:true,request:one('SELECT * FROM owner_price_approvals WHERE id=?',requestId)};
}
export function approvedPriceForLead(leadId){return one("SELECT price FROM owner_price_approvals WHERE lead_id=? AND state='APPROVED' ORDER BY rowid DESC LIMIT 1",leadId)?.price??null;}
export function priceQuote(price){
 if(![350,550,1500].includes(price))throw Error('Preço inválido');
 return `Para o seu projeto, a proposta é de R$ ${price}, com 50% para iniciar (R$ ${price/2}) e 50% na entrega (R$ ${price/2}). O prazo mínimo é de 4 dias; o prazo final depende do escopo combinado. Podemos alinhar os detalhes?`;
}
const pathFor=(session,jid,kind)=>'/api/messages/'+encodeURIComponent(session)+'/'+encodeURIComponent(jid)+'/'+kind;
const safeUrl=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}};
function leadLinks(lead){
 const links=[];if(lead.website&&safeUrl(lead.website))links.push('Site: '+safeUrl(lead.website));
 if(/^[a-zA-Z0-9._]{1,30}$/.test(lead.instagram||''))links.push('Instagram: https://www.instagram.com/'+lead.instagram+'/');
 const mapsUrl=value=>{const u=safeUrl(value);if(!u)return null;const parsed=new URL(u);return /^(?:(?:www\.|maps\.)?google\.[a-z.]+|maps\.app\.goo\.gl)$/.test(parsed.hostname)&&(parsed.hostname==='maps.app.goo.gl'||parsed.pathname.startsWith('/maps')||parsed.hostname.startsWith('maps.'))?u:null;};
 for(const origin of all('SELECT identity,details FROM lead_origins WHERE lead_id=?',lead.id)){
  const savedMaps=mapsUrl(origin.identity);if(savedMaps)links.push('Maps: '+savedMaps);
  let detail;try{detail=JSON.parse(origin.details);}catch{continue;}
  for(const key of ['mapsUrl','maps_url','googleMapsUrl','google_maps_url','url']){
   const u=mapsUrl(detail?.[key]);if(u)links.push('Maps: '+u);
  }
 }
 return [...new Set(links)].join('\n');
}
async function businessPhone(session,deps){
 const detail=deps.getSessionIdentity?null:await (deps.transmit||waRequest)('/api/sessions/'+encodeURIComponent(session));
 const raw=deps.getSessionIdentity?await deps.getSessionIdentity(session):(detail?.data?.me?.id||detail?.data?.me?.jid);
 const value=String(raw||'');if(!/^\d{10,15}(?::\d+)?@s\.whatsapp\.net$/.test(value))return null;
 return value.split('@')[0].split(':')[0];
}
export async function flushPriceApprovals(deps={}){
 if(!configured())return {sent:0};
 const transmit=deps.transmit||waRequest;let sent=0;
 for(const r of all("SELECT * FROM owner_price_approvals WHERE state='PENDING' AND notice_state='PENDING' ORDER BY created_at LIMIT 20")){
  if(Date.parse(r.expires_at)<=clock(deps)||!eligible(r,deps)||r.session_id!==selected(deps)){run("UPDATE owner_price_approvals SET state='INVALIDATED' WHERE id=?",r.id);continue;}
  const status=await (deps.getStatus||waControlStatus)();if(!status.connected||status.sessionId!==r.session_id)continue;
  let number;try{number=await businessPhone(r.session_id,deps);}catch{continue;}if(!number)continue;
  const lead=one('SELECT * FROM leads WHERE id=?',r.lead_id);
  const link=choice=>'https://wa.me/'+number+'?text='+encodeURIComponent('PRECO '+r.id+' '+choice);
  const body=`${lead.business}\nContato: ${lead.name||lead.business}\nTelefone: ${r.phone}\nhttps://wa.me/${r.phone}\n${leadLinks(lead)}\nPergunta: ${r.question}\nSugestão: R$ ${r.suggested_price} (portfólio: R$ 350; confirmar escopo).\n50% para iniciar, 50% na entrega. Prazo mínimo: 4 dias, conforme escopo.\n`+[350,550,1500,'RECUSAR','ASSUMIR'].map(x=>x+': '+link(x)).join('\n');
  if(!run("UPDATE owner_price_approvals SET notice_state='SENDING' WHERE id=? AND notice_state='PENDING' AND state='PENDING'",r.id).changes)continue;
  try{
   // Plain-text links are an intentional first part: they remain available even
   // if the recipient's WhatsApp client does not render native buttons.
   const response=await transmit(pathFor(r.session_id,TARGET+'@s.whatsapp.net','send'),{method:'POST',data:{message:{text:body}}});
   run('UPDATE owner_price_approvals SET notice_state=?,updated_at=? WHERE id=?',response?.status===true?'ACCEPTED':'UNKNOWN',now(),r.id);
   if(response?.status!==true)continue;
   sent++;
  }catch{run("UPDATE owner_price_approvals SET notice_state='UNKNOWN',updated_at=? WHERE id=?",now(),r.id);}
  const current=one('SELECT state,notice_state FROM owner_price_approvals WHERE id=?',r.id);
  if(current?.state!=='PENDING'||current.notice_state!=='ACCEPTED'||!eligible(r,deps))continue;
  if(!run("UPDATE owner_price_approvals SET buttons_state='SENDING' WHERE id=? AND buttons_state='PENDING' AND state='PENDING'",r.id).changes)continue;
  try{
   const response=await transmit(pathFor(r.session_id,TARGET+'@s.whatsapp.net','interactive'),{method:'POST',data:{title:'Aprovar proposta',body:'Empresa: '+lead.business+'\nQual valor você aprova? Entrada de 50%, saldo na entrega e prazo mínimo de quatro dias. Os links da mensagem anterior também funcionam.',footer:'Escolha válida somente para esta empresa',buttons:[350,550,1500].map(price=>({type:'quick_reply',id:'preco:'+r.id+':'+price,displayText:'R$ '+price}))}});
   run('UPDATE owner_price_approvals SET buttons_state=?,updated_at=? WHERE id=?',response?.status===true?'ACCEPTED':'UNKNOWN',now(),r.id);
  }catch{run("UPDATE owner_price_approvals SET buttons_state='UNKNOWN',updated_at=? WHERE id=?",now(),r.id);}
 }
 return {sent};
}
export async function processPriceDecision(event={},deps={}){
 const text=String(event.text||'').trim();
 const match=text.match(/^(?:preco:([a-f0-9-]{36}):(350|550|1500)|PRECO\s+([a-f0-9-]{36})\s+(350|550|1500|RECUSAR|ASSUMIR))$/i);
 if(!match)return {handled:false,ok:false};
 const fail=message=>({handled:true,ok:false,message});
 const identity=classifyContact(event);
 if(!configured()||identity.role!=='OWNER'||!identity.ownerTools||event.jid!==TARGET+'@s.whatsapp.net'||event.sessionId!==selected(deps)||!event.providerId)return fail('Aprovação não autorizada.');
 const requestId=match[1]||match[3],choice=(match[2]||match[4]).toUpperCase();
 const demo=one('SELECT * FROM owner_price_demos WHERE id=?',requestId);
 if(demo){
  if(demo.state!=='PENDING'||demo.session_id!==event.sessionId||clock(deps)-Date.parse(demo.created_at)>86400000)return fail('Demonstração já utilizada ou expirada.');
  if(!run("UPDATE owner_price_demos SET state='CONFIRMED',choice=? WHERE id=? AND state='PENDING'",choice,demo.id).changes)return fail('Demonstração já utilizada.');
  audit('OWNER_PRICE_DEMO_CONFIRMED',null,{choice});
  console.info('[owner price demo]',JSON.stringify({state:'CONFIRMED',choice,recipientSuffix:'7336',customerMessagesSent:0}));
  return {handled:true,ok:true,state:'DEMO_CONFIRMED',message:'Teste confirmado: '+(Number.isFinite(Number(choice))?'R$ '+choice:choice)+'. Nenhuma empresa recebeu mensagem neste teste.'};
 }
 const r=one('SELECT * FROM owner_price_approvals WHERE id=?',requestId);
 if(!r||r.state!=='PENDING'||r.session_id!==event.sessionId)return fail('Pedido já utilizado ou indisponível.');
 if(Date.parse(r.expires_at)<=clock(deps)||!eligible(r,deps)){run("UPDATE owner_price_approvals SET state='INVALIDATED' WHERE id=? AND state='PENDING'",r.id);return fail('Pedido expirado ou conversa alterada.');}
 if(one('SELECT 1 FROM owner_price_approvals WHERE decision_provider_id=?',event.providerId))return fail('Decisão já utilizada.');
 if(['RECUSAR','ASSUMIR'].includes(choice)){
  const state=choice==='RECUSAR'?'REJECTED':'HANDOFF';
  if(!run("UPDATE owner_price_approvals SET state=?,decision_provider_id=?,updated_at=? WHERE id=? AND state='PENDING'",state,event.providerId,now(),r.id).changes)return fail('Pedido já utilizado.');
  if(state==='HANDOFF')run('UPDATE threads SET manual_takeover=1 WHERE lead_id=?',r.lead_id);
  return {handled:true,ok:true,state,message:state==='HANDOFF'?'Conversa assumida.':'Proposta recusada.'};
 }
 const status=await (deps.getStatus||waControlStatus)();
 if(!status.connected||status.sessionId!==r.session_id||selected(deps)!==r.session_id||!eligible(r,deps))return fail('WhatsApp ou conversa indisponível.');
 const price=Number(choice),quote=priceQuote(price);
 if(!run("UPDATE owner_price_approvals SET state='SENDING',price=?,decision_provider_id=?,updated_at=? WHERE id=? AND state='PENDING'",price,event.providerId,now(),r.id).changes)return fail('Pedido já utilizado.');
 try{
  // Recheck after reservation and immediately before entering transport.
  if(!eligible(r,deps)||selected(deps)!==r.session_id){run("UPDATE owner_price_approvals SET state='INVALIDATED' WHERE id=?",r.id);return fail('Conversa alterada.');}
  const response=await (deps.transmit||waRequest)(pathFor(r.session_id,r.phone+'@s.whatsapp.net','send'),{method:'POST',data:{message:{text:quote}}});
  if(response?.status!==true)throw Error('Unconfirmed');
  run("UPDATE owner_price_approvals SET state='APPROVED',updated_at=? WHERE id=?",now(),r.id);
  const thread=getThread(r.lead_id,r.phone+'@s.whatsapp.net');addMessage({threadId:thread.id,providerId:'price-approval:'+r.id,direction:'out',body:quote,status:'accepted'});
  audit('PRICE_APPROVED_SENT',r.lead_id,{requestId:r.id,price});
  return {handled:true,ok:true,state:'APPROVED',message:'Proposta de R$ '+price+' aceita pelo gateway. Confira a conversa.'};
 }catch{run("UPDATE owner_price_approvals SET state='UNKNOWN',updated_at=?,error='Delivery uncertain; do not retry' WHERE id=?",now(),r.id);return fail('Entrega incerta. Confira a conversa antes de qualquer novo envio.');}
}

// Explicit owned-phone production check, separate from all customer records.
export async function sendOwnerPriceDemo(value,deps={}){
 const demoId=String(value||'').toLowerCase();
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(demoId))return {state:'INVALID_ID'};
 if(!configured())return {state:'OWNER_NOT_CONFIGURED'};
 if(one('SELECT id FROM owner_price_demos WHERE id=?',demoId))return {state:'ALREADY_ATTEMPTED'};
 const session=selected(deps),status=await (deps.getStatus||waControlStatus)();
 if(!session||!status.connected||status.sessionId!==session)return {state:'OFFLINE'};
 const number=await businessPhone(session,deps);if(!number||number===TARGET)return {state:'INVALID_SENDER'};
 if(!run("INSERT OR IGNORE INTO owner_price_demos(id,session_id,state,created_at) VALUES(?,?,'UNKNOWN',?)",demoId,session,new Date(clock(deps)).toISOString()).changes)return {state:'ALREADY_ATTEMPTED'};
 const transmit=deps.transmit||waRequest;
 const body='Teste autorizado das aprovações do Prospector. Empresa de demonstração: escolha um valor abaixo. Este teste não envia propostas a empresas reais.\n'+[350,550,1500].map(x=>'R$ '+x+': https://wa.me/'+number+'?text='+encodeURIComponent('PRECO '+demoId+' '+x)).join('\n');
 try{
  const text=await transmit(pathFor(session,TARGET+'@s.whatsapp.net','send'),{method:'POST',data:{message:{text:body}}});if(text?.status!==true)return {state:'UNKNOWN'};
  run("UPDATE owner_price_demos SET state='PENDING' WHERE id=?",demoId);
  const buttons=await transmit(pathFor(session,TARGET+'@s.whatsapp.net','interactive'),{method:'POST',data:{title:'Teste de aprovação',body:'Empresa de demonstração: qual valor você aprova? Você também pode usar os links da mensagem anterior. Nenhuma empresa será contatada.',buttons:[350,550,1500].map(x=>({type:'quick_reply',displayText:'R$ '+x,id:'preco:'+demoId+':'+x}))}});
  return {state:buttons?.status===true?'SENT':'TEXT_ACCEPTED_BUTTONS_UNKNOWN',recipientSuffix:'7336',customerMessagesSent:0};
 }catch{return {state:one('SELECT state FROM owner_price_demos WHERE id=?',demoId)?.state==='PENDING'?'TEXT_ACCEPTED_BUTTONS_UNKNOWN':'UNKNOWN',recipientSuffix:'7336',customerMessagesSent:0};}
}
