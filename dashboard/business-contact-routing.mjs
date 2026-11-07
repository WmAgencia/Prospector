// Internal WhatsApp routing for discovered public businesses.
// Prefer a CNPJ-registered company number ONLY if the full company identity
// matches Maps/OSM and WA-AKG confirms the number exists on WhatsApp.
// This does NOT verify that the number belongs personally to any shareholder.
import {db,one,run,now,audit,phone} from './db.mjs';
import {selectedWaSession,waControlStatus,waRequest} from './waakg-control.mjs';
db.exec(\`CREATE TABLE IF NOT EXISTS lead_contact_selection (
 lead_id TEXT PRIMARY KEY REFERENCES leads(id),
 original_phone TEXT, chosen_phone TEXT,
 route_source TEXT NOT NULL, status TEXT NOT NULL,
 checked_at TEXT, reason TEXT, updated_at TEXT NOT NULL
)\`);

export async function checkWhatsappNumber(value,{request=waRequest,checkSession=waControlStatus}={}){
 const n=phone(value);
 if(!n||!n.startsWith('55'))return {state:'NO',reason:'INVALID_PHONE'};
 try{
  const online=await checkSession();
  const session=online?.sessionId||selectedWaSession();
  if(!online?.connected||!session)return {state:'UNKNOWN',reason:'WHATSAPP_OFFLINE'};
  // Official WA-AKG gateway: POST /api/chat/:sessionId/check {numbers:[...]}
  const response=await request('/api/chat/'+encodeURIComponent(session)+'/check',{
   method:'POST',data:{numbers:[n]}
  });
  const rows=response.results||response.data?.results;
  const matched=Array.isArray(rows)?rows.find(x=>phone(x?.number)===n):null;
  if(!matched||typeof matched.exists!=='boolean'||matched.error)return {state:'UNKNOWN',reason:'INVALID_CHECK_RESULT'};
  return {state:matched.exists?'YES':'NO',reason:matched.exists?'REGISTERED':'NOT_REGISTERED'};
 }catch(error){
  return {state:'UNKNOWN',reason:'CHECK_FAILED'};
 }
}
function hasHistory(lead){
 return !!one('SELECT 1 FROM initial_contacts WHERE lead_id=? OR phone=? LIMIT 1',lead.id,lead.phone||'')
  ||!!one('SELECT 1 FROM threads WHERE lead_id=? LIMIT 1',lead.id)
  ||!!one("SELECT 1 FROM prospecting_batch_items WHERE lead_id=? AND status IN ('QUEUED','SENDING','SENT','UNKNOWN') LIMIT 1",lead.id)
  ||!!one("SELECT 1 FROM jobs WHERE lead_id=? AND status IN ('PENDING','SENDING','SENT','UNKNOWN') LIMIT 1",lead.id)
  ||!!one("SELECT 1 FROM contact_cadence WHERE lead_id=? LIMIT 1",lead.id);
}
function selectRecord(leadId,original,chosen,status,source,reason){
 run(\`INSERT INTO lead_contact_selection(lead_id,original_phone,chosen_phone,route_source,status,checked_at,reason,updated_at)
 VALUES(?,?,?,?,?,?,?,?)
 ON CONFLICT(lead_id) DO UPDATE SET original_phone=excluded.original_phone,
 chosen_phone=excluded.chosen_phone,route_source=excluded.route_source,status=excluded.status,
 checked_at=excluded.checked_at,reason=excluded.reason,updated_at=excluded.updated_at\`,
 leadId,original||null,chosen||null,source,status,now(),reason||null,now());
 audit('BUSINESS_CONTACT_ROUTED',leadId,{source,status,reason,phoneChanged:!!chosen&&chosen!==original});
 return {status,source,reason,phoneChanged:!!chosen&&chosen!==original};
}
export function selectionStatus(leadId){
 return one('SELECT * FROM lead_contact_selection WHERE lead_id=?',leadId)||null;
}
export function routingAllowsOutreach(leadId){
 const choice=selectionStatus(leadId);
 return !choice||!['PENDING_CHECK','NO_WHATSAPP','NO_BUSINESS_LISTING'].includes(choice.status);
}
export async function routeBusinessContact(leadId,{matchedCompany=null,checkWhatsapp=checkWhatsappNumber}={}){
 const lead=one('SELECT * FROM leads WHERE id=?',leadId);
 if(!lead)return {status:'MISSING'};
 const saved=selectionStatus(leadId);
 const original=saved?.original_phone||lead.phone||null;
 // Do not repoint an existing interaction to another phone or attempt two first greetings.
 if(hasHistory(lead))return {status:'LOCKED',source:'EXISTING_CONTACT'};
 if(!['maps_extension','osm'].includes(lead.source))return {status:'NO_BUSINESS_LISTING'};
 const preferred=matchedCompany?phone(matchedCompany.companyPhone):null;
 const checked=new Map();
 async function valid(number){
  if(!number)return {state:'NO',reason:'MISSING'};
  if(checked.has(number))return checked.get(number);
  const result=await checkWhatsapp(number);
  checked.set(number,result);
  return result;
 }
 const preferredResult=preferred?await valid(preferred):{state:'NO',reason:'NOT_FOUND'};
 let chosen=null,source='maps_osm',reason='CNJP_NOT_CONFIRMED';
 if(matchedCompany&&preferredResult.state==='YES'){
  chosen=preferred;source='cnpj_registered';reason='CNPJ_ADDRESS_AND_WHATSAPP_VERIFIED';
 }
 const originalResult=!chosen&&original?await valid(original):null;
 if(!chosen&&originalResult?.state==='YES'){
  chosen=original;source='maps_osm';reason=matchedCompany?(preferredResult.state==='NO'?'CNPJ_NUMBER_NOT_ON_WHATSAPP':'CNPJ_NUMBER_NOT_VERIFIED'):'IDENTITY_OR_NUMBER_NOT_CONFIRMED';
 }
 if(!chosen){
  const unknown=(preferredResult.state==='UNKNOWN'||originalResult?.state==='UNKNOWN');
  return selectRecord(leadId,original,null,unknown?'PENDING_CHECK':'NO_WHATSAPP','none',
   unknown?'WHATSAPP_CHECK_UNAVAILABLE':'NO_VALID_WHATSAPP');
 }
 // Never steal a phone already assigned to another lead or an opted-out number.
 if(one('SELECT 1 FROM suppressions WHERE phone=?',chosen))return selectRecord(leadId,original,null,'NO_WHATSAPP','none','SUPPRESSED');
 if(chosen!==lead.phone){
  if(one('SELECT 1 FROM leads WHERE phone=? AND id<>?',chosen,lead.id)||
     one('SELECT 1 FROM initial_contacts WHERE phone=?',chosen)){
   if(chosen===preferred&&original&&original!==preferred){
    const mapResult=await valid(original);
    if(mapResult.state==='YES'&&!one('SELECT 1 FROM suppressions WHERE phone=?',original)){
     chosen=original;source='maps_osm';reason='CNPJ_PHONE_ALREADY_IN_USE';
    }else return selectRecord(leadId,original,null,'PENDING_CHECK','none','CNPJ_PHONE_CONFLICT');
   }else return selectRecord(leadId,original,null,'PENDING_CHECK','none','PHONE_CONFLICT');
  }
  // The route update occurs only before any queue reservation or conversation.
  const conflict=one('SELECT 1 FROM leads WHERE phone=? AND id<>?',chosen,lead.id);
  if(conflict)return selectRecord(leadId,original,null,'PENDING_CHECK','none','PHONE_CONFLICT');
  run('UPDATE leads SET phone=? WHERE id=? AND (phone=? OR phone IS NULL)',chosen,lead.id,lead.phone);
 }
 return selectRecord(leadId,original,chosen,source==='cnpj_registered'?'READY_CNPJ':'READY_MAPS',source,reason);
}
