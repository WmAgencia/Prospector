// Server-side WhatsApp roles. Never trust contact text, claimed identity,
// model output, imported names, or a last-four-digit match for authorization.
import {db,one,run,now,audit,phone} from './db.mjs';
import {testModeAllowed} from './groq-live-test-guard.mjs';
import {selectedWaSession} from './waakg-control.mjs';
db.exec("CREATE TABLE IF NOT EXISTS contact_relationships(phone TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('EXISTING_CLIENT')),evidence TEXT NOT NULL,source TEXT NOT NULL,updated_at TEXT NOT NULL)");
const fullPhone=x=>{
 const p=phone(x);
 return p&&/^55\d{10,11}$/.test(p)?p:null;
};
export function verifiedOwnerPhone(){
 // This is the only credential allowed to grant privileged owner features.
 // Notification targets and QA test settings are NEVER authorization sources.
 return fullPhone(process.env.PROSPECTOR_OWNER_PHONE);
}
export function classifyContact({jid,sessionId}={}){
 const inbound=/^\d{12,13}@s\.whatsapp\.net$/.test(String(jid||''));
 const number=inbound?fullPhone(String(jid).split('@')[0]):null;
 if(!number||!sessionId||sessionId!==selectedWaSession())return {role:'UNVERIFIED',authorized:false,reason:'UNVERIFIED_SESSION'};
 const owner=verifiedOwnerPhone();
 if(owner&&number===owner)return {
  role:'OWNER',authorized:true,
  // Explicitly enabled owner operations require an EXACT verified owner JID and
  // current WA-AKG session. QA mode alone must never grant these privileges.
  ownerTools:!testModeAllowed(number)||process.env.PROSPECTOR_OWNER_OPERATIONS_ENABLED==='true',
  testSandbox:testModeAllowed(number),reason:'OWNER_JID_EXACT'};
 const relationship=one("SELECT kind FROM contact_relationships WHERE phone=? AND kind='EXISTING_CLIENT'",number);
 const lead=one("SELECT id,stage FROM leads WHERE phone=?",number);
 if(relationship||lead?.stage==='CLOSED_WON')return {role:'EXISTING_CLIENT',authorized:false,ownerTools:false,reason:relationship?'OPERATOR_VERIFIED_CLIENT':'CLOSED_WON'};
 const contacted=lead&&(
  one("SELECT 1 FROM initial_contacts WHERE lead_id=? AND status='SENT' LIMIT 1",lead.id)||
  one("SELECT 1 FROM jobs WHERE lead_id=? AND status='SENT' AND step_index=0 AND execution_id IS NOT NULL LIMIT 1",lead.id)||
  (one("SELECT 1 FROM sqlite_master WHERE type='table' AND name='prospecting_batch_items'")?
    one("SELECT 1 FROM prospecting_batch_items WHERE lead_id=? AND status='SENT' LIMIT 1",lead.id):false)||
  one("SELECT 1 FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.lead_id=? AND m.direction='out' AND m.provider_id LIKE 'prospect-queue:%' AND m.status IN ('sent','accepted') LIMIT 1",lead.id));
 if(contacted)return {role:'PROSPECT_APPROACHED',authorized:false,ownerTools:false,reason:'VERIFIED_INITIAL_OUTREACH'};
 return {role:'INBOUND_NEW',authorized:false,ownerTools:false,reason:lead?'NO_VERIFIED_OUTREACH':'FIRST_CONTACT'};
}
export function hasExistingClientRelationship(number){
 const p=fullPhone(number);
 return !!p&&!!one("SELECT 1 FROM contact_relationships WHERE phone=? AND kind='EXISTING_CLIENT'",p);
}
export function setExistingClientRelationship({leadId,existing=true,evidence=''}={}){
 const lead=one("SELECT id,phone,stage FROM leads WHERE id=?",String(leadId||''));
 if(!lead?.phone)throw Error('Contato com telefone válido não encontrado');
 if(lead.phone===verifiedOwnerPhone())throw Error('Não é permitido classificar proprietário como cliente');
 if(typeof existing!=='boolean')throw Error('Classificação de cliente inválida');
 const reason=String(evidence||'').trim();
 if(existing&&reason.length<8)throw Error('Informe uma comprovação administrativa com no mínimo 8 caracteres');
 if(reason.length>350)throw Error('Comprovação muito longa');
 if(existing){
  run("INSERT INTO contact_relationships(phone,kind,evidence,source,updated_at) VALUES(?,'EXISTING_CLIENT',?,'OPERATOR',?) ON CONFLICT(phone) DO UPDATE SET kind=excluded.kind,evidence=excluded.evidence,source=excluded.source,updated_at=excluded.updated_at",lead.phone,reason,now());
  // Existing customers are not valid targets for initial prospecting.
  if(one("SELECT name FROM sqlite_master WHERE type='table' AND name='prospecting_batch_items'"))
   run("UPDATE prospecting_batch_items SET status='CANCELLED',error='Existing client: canceled before send' WHERE lead_id=? AND status='QUEUED'",lead.id);
  // Also stop pending legacy initial/invitation and scheduled recontact jobs.
  // Do not touch service delivery steps from already-running contracts.
  run("UPDATE jobs SET status='CANCELLED',updated_at=?,error='Existing client: marketing send cancelled' WHERE lead_id=? AND status='PENDING' AND (key LIKE 'recontact:%' OR (execution_id IS NOT NULL AND step_index=0))",now(),lead.id);
  run("UPDATE executions SET state='CANCELLED',updated_at=? WHERE lead_id=? AND next_step=0 AND state NOT IN ('COMPLETE','CANCELLED')",now(),lead.id);
 }else run('DELETE FROM contact_relationships WHERE phone=?',lead.phone);
 audit('CONTACT_RELATIONSHIP_OPERATOR_UPDATED',lead.id,{existing,evidenceProvided:!!reason});
 return {ok:true,phoneSuffix:lead.phone.slice(-4),role:existing?'EXISTING_CLIENT':'RECALCULATE',verifiedBy:'OPERATOR'};
}
export const contactPolicy=(role,{testSandbox=false}={})=>{
 switch(role){
  case 'OWNER':return {canUseOwnerTools:!testSandbox,allowMarketing:false,canRequestHuman:false,salesPlaybook:false,customerSupport:false};
  case 'EXISTING_CLIENT':return {canUseOwnerTools:false,allowMarketing:false,canRequestHuman:true,salesPlaybook:false,customerSupport:true};
  case 'PROSPECT_APPROACHED':return {canUseOwnerTools:false,allowMarketing:false,canRequestHuman:true,salesPlaybook:true,customerSupport:false};
  case 'INBOUND_NEW':return {canUseOwnerTools:false,allowMarketing:false,canRequestHuman:true,salesPlaybook:false,customerSupport:false};
  default:return {canUseOwnerTools:false,allowMarketing:false,canRequestHuman:false,salesPlaybook:false,customerSupport:false};
 }
};
