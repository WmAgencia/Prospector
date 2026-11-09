// Manual opt-in curation, stored inside the authenticated client's SQLite workspace.
// This module never sends WhatsApp messages, changes the outreach pause, or grants
// permission merely because a lead came from a public directory.
import {all,one,run,tx,id,audit} from './db.mjs';
import {verifiedOwnerPhone} from './whatsapp-roles.mjs';
import {isExcludedTestContact,excludedTestPhoneSql} from './test-contact-exclusion.mjs';

const CHANNELS=new Set(['PERSONAL_WHATSAPP','PHONE_CALL','OTHER']);
const PROOF_SQL="EXISTS(SELECT 1 FROM audit a WHERE a.lead_id=l.id AND a.action='CONSENT_UPDATED' AND json_extract(a.detail,'$.permitted')=1 AND COALESCE(json_extract(a.detail,'$.evidence'),'')<>'')";
const STATUS_SQL="CASE "+
 "WHEN EXISTS(SELECT 1 FROM suppressions s WHERE s.phone=l.phone) THEN 'BLOCKED' "+
 "WHEN EXISTS(SELECT 1 FROM contact_relationships cr WHERE cr.phone=l.phone AND cr.kind='EXISTING_CLIENT') THEN 'BLOCKED' "+
 "WHEN l.contact_permission=1 AND "+PROOF_SQL+" THEN 'AUTHORIZED' "+
 "ELSE 'PENDING' END";
const BASE_SQL="SELECT l.id,l.business,l.name,l.phone,l.source,l.city,l.stage,l.created_at,l.contact_permission,"+
 STATUS_SQL+" AS approval_status FROM leads l WHERE l.phone IS NOT NULL"+excludedTestPhoneSql("l");

export function listLeadApprovals({status='PENDING',limit=40,offset=0}={}){
 if(!['PENDING','AUTHORIZED','BLOCKED','ALL'].includes(status))throw Error('Filtro de aprovações inválido');
 const size=Number(limit),skip=Number(offset);
 if(!Number.isInteger(size)||size<1||size>100||!Number.isInteger(skip)||skip<0)throw Error('Paginação inválida');
 const summary=all("SELECT approval_status,COUNT(*) AS quantity FROM ("+BASE_SQL+") GROUP BY approval_status");
 const totals={pending:0,authorized:0,blocked:0};
 for(const row of summary)totals[row.approval_status.toLowerCase()]=row.quantity;
 const total=status==='ALL'?totals.pending+totals.authorized+totals.blocked:totals[status.toLowerCase()];
 const rows=status==='ALL'
  ?all(BASE_SQL+" ORDER BY l.created_at DESC LIMIT ? OFFSET ?",size,skip)
  :all("SELECT * FROM ("+BASE_SQL+") WHERE approval_status=? ORDER BY created_at DESC LIMIT ? OFFSET ?",status,size,skip);
 return {totals,total,status,limit:size,offset:skip,snapshotAt:new Date().toISOString(),
  items:rows.map(({contact_permission,...lead})=>{
   if(lead.approval_status!=='AUTHORIZED')return lead;
   const last=one("SELECT at,detail FROM audit WHERE lead_id=? AND action='CONSENT_UPDATED' AND json_extract(detail,'$.permitted')=1 AND COALESCE(json_extract(detail,'$.evidence'),'')<>'' ORDER BY at DESC LIMIT 1",lead.id);
   if(!last)return lead;
   let details={};try{details=JSON.parse(last.detail);}catch{}
   return {...lead,consentRecord:{recordedAt:last.at,consentAt:details.consentAt||null,
    channel:details.channel||'OTHER',sourcePhone:details.sourcePhone||'',evidence:details.evidence||'',
    batchId:details.batchId||null,evidenceReference:details.evidenceReference||'',
    evidenceType:details.evidenceType||'DOCUMENTED',method:details.method||'manual_batch_curation'}};
  })};
}


