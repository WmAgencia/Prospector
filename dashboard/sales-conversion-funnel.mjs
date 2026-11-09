// Read-only conversion funnel, tenant-local. All counts are unique leads,
// across the entire recorded period. Rates are conditional cohort rates,
// NOT inflated by page views, bot greetings or unverified checkout intents.
import {all,one} from './db.mjs';
import {detectAutomaticReply} from './portfolio-offer-550.mjs';
import {qualityRecommendations} from './francisca-commercial-brain.mjs';

const percent=(count,base)=>base>0?Math.round(count*10000/base)/100:null;
const latestRows=(sql,...params)=>all(sql,...params);
export function salesConversionFunnel(){
 // Avoid confusing a drafted/scheduled/unknown send with a confirmed send.
 const sent=latestRows("SELECT c.lead_id FROM initial_contacts c WHERE c.status='SENT'");
 const deliveredIds=new Set(sent.map(x=>x.lead_id).filter(Boolean));
 const replyIds=new Set();
 // Query only members of the confirmed-contact cohort; messages may include
 // multiple turns and automated WhatsApp greetings.
 const inbound=latestRows("SELECT t.lead_id,m.body FROM messages m JOIN threads t ON t.id=m.thread_id JOIN initial_contacts c ON c.lead_id=t.lead_id AND c.status='SENT' WHERE m.direction='in' ORDER BY m.rowid DESC LIMIT 25000");
 for(const m of inbound){
  if(deliveredIds.has(m.lead_id)&&!detectAutomaticReply(m.body||'')&&String(m.body||'').trim())replyIds.add(m.lead_id);
 }
 const qualifiedIds=new Set();
 const results=latestRows("SELECT lead_id,status FROM sales_outcomes WHERE status IN ('INTERESTED','HUMAN_REVIEW','CLOSED_WON')");
 for(const row of results)if(replyIds.has(row.lead_id)&&['INTERESTED','CLOSED_WON'].includes(row.status))qualifiedIds.add(row.lead_id);
 // A lead may have changed stage without a sales_outcome record.
 for(const row of latestRows("SELECT id FROM leads WHERE stage IN ('INTERESTED','CLOSED_WON')"))if(replyIds.has(row.id))qualifiedIds.add(row.id);
 const paymentIntentIds=new Set();
 try{
  for(const row of latestRows("SELECT lead_id FROM sales_payment_intents WHERE status IN ('AWAITING_RECEIPT','RECEIPT_RECEIVED','PAYMENT_VERIFIED')"))
   if(replyIds.has(row.lead_id))paymentIntentIds.add(row.lead_id);
 }catch{/* no payment-intents table in older tenant database */}
 // A qualified opportunity is not the same as a payment proposal; proposals
 // are tracked separately and may have been made before qualified handoff.
 const confirmedSales=new Set();
 for(const row of latestRows("SELECT lead_id FROM sales_outcomes WHERE status='CLOSED_WON'"))if(replyIds.has(row.lead_id))confirmedSales.add(row.lead_id);
 const optoutIds=new Set();
 for(const row of latestRows("SELECT lead_id FROM sales_outcomes WHERE status='OPT_OUT'"))if(deliveredIds.has(row.lead_id))optoutIds.add(row.lead_id);
 const handoffIds=new Set();
 for(const row of latestRows("SELECT lead_id FROM sales_outcomes WHERE status='HUMAN_REVIEW'"))if(replyIds.has(row.lead_id))handoffIds.add(row.lead_id);
 const delivered=deliveredIds.size,replied=replyIds.size,qualified=qualifiedIds.size,
  proposed=paymentIntentIds.size,won=confirmedSales.size,optout=optoutIds.size,handoff=handoffIds.size;
 const ratios={
  replyPct:percent(replied,delivered),
  qualifiedFromRepliedPct:percent(qualified,replied),
  proposedFromRepliedPct:percent(proposed,replied),
  wonFromQualifiedPct:percent([...confirmedSales].filter(id=>qualifiedIds.has(id)).length,qualified),
  wonFromDeliveredPct:percent(won,delivered),
  optoutFromDeliveredPct:percent(optout,delivered)
 };
 const summary={period:'all_recorded',delivered,replied,qualified,proposed,won,optout,handoff,ratios,
  definitions:{
   delivered:'Primeiros contatos com status SENT confirmado pelo Prospector.',
   replied:'Contatos enviados que responderam com ao menos uma mensagem de texto não classificada como automática.',
   qualified:'Respondidos com interesse registrado ou estágio interessado/fechado.',
   proposed:'Respondidos com intenção de pagamento registrada (não significa aceite ou pagamento).',
   won:'Respondidos com resultado CLOSED_WON registrado por confirmação comercial.',
   optedOut:'Contatos com solicitação de não contato registrada.',
   handoff:'Conversas encaminhadas para revisão humana.'
  },
  caveats:['Histórico integral registrado, sem equivalência estatística com campanha A/B por período.',
   'Mensagens antigas, áudio não transcrito ou campanhas anteriores podem não ser contabilizados.',
   'Intenção ou comprovante não significam dinheiro recebido; confirme o financeiro separadamente.']};
 return {...summary,recommendations:qualityRecommendations(summary)};
}
