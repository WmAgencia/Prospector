// Persisted, idempotent commercial results for the WA-AKG prospect queue.
import {db,one,all,run,now,audit} from './db.mjs';
import {queueNotice} from './notifications.mjs';
import {SITE_AVERAGE_PRICE_BRL} from './sales-policy.mjs';
db.exec("CREATE TABLE IF NOT EXISTS sales_outcomes(lead_id TEXT PRIMARY KEY REFERENCES leads(id),status TEXT NOT NULL CHECK(status IN ('INTERESTED','NO_INTEREST','OPT_OUT','HUMAN_REVIEW','CLOSED_WON')),source TEXT NOT NULL,provider_id TEXT,summary TEXT NOT NULL,updated_at TEXT NOT NULL)");
db.exec("CREATE INDEX IF NOT EXISTS idx_sales_outcomes_time ON sales_outcomes(updated_at)");
const allowed=new Set(['INTERESTED','NO_INTEREST','OPT_OUT','HUMAN_REVIEW','CLOSED_WON']);
const plain=s=>String(s||'').replace(/[\r\n\t<>]/g,' ').replace(/\s+/g,' ').trim();
export function salesOutcomes({limit=80}={}){
 const count=Math.max(1,Math.min(150,Number(limit)||80));
 return {priceReferenceBrl:SITE_AVERAGE_PRICE_BRL,items:all(
 "SELECT s.lead_id,s.status,s.source,s.summary,s.updated_at,l.business,l.city,l.segment,l.phone FROM sales_outcomes s JOIN leads l ON l.id=s.lead_id ORDER BY s.updated_at DESC LIMIT ?",count),
 counts:Object.fromEntries(all("SELECT status,COUNT(*) n FROM sales_outcomes GROUP BY status").map(x=>[x.status,x.n]))};
}
export function recordSalesOutcome({leadId,status,providerId='',evidence='',source='WA_AKG',notify=true}={}){
 if(!allowed.has(status))throw Error('INVALID_SALES_OUTCOME');
 const lead=one('SELECT id,business,phone,stage FROM leads WHERE id=?',String(leadId||''));
 if(!lead?.phone)return {ok:false,reason:'LEAD_NOT_FOUND'};
 const prior=one('SELECT status,updated_at FROM sales_outcomes WHERE lead_id=?',lead.id);
 // Opt-out supersedes every commercial result. A sale cannot be downgraded.
 if(prior&&prior.status!==status&&status!=='OPT_OUT'){
  if(['OPT_OUT','CLOSED_WON'].includes(prior.status))return {ok:false,reason:'TERMINAL_OUTCOME'};
  if(prior.status==='NO_INTEREST'){
   const inbound=providerId&&one("SELECT m.at FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.lead_id=? AND m.provider_id=? AND m.direction='in'",lead.id,providerId);
   const renewed=['INTERESTED','CLOSED_WON','HUMAN_REVIEW'].includes(status)&&['CONVERSING','INTERESTED'].includes(lead.stage)&&
    inbound&&Date.parse(inbound.at)>Date.parse(prior.updated_at)&&!one('SELECT phone FROM suppressions WHERE phone=?',lead.phone);
   const manualSale=status==='CLOSED_WON'&&source==='PRODUCTION'&&lead.stage==='CLOSED_WON'&&
    !one('SELECT phone FROM suppressions WHERE phone=?',lead.phone);
   if(!renewed&&!manualSale)return {ok:false,reason:'TERMINAL_OUTCOME'};
  }
 }
 if(prior?.status===status)return {ok:true,duplicate:true,status};
 const note=plain(evidence).slice(0,230);
 const summary=note||status.replaceAll('_',' ');
 run("INSERT INTO sales_outcomes(lead_id,status,source,provider_id,summary,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(lead_id) DO UPDATE SET status=excluded.status,source=excluded.source,provider_id=excluded.provider_id,summary=excluded.summary,updated_at=excluded.updated_at",
  lead.id,status,plain(source).slice(0,50),plain(providerId).slice(0,180),summary,now());
 audit('SALES_OUTCOME_RECORDED',lead.id,{status,source,hasEvidence:!!note});
 if(notify){
  const text=[
   status==='INTERESTED'?'⭐ *Prospector — interessado*':
   status==='NO_INTEREST'?'📋 *Prospector — sem interesse*':
   status==='OPT_OUT'?'🛑 *Prospector — não contatar*':
   status==='CLOSED_WON'?'✅ *Prospector — venda confirmada*':
   '👤 *Prospector — precisa de atendimento humano*',
   'Empresa: '+plain(lead.business).slice(0,100),
   'Resultado: '+status.replaceAll('_',' '),
   'Trecho: '+summary,
   'Referência de site: R$ '+SITE_AVERAGE_PRICE_BRL+' (valor médio, não proposta fechada)',
   'Conversa: https://wa.me/'+lead.phone,
   'Próximo passo: '+(status==='INTERESTED'?'validar escopo e proposta':
      status==='HUMAN_REVIEW'?'assumir a conversa':
      status==='NO_INTEREST'||status==='OPT_OUT'?'não insistir':'conferir confirmação comercial')
  ].join('\n');
  queueNotice('sales-outcome:'+lead.id+':'+status,'SALES_OUTCOME',text,lead.id);
 }
 return {ok:true,status,created:!prior};
}
