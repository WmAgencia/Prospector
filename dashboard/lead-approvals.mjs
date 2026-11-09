// Manual opt-in curation, stored inside the authenticated client's SQLite workspace.
// This module never sends WhatsApp messages, changes the outreach pause, or grants
// permission merely because a lead came from a public directory.
import {all,one,run,tx,id,audit} from './db.mjs';

const CHANNELS=new Set(['PERSONAL_WHATSAPP','PHONE_CALL','OTHER']);
const PROOF_SQL="EXISTS(SELECT 1 FROM audit a WHERE a.lead_id=l.id AND a.action='CONSENT_UPDATED' AND json_extract(a.detail,'$.permitted')=1 AND COALESCE(json_extract(a.detail,'$.evidence'),'')<>'')";
const STATUS_SQL="CASE "+
 "WHEN EXISTS(SELECT 1 FROM suppressions s WHERE s.phone=l.phone) THEN 'BLOCKED' "+
 "WHEN EXISTS(SELECT 1 FROM contact_relationships cr WHERE cr.phone=l.phone AND cr.kind='EXISTING_CLIENT') THEN 'BLOCKED' "+
 "WHEN l.contact_permission=1 AND "+PROOF_SQL+" THEN 'AUTHORIZED' "+
 "ELSE 'PENDING' END";
const BASE_SQL="SELECT l.id,l.business,l.name,l.phone,l.source,l.city,l.stage,l.created_at,l.contact_permission,"+
 STATUS_SQL+" AS approval_status FROM leads l WHERE l.phone IS NOT NULL";

export function listLeadApprovals({status='PENDING',limit=40,offset=0}={}){
 if(!['PENDING','AUTHORIZED','BLOCKED','ALL'].includes(status))throw Error('Filtro de aprovações inválido');
 const size=Number(limit),skip=Number(offset);
 if(!Number.isInteger(size)||size<1||size>50||!Number.isInteger(skip)||skip<0||skip>100000)throw Error('Paginação inválida');
 const allRows=all(BASE_SQL+" ORDER BY l.created_at DESC LIMIT 20000");
 const totals={pending:0,authorized:0,blocked:0};
 for(const r of allRows){
  if(r.approval_status==='AUTHORIZED')totals.authorized++;
  else if(r.approval_status==='BLOCKED')totals.blocked++;
  else totals.pending++;
 }
 const filtered=status==='ALL'?allRows:allRows.filter(r=>r.approval_status===status);
 return {totals,total:filtered.length,status,limit:size,offset:skip,
  items:filtered.slice(skip,skip+size).map(({contact_permission,...lead})=>{
   if(lead.approval_status!=='AUTHORIZED')return lead;
   const last=one("SELECT at,detail FROM audit WHERE lead_id=? AND action='CONSENT_UPDATED' AND json_extract(detail,'$.permitted')=1 AND COALESCE(json_extract(detail,'$.evidence'),'')<>'' ORDER BY at DESC LIMIT 1",lead.id);
   if(!last)return lead;
   let details={};try{details=JSON.parse(last.detail);}catch{}
   return {...lead,consentRecord:{recordedAt:last.at,consentAt:details.consentAt||last.at,
    channel:details.channel||'OTHER',sourcePhone:details.sourcePhone||'',evidence:details.evidence||'',
    batchId:details.batchId||null}};
  })};
}

export function approveLeadBatch(input={}){
 const entries=input.items;
 if(!Array.isArray(entries)||entries.length===0||entries.length>50)throw Error('Selecione de 1 a 50 contatos');
 if(input.confirmedByOperator!==true)throw Error('Confirme que cada contato selecionado autorizou a abordagem');
 const ids=new Set(),approved=[];
 const submittedAt=Date.now(),batchId=id();
 for(const item of entries){
  const leadId=String(item?.leadId||'').trim();
  const evidence=String(item?.evidence||'').trim();
  const channel=String(item?.channel||'').trim();
  const sourcePhone=String(item?.operatorPhone||'').replace(/\D/g,'');
  const consentAt=String(item?.consentAt||'');
  const consentTime=Date.parse(consentAt);
  if(!/^[\da-f-]{36}$/i.test(leadId)||ids.has(leadId))throw Error('Contato inválido ou duplicado no lote');
  ids.add(leadId);
  if(evidence.length<3||evidence.length>1000)throw Error('Cada contato precisa de evidência individual (3 a 1000 caracteres)');
  if(!CHANNELS.has(channel))throw Error('Informe o canal da autorização de cada contato');
  if(!/^55\d{10,11}$/.test(sourcePhone))throw Error('Informe o número brasileiro usado para obter a autorização, com DDD');
  if(!Number.isFinite(consentTime)||consentTime>submittedAt+5*60*1000||consentTime<submittedAt-366*24*3600*1000)throw Error('Informe uma data de autorização válida (últimos 366 dias)');
  approved.push({leadId,evidence,channel,sourcePhone,consentAt:new Date(consentTime).toISOString()});
 }
 return tx(()=>{
  // Prevalidate all rows: no partial approval if one contact is missing or blocked.
  for(const item of approved){
   const lead=one('SELECT id,phone,contact_permission FROM leads WHERE id=?',item.leadId);
   if(!lead?.phone)throw Error('Um dos contatos não existe ou não possui WhatsApp');
   if(one('SELECT phone FROM suppressions WHERE phone=?',lead.phone))throw Error('Contato bloqueado para novas mensagens');
   if(one("SELECT phone FROM contact_relationships WHERE phone=? AND kind='EXISTING_CLIENT'",lead.phone))throw Error('Cliente existente não pode ser aprovado como prospecção');
   if(lead.contact_permission===1&&one("SELECT id FROM audit WHERE lead_id=? AND action='CONSENT_UPDATED' AND json_extract(detail,'$.permitted')=1 AND COALESCE(json_extract(detail,'$.evidence'),'')<>'' LIMIT 1",lead.id))throw Error('Um dos contatos já está autorizado. Atualize a lista');
  }
  for(const item of approved){
   run('UPDATE leads SET contact_permission=1 WHERE id=?',item.leadId);
   audit('CONSENT_UPDATED',item.leadId,{
    permitted:true,evidence:item.evidence,method:'manual_batch_curation',
    channel:item.channel,sourcePhone:item.sourcePhone,consentAt:item.consentAt,batchId,
    workspace:process.env.PROSPECTOR_TENANT_ID||'PRIMARY'
   });
  }
  audit('CONSENT_BATCH_APPROVED',null,{
   batchId,quantity:approved.length,leadIds:approved.map(x=>x.leadId),
   method:'manual_batch_curation',workspace:process.env.PROSPECTOR_TENANT_ID||'PRIMARY'
  });
  return {ok:true,batchId,approved:approved.length,leadIds:approved.map(x=>x.leadId)};
 });
}
