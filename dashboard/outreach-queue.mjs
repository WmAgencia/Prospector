// Fila automática de oportunidades. Encontrar um número comercial não implica opt-in.
// O convite revisado pode pedir aceite; outras campanhas exigem autorização documentada.
import {all,one} from './db.mjs';
import {invitationEnabled} from './permission-invitation.mjs';
const BASE=`l.stage='DISCOVERED' AND NOT EXISTS (SELECT 1 FROM initial_contacts ic WHERE ic.lead_id=l.id OR (l.phone IS NOT NULL AND ic.phone=l.phone)) AND NOT EXISTS (SELECT 1 FROM executions ex WHERE ex.lead_id=l.id)`;
const proof=`EXISTS(SELECT 1 FROM audit a WHERE a.lead_id=l.id AND a.action='CONSENT_UPDATED' AND json_extract(a.detail,'$.permitted')=1 AND COALESCE(json_extract(a.detail,'$.evidence'),'')<>'')`;
export const autoOutreachCandidateSql=`SELECT l.id FROM leads l WHERE ${BASE}
 AND l.contact_permission=1 AND l.phone IS NOT NULL
 AND ${proof}
 AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.phone=l.phone)
 ORDER BY l.created_at ASC LIMIT 1`;
export function automaticCandidateSql(){
 return invitationEnabled()?`SELECT l.id FROM leads l WHERE ${BASE} AND l.phone IS NOT NULL AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.phone=l.phone) ORDER BY l.created_at ASC LIMIT 1`:autoOutreachCandidateSql;
}
export function documentedOptIn(leadId){
 const lead=one('SELECT id,phone,contact_permission FROM leads WHERE id=?',leadId);
 if(!lead||lead.contact_permission!==1||!lead.phone)return false;
 return !!one("SELECT id FROM audit WHERE lead_id=? AND action='CONSENT_UPDATED' AND json_extract(detail,'$.permitted')=1 AND COALESCE(json_extract(detail,'$.evidence'),'')<>'' ORDER BY at DESC LIMIT 1",leadId);
}
export function outreachQueueSnapshot(){
 const invitation=invitationEnabled();
 const active=all(`SELECT l.id,l.phone,l.contact_permission,l.created_at,
 CASE WHEN l.phone IS NULL THEN 'NO_WHATSAPP'
 WHEN EXISTS(SELECT 1 FROM suppressions s WHERE s.phone=l.phone) THEN 'SUPPRESSED'
 WHEN ${invitation?'1=1':`l.contact_permission=1 AND ${proof}`} THEN 'READY'
 ELSE 'AWAITING_OPT_IN' END AS queue_status
 FROM leads l WHERE ${BASE} ORDER BY l.created_at ASC LIMIT 5000`);
 const count=key=>active.filter(x=>x.queue_status===key).length;
 return {total:active.length,ready:count('READY'),awaitingConsent:count('AWAITING_OPT_IN'),
  missingWhatsapp:count('NO_WHATSAPP'),suppressed:count('SUPPRESSED'),
  recent:active.slice(0,20).map(x=>({id:x.id,status:x.queue_status})),
  autoEnrollment:true,noPerLeadOperatorApproval:true,requiresDocumentedOptIn:!invitation,invitationOnly:invitation,requiresAcceptanceBeforeMedia:true};
}
