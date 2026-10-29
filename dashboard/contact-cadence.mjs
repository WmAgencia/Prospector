// Minimal outreach history: one record per phone, no duplicated message bodies.
import {one,all,run,id,now,audit} from './db.mjs';
import {threeMonthsAfter} from './prospecting-recontact.mjs';
import {documentedOptIn} from './outreach-queue.mjs';
export const DAYS_90=90*24*3600*1000;
export function nextEligible(at){return threeMonthsAfter(at);}
export function allowedToRecontact(row,at=Date.now()){
 return Boolean(row&&row.contact_permission&&row.phone&&!row.suppressed_at&&!['INTERESTED','CONVERSING','CLOSED_WON'].includes(row.stage)&&(row.last_contact_at?Date.parse(nextEligible(row.last_contact_at))<=at:(row.next_contact_at&&Date.parse(row.next_contact_at)<=at)));
}
export function rememberOutreach(leadId,source='initial'){
 const l=one('SELECT id,phone FROM leads WHERE id=?',leadId);if(!l?.phone)return false;
 const previous=one('SELECT * FROM contact_cadence WHERE phone=?',l.phone);
 const at=now();
 run('INSERT INTO contact_cadence(phone,lead_id,first_contact_at,last_contact_at,next_contact_at,total_approaches) VALUES(?,?,?,?,?,1) ON CONFLICT(phone) DO UPDATE SET lead_id=excluded.lead_id,last_contact_at=excluded.last_contact_at,next_contact_at=excluded.next_contact_at,total_approaches=contact_cadence.total_approaches+1',
 l.phone,l.id,previous?.first_contact_at||at,at,nextEligible(at));
 audit('CONTACT_CADENCE',l.id,{source,next:nextEligible(at)});
 return true;
}
export function eligibleRecontacts(){
 return all("SELECT c.phone,c.lead_id,c.last_contact_at,c.next_contact_at,c.total_approaches,l.business,l.contact_permission,l.stage FROM contact_cadence c JOIN leads l ON l.id=c.lead_id LEFT JOIN suppressions s ON s.phone=c.phone WHERE s.phone IS NULL AND l.contact_permission=1 AND l.stage NOT IN ('INTERESTED','CONVERSING','CLOSED_WON') ORDER BY c.next_contact_at LIMIT 1000").filter(c=>allowedToRecontact(c)).slice(0,100);
}
export function scheduleApprovedRecontact(leadId,text){
 const lead=one('SELECT id,phone,business,contact_permission,stage FROM leads WHERE id=?',leadId);
 const row=lead?.phone?one('SELECT next_contact_at,last_contact_at FROM contact_cadence WHERE phone=?',lead.phone):null;
 const suppressed=lead?.phone?one('SELECT phone FROM suppressions WHERE phone=?',lead.phone):null;
 if(!allowedToRecontact({...lead,next_contact_at:row?.next_contact_at,last_contact_at:row?.last_contact_at,suppressed_at:suppressed?.phone}))throw Error('Recontato não elegível ou sem autorização vigente');
 if(!documentedOptIn(leadId))throw Error('Autorização de contato documentada é necessária para recontato');
 const body=String(text||'').trim();
 if(body.length<10||body.length>1000)throw Error('Mensagem de 10 a 1.000 caracteres necessária');
 if(one("SELECT id FROM jobs WHERE lead_id=? AND key LIKE 'recontact:%' AND status IN ('PENDING','SENDING','UNKNOWN')",leadId))throw Error('Recontato pendente ou sob revisão');
 const jid=id(),date=now();
 run("INSERT INTO jobs(id,lead_id,type,text,key,status,created_at,updated_at) VALUES(?,?,'message',? ,?,'PENDING',?,?)",jid,leadId,body,'recontact:'+leadId+':'+jid,date,date);
 audit('RECONTACT_APPROVED',leadId,{due:row.next_contact_at});
 return {jobId:jid};
}