// Fast curation: the button is an authenticated operator's declaration, NOT an
// independently verified WhatsApp opt-in. Every selected lead gets a distinct audit
// record. No message is sent and no queue/consent-policy switch is altered.
function quickConsentBatch(input){
 if(input.confirmedByOperator!==true)throw Error('Confirme que os contatos selecionados aceitaram receber mensagens');
 const allPending=input.allPending===true;
 const raw=allPending?(input.excludedLeadIds||[]):input.leadIds;
 if(!Array.isArray(raw))throw Error('Seleção de contatos inválida');
 const selected=new Set();
 for(const value of raw){
  const leadId=String(value||'').trim();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId)||selected.has(leadId))
   throw Error('Seleção contém contato inválido ou duplicado');
  selected.add(leadId);
 }
 let selectionCutoff=null;
 if(allPending){
  const timestamp=Date.parse(input.selectionCutoff||''),current=Date.now();
  if(!Number.isFinite(timestamp)||timestamp>current+300000||timestamp<current-366*86400000)
   throw Error('A seleção expirou. Atualize a lista e selecione todos novamente');
  selectionCutoff=new Date(timestamp).toISOString();
 }
 const batchId=id(),recordedAt=new Date().toISOString();
 return tx(()=>{
  const candidates=allPending
   ?all("SELECT id FROM ("+BASE_SQL+") WHERE approval_status='PENDING' AND created_at<=?",selectionCutoff)
   :[...selected].map(leadId=>({id:leadId}));
  const leadIds=candidates.map(x=>x.id).filter(leadId=>!allPending||!selected.has(leadId));
  if(!leadIds.length)throw Error('Nenhum contato da seleção foi encontrado. Atualize a lista e tente novamente');
  const approved=[],skipped=[],ownerPhone=verifiedOwnerPhone();
  // A single ineligible lead never blocks the remaining, individually audited
  // declarations. Existing clients, opt-outs and the owner's phone stay excluded.
  for(const leadId of leadIds){
   const lead=one('SELECT id,phone,contact_permission FROM leads WHERE id=?',leadId);
   let reason=null;
   if(!lead?.phone)reason='CONTATO_INEXISTENTE';
   else if(ownerPhone&&lead.phone===ownerPhone)reason='NUMERO_PROPRIETARIO';
   else if(isExcludedTestContact(lead.phone))reason='CONTATO_DE_TESTE';
   else if(one('SELECT 1 FROM suppressions WHERE phone=?',lead.phone))reason='CONTATO_BLOQUEADO';
   else if(one("SELECT 1 FROM contact_relationships WHERE phone=? AND kind='EXISTING_CLIENT'",lead.phone))reason='CLIENTE_EXISTENTE';
   else if(lead.contact_permission===1&&one("SELECT 1 FROM audit WHERE lead_id=? AND action='CONSENT_UPDATED' AND json_extract(detail,'$.permitted')=1 AND COALESCE(json_extract(detail,'$.evidence'),'')<>'' LIMIT 1",lead.id))reason='JA_AUTORIZADO';
   if(reason)skipped.push({leadId,reason});
   else approved.push(leadId);
  }
  for(const leadId of approved){
   run('UPDATE leads SET contact_permission=1 WHERE id=?',leadId);
   audit('CONSENT_UPDATED',leadId,{
    permitted:true,
    evidence:'Declaração do operador autenticado: este contato aceitou receber mensagens. Comprovante da conversa não anexado.',
    evidenceType:'OPERATOR_ATTESTATION',evidenceVerified:false,
    method:'manual_quick_approval',channel:'PERSONAL_WHATSAPP_REPORTED',
    sourcePhone:'',consentAt:null,recordedAt,actor:'AUTHENTICATED_WORKSPACE_OPERATOR',
    batchId,workspace:process.env.PROSPECTOR_TENANT_ID||'PRIMARY'
   });
  }
  const skippedReasons={};
  for(const item of skipped)skippedReasons[item.reason]=(skippedReasons[item.reason]||0)+1;
  audit('CONSENT_BATCH_APPROVED',null,{
   batchId,quantity:approved.length,skipped:skipped.length,skippedReasons,
   selection:allPending?'ALL_PENDING':'SELECTED',selectionCutoff,
   excludedCount:allPending?selected.size:0,
   evidenceType:'OPERATOR_ATTESTATION',actor:'AUTHENTICATED_WORKSPACE_OPERATOR',
   method:'manual_quick_approval',workspace:process.env.PROSPECTOR_TENANT_ID||'PRIMARY'
  });
  return {ok:true,batchId,approved:approved.length,skipped:skipped.length,
   skippedReasons,skippedItems:skipped,selection:allPending?'ALL_PENDING':'SELECTED'};
 });
}

