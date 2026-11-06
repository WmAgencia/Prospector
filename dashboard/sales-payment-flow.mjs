// Verified-eligibility payment handoff for tenant-approved agreements.
// A receipt is evidence of a claim, NEVER proof of settled funds.
import {db,one,all,run,now,audit,addMessage,getThread,stage} from './db.mjs';
import {recordSalesOutcome} from './sales-outcomes.mjs';
import {configuredClosing,pixProposal} from './training-sales-extras.mjs';
import {readActiveTrainingMarkdown} from './training.mjs';
import {approvedPriceForLead} from './owner-price-approvals.mjs';
import {operatorOffer} from './operator-outreach.mjs';
import {prospectorChatEligible} from './whatsapp-roles.mjs';
import {leadSession,isManagedSession} from './waakg-session-registry.mjs';
import {queueNotice} from './notifications.mjs';
import {paymentMethodChosen,fullPaymentChosen} from './francisca-payment-intent.mjs';
import {recallConversationMemory} from './francisca-conversation-memory.mjs';

db.exec("CREATE TABLE IF NOT EXISTS sales_payment_intents(lead_id TEXT PRIMARY KEY,provider_id TEXT UNIQUE NOT NULL,session_id TEXT NOT NULL,amount_cents INTEGER NOT NULL,entry_cents INTEGER NOT NULL,remaining_cents INTEGER NOT NULL,method TEXT NOT NULL,status TEXT NOT NULL,receipt_provider_id TEXT UNIQUE,requested_at TEXT NOT NULL,receipt_at TEXT,verified_at TEXT,updated_at TEXT NOT NULL)");
run("UPDATE sales_payment_intents SET status='DELIVERY_UNKNOWN',updated_at=? WHERE status='SENDING'",now());
export function paymentIntentStatus(leadId){const r=one('SELECT lead_id,amount_cents,entry_cents,remaining_cents,status,receipt_at,verified_at FROM sales_payment_intents WHERE lead_id=?',String(leadId||''));return r||null;}
export function salesPaymentQueue(){
 return all("SELECT p.lead_id,p.amount_cents,p.entry_cents,p.remaining_cents,p.status,p.receipt_at,p.verified_at,l.business,l.phone FROM sales_payment_intents p JOIN leads l ON l.id=p.lead_id WHERE p.status IN ('RECEIPT_RECEIVED','PAYMENT_VERIFIED','DELIVERY_UNKNOWN') ORDER BY p.updated_at DESC LIMIT 50");
}
// Negotiating or saying "quero fechar" must NOT send PIX automatically.
// A payment method choice or explicit PIX request is required.
function singleApprovedPrice(markdown=''){
 const s=String(markdown).split('## Serviços, entregas e preços aprovados')[1]?.split('## Fluxo comercial')[0]||'';
 if((s.match(/^### [0-9]+\./gm)||[]).length!==1)return null;
 const line=s.split('\n').find(x=>x.trim().startsWith('- **Valor permitido na conversa:**'));
 if(!line)return null;
 const value=line.split('** ').slice(1).join('** ').trim();
 const m=/^R\$\s*(\d+(?:\.\d{3})*(?:,\d{2})?)$/.exec(value);
 if(!m)return null;
 const amount=Number(m[1].replace(/\./g,'').replace(',','.'));
 const cents=Math.round(amount*100);
 return Number.isSafeInteger(cents)&&cents>=100&&cents<=500000000?cents:null;
}
function priceForLead(leadId){
 const price=approvedPriceForLead(leadId);
 if(Number.isSafeInteger(price)&&price>=1&&price<=5000000)return price*100;
 // The internal Consecom offer is the one fixed offer approved at R$550.
 if((process.env.PROSPECTOR_TENANT_INTERNAL==='true'||!process.env.PROSPECTOR_TENANT_ID)&&operatorOffer(leadId)==='portfolio'&&
    readActiveTrainingMarkdown()?.includes('R$ 550'))return 55000;
 return singleApprovedPrice(readActiveTrainingMarkdown()||'');
}
export function paymentProposalForIncoming({leadId,jid,sessionId,providerId,text}={}){
 const config=configuredClosing();
 if(!config||config.mode!=='complete'||!paymentMethodChosen(text))return {eligible:false,reason:'NOT_CLOSING_INTENT'};
 if(!prospectorChatEligible({jid,sessionId})||!isManagedSession(sessionId)||leadSession(leadId)!==sessionId)
  return {eligible:false,reason:'NOT_ELIGIBLE'};
 const price=priceForLead(leadId);
 if(!price)return {eligible:false,reason:'PRICE_NOT_VERIFIED'};
 // If an alternative offer was discussed, no implicit return to the R$550
 // base price. Require explicit lead-specific owner price approval.
 const approvedForLead=approvedPriceForLead(leadId);
 if(!approvedForLead){
  const threadId=one('SELECT id FROM threads WHERE lead_id=? LIMIT 1',leadId)?.id;
  if(threadId&&recallConversationMemory(threadId).alternativeOfferDiscussed===true)
   return {eligible:false,reason:'ALTERNATIVE_OFFER_NEEDS_PRICE_APPROVAL'};
  const offerHistory=all("SELECT m.body FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.lead_id=? AND m.direction='out' ORDER BY m.rowid DESC LIMIT 60",leadId);
  if(offerHistory.some(m=>/R\$\s*(?:450|750|2[.]?800)(?:[,.\s]|$)/i.test(String(m.body||''))))
   return {eligible:false,reason:'ALTERNATIVE_OFFER_NEEDS_PRICE_APPROVAL'};
 }
 const offer=pixProposal({amountCents:price,service:'o projeto combinado',fullPayment:fullPaymentChosen(text)});
 if(!offer)return {eligible:false,reason:'PAYMENT_METHOD_NOT_READY'};
 const previous=one('SELECT status FROM sales_payment_intents WHERE lead_id=?',leadId);
 if(previous)return {eligible:false,reason:'PAYMENT_ALREADY_STARTED',status:previous.status};
 return {eligible:true,offer,providerId,leadId,sessionId,jid};
}
// Delivery reservation before calling WhatsApp avoids duplicates on timeouts/restarts.
export function reservePaymentProposal(plan){
 if(!plan?.eligible)return false;
 const t=now();
 const result=run("INSERT OR IGNORE INTO sales_payment_intents(lead_id,provider_id,session_id,amount_cents,entry_cents,remaining_cents,method,status,requested_at,updated_at) VALUES(?,?,?,?,?,?,?,'SENDING',?,?)",
 plan.leadId,plan.providerId,plan.sessionId,plan.offer.amountCents,plan.offer.entryCents,plan.offer.remainingCents,'pix',t,t);
 return result.changes===1;
}
export function paymentProposalSent(plan,threadId){
 const changed=run("UPDATE sales_payment_intents SET status='AWAITING_RECEIPT',updated_at=? WHERE lead_id=? AND provider_id=? AND status='SENDING'",now(),plan.leadId,plan.providerId);
 if(!changed.changes)return false;
 addMessage({threadId,providerId:'payment:'+plan.providerId,direction:'out',body:plan.offer.text,status:'sent'});
 audit('PIX_ENTRY_REQUESTED',plan.leadId,{entryCents:plan.offer.entryCents,totalCents:plan.offer.amountCents});
 return true;
}
export function paymentDeliveryUnknown(plan){
 run("UPDATE sales_payment_intents SET status='DELIVERY_UNKNOWN',updated_at=? WHERE lead_id=? AND provider_id=? AND status='SENDING'",now(),plan.leadId,plan.providerId);
 audit('PIX_SEND_UNCERTAIN',plan.leadId,{requiresReview:true});
}
export function recordReceiptMedia({leadId,jid,sessionId,providerId,mimeType='image',mediaUrl=''}={}){
 const row=one('SELECT * FROM sales_payment_intents WHERE lead_id=?',String(leadId||''));
 if(!row||!['AWAITING_RECEIPT','RECEIPT_RECEIVED'].includes(row.status))return {recorded:false,reason:'NO_PENDING_PAYMENT'};
 if(!prospectorChatEligible({jid,sessionId})||row.session_id!==sessionId||leadSession(leadId)!==sessionId)
  return {recorded:false,reason:'NOT_ELIGIBLE'};
 if(row.receipt_provider_id)return {recorded:false,reason:'ALREADY_RECEIVED'};
 if(!/^(?:image|document|pdf)$/i.test(mimeType))return {recorded:false,reason:'UNSUPPORTED_MEDIA'};
 const updated=run("UPDATE sales_payment_intents SET status='RECEIPT_RECEIVED',receipt_provider_id=?,receipt_at=?,updated_at=? WHERE lead_id=? AND status='AWAITING_RECEIPT' AND receipt_provider_id IS NULL",providerId,now(),now(),leadId);
 if(!updated.changes)return {recorded:false,reason:'ALREADY_PROCESSED'};
 const lead=one('SELECT business,phone FROM leads WHERE id=?',leadId)||{};
 // Any image/document could be a photograph or unrelated file. Treat it as
 // evidence requiring owner review, never as a paid or closed sale.
 const thread=getThread(leadId,jid);
 addMessage({threadId:thread.id,providerId,direction:'in',type:'document',body:'[Arquivo recebido durante cobrança — conferência necessária]',status:'received'});
 run('UPDATE threads SET manual_takeover=1 WHERE id=?',thread.id);
 audit('PAYMENT_MEDIA_REVIEW_REQUIRED',leadId,{providerId,mimeType});
 queueNotice('payment-receipt:'+leadId+':'+providerId,'PAYMENT_RECEIPT',
 '🔎 Arquivo recebido após pedido de PIX — conferir conteúdo e pagamento\nEmpresa: '+String(lead.business||'').slice(0,100)+
 '\nContato: '+String(lead.phone||'').slice(0,18)+
 '\nEntrada combinada: '+(row.entry_cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+
 '\nA Francisca registrou o fechamento comercial. Abra a conversa para visualizar o arquivo recebido; a liquidação bancária não foi verificada.\nWhatsApp: https://wa.me/'+String(lead.phone||''),leadId);
 audit('SALES_RECEIPT_RECEIVED_UNVERIFIED',leadId,{mediaType:mimeType,providerId});
 return {recorded:true,status:'RECEIPT_RECEIVED',commerciallyClosed:false,verified:false,reviewRequired:true};
}
export function confirmPayment(leadId,{paymentVerified=false,reference=''}={}){
 if(paymentVerified!==true||String(reference).trim().length<4)throw Error('A confirmação precisa de referência verificável do recebimento.');
 const row=one('SELECT * FROM sales_payment_intents WHERE lead_id=?',String(leadId||''));
 if(!row||row.status!=='RECEIPT_RECEIVED')throw Error('Não há comprovante pendente para conferir.');
 const updated=run("UPDATE sales_payment_intents SET status='PAYMENT_VERIFIED',verified_at=?,updated_at=? WHERE lead_id=? AND status='RECEIPT_RECEIVED'",now(),now(),leadId);
 if(updated.changes){
  stage(leadId,'CLOSED_WON','OWNER_VERIFIED_PAYMENT');
  recordSalesOutcome({leadId,status:'CLOSED_WON',providerId:row.receipt_provider_id||row.provider_id,evidence:'Pagamento conferido pelo owner',source:'PAYMENT_VERIFIED',notify:false});
  audit('SALES_PAYMENT_VERIFIED',leadId,{hasReference:true,entryCents:row.entry_cents});
 }
 return {verified:updated.changes===1};
}
