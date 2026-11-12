import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'consent-sync-'));
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE='true';
delete process.env.PROSPECTOR_TENANT_ID;
const {isPermissionRequest,explicitConsentReply,findDocumentedWhatsappConsent}=await import('../dashboard/whatsapp-approval-reconciliation.mjs');
const {approveLeadBatch,listLeadApprovals}=await import('../dashboard/lead-approvals.mjs');
const {documentedOptIn}=await import('../dashboard/outreach-queue.mjs');
const db=await import('../dashboard/db.mjs');
const plus=(ms)=>new Date(Date.now()+ms).toISOString();
const req=(when=plus(-90*60000))=>({fromMe:true,content:'Oi, você autoriza que eu envie uma proposta de site para sua empresa pelo WhatsApp?',keyId:'outgoing-permission-message',timestamp:when});
const yes=(when=plus(-87*60000))=>({fromMe:false,content:'Sim, pode mandar a proposta',keyId:'inbound-confirmation-yes',timestamp:when});
test('outgoing request must explicitly ask permission to send a sales proposal',()=>{
 assert.equal(isPermissionRequest('Oi, você autoriza que eu envie uma proposta de site para sua empresa pelo WhatsApp?'),true);
 assert.equal(isPermissionRequest('Você quer um site?'),false);
 assert.equal(isPermissionRequest('Oi, sou Wesley da Consecom.'),false);
 assert.equal(isPermissionRequest('Não quero enviar proposta'),false);
});
test('only a positive answer to the corresponding request qualifies',()=>{
 assert.equal(explicitConsentReply('Sim, pode mandar a proposta'),true);
 assert.equal(explicitConsentReply('Claro'),true);
 assert.equal(explicitConsentReply('Não, obrigado'),false);
 assert.equal(explicitConsentReply('Agora não'),false);
 assert.equal(explicitConsentReply('Talvez depois'),false);
 assert.equal(explicitConsentReply('Não me contate'),false);
 assert.equal(explicitConsentReply('Gostei da ideia, mas não quero proposta'),false);
});
test('preserves message identity, date and actual text',()=>{
 const p=findDocumentedWhatsappConsent([yes(),req()]);
 assert.equal(p.sourceMessageId,'inbound-confirmation-yes');
 assert.match(p.evidenceReference,/inbound-confirmation-yes/);
 assert.equal(p.evidence,'Sim, pode mandar a proposta');
 assert.ok(p.consentAt.endsWith('Z'));
});
test('does not assume consent from isolated positive words, irrelevant conversation or self replies',()=>{
 assert.equal(findDocumentedWhatsappConsent([yes()]),null);
 assert.equal(findDocumentedWhatsappConsent([req(),{...yes(),fromMe:true}]),null);
 assert.equal(findDocumentedWhatsappConsent([req(),{...yes(),keyId:''}]),null);
 assert.equal(findDocumentedWhatsappConsent([req(),{...yes(),content:'Não quero'}]),null);
 assert.equal(findDocumentedWhatsappConsent([req(),{...yes(),timestamp:plus(25*24*3600*1000)}]),null);
});
test('a later stop/revocation overrides earlier yes',()=>{
 const stopped=[req(),yes(),{fromMe:false,content:'Não quero mais mensagens',keyId:'stop-id',timestamp:plus(-80*60000)}];
 assert.equal(findDocumentedWhatsappConsent(stopped),null);
});
test('repeat quick-approval is an existing declaration, not an ignored or newly authorized contact',()=>{
 const lead=db.addLead({business:'Oficina fictícia',phone:'5515988990011',source:'maps_extension'}).lead;
 const first=approveLeadBatch({quick:true,confirmedByOperator:true,leadIds:[lead.id]});
 assert.equal(first.approved,1);
 assert.equal(documentedOptIn(lead.id),false);
 const second=approveLeadBatch({quick:true,confirmedByOperator:true,leadIds:[lead.id]});
 assert.equal(second.approved,0);
 assert.equal(second.alreadyDeclared,1);
 assert.equal(second.skipped,0);
 const approval=listLeadApprovals({status:'PENDING',limit:10});
 assert.equal(approval.items.some(x=>x.id===lead.id&&x.needsIndividualEvidence),true);
});
test('proof-backed acceptance upgrades an old quick declaration without deleting it',()=>{
 const lead=db.one("SELECT id FROM leads WHERE phone='5515988990011'");
 const evidence=findDocumentedWhatsappConsent([req(),yes()]);
 const res=approveLeadBatch({confirmedByOperator:true,items:[{
  leadId:lead.id,operatorPhone:'5515988882994',channel:'PERSONAL_WHATSAPP',
  evidence:evidence.evidence,evidenceReference:evidence.evidenceReference,consentAt:evidence.consentAt
 }]});
 assert.equal(res.approved,1);
 assert.equal(documentedOptIn(lead.id),true);
 const authorized=listLeadApprovals({status:'AUTHORIZED',limit:10});
 assert.equal(authorized.items.some(x=>x.id===lead.id),true);
 assert.equal(db.one("SELECT COUNT(*) AS n FROM audit WHERE lead_id=? AND action='CONSENT_UPDATED'",lead.id).n,2);
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});