export function approveLeadBatch(input={}){
 if(input.quick===true)return quickConsentBatch(input);
 const entries=input.items;
 if(!Array.isArray(entries)||entries.length===0)throw Error('Selecione ao menos um contato');
 if(input.confirmedByOperator!==true)throw Error('Confirme que cada contato selecionado autorizou a abordagem');
 const ids=new Set(),approved=[];
 const submittedAt=Date.now(),batchId=id();
 for(const item of entries){
  const leadId=String(item?.leadId||'').trim();
  const evidence=String(item?.evidence||'').trim();
  const channel=String(item?.channel||'').trim();
  const sourcePhone=String(item?.operatorPhone||'').replace(/\D/g,'');
  const consentAt=String(item?.consentAt||'');
  const evidenceReference=String(item?.evidenceReference||'').trim();
  if(evidenceReference.length>500)throw Error('Referência de evidência muito longa');
  const consentTime=Date.parse(consentAt);
  if(!/^[\da-f-]{36}$/i.test(leadId)||ids.has(leadId))throw Error('Contato inválido ou duplicado no lote');
  ids.add(leadId);
  if(evidence.length<3||evidence.length>1000)throw Error('Cada contato precisa de evidência individual (3 a 1000 caracteres)');
  if(!CHANNELS.has(channel))throw Error('Informe o canal da autorização de cada contato');
  if(!/^55\d{10,11}$/.test(sourcePhone))throw Error('Informe o número brasileiro usado para obter a autorização, com DDD');
  if(!Number.isFinite(consentTime)||consentTime>submittedAt+5*60*1000||consentTime<submittedAt-366*24*3600*1000)throw Error('Informe uma data de autorização válida (últimos 366 dias)');
  approved.push({leadId,evidence,evidenceReference,channel,sourcePhone,consentAt:new Date(consentTime).toISOString()});
 }
 return tx(()=>{
  // Prevalidate all rows: no partial approval if one contact is missing or blocked.
  for(const item of approved){
   const lead=one('SELECT id,phone,contact_permission FROM leads WHERE id=?',item.leadId);
   if(!lead?.phone)throw Error('Um dos contatos não existe ou não possui WhatsApp');
   if(lead.phone===verifiedOwnerPhone()||isExcludedTestContact(lead.phone))throw Error('Contato de teste/proprietário excluído da prospecção');
   if(one('SELECT phone FROM suppressions WHERE phone=?',lead.phone))throw Error('Contato bloqueado para novas mensagens');
   if(one("SELECT phone FROM contact_relationships WHERE phone=? AND kind='EXISTING_CLIENT'",lead.phone))throw Error('Cliente existente não pode ser aprovado como prospecção');
   if(lead.contact_permission===1&&one("SELECT id FROM audit WHERE lead_id=? AND action='CONSENT_UPDATED' AND json_extract(detail,'$.permitted')=1 AND COALESCE(json_extract(detail,'$.evidence'),'')<>'' LIMIT 1",lead.id))throw Error('Um dos contatos já está autorizado. Atualize a lista');
  }
  for(const item of approved){
   run('UPDATE leads SET contact_permission=1 WHERE id=?',item.leadId);
   audit('CONSENT_UPDATED',item.leadId,{
    permitted:true,evidence:item.evidence,evidenceReference:item.evidenceReference,method:'manual_batch_curation',
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
