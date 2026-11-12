import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'qa-exclusion-'));
process.env.WA_AKG_SESSION_ID='consecom-principal';
delete process.env.PROSPECTOR_TENANT_ID;
const db=await import('../dashboard/db.mjs');
const {prospectorLeadEligible}=await import('../dashboard/whatsapp-roles.mjs');

function approached(name,number,source){
 const contact=db.addLead({name,business:name,phone:number,source}).lead;
 const thread=db.getThread(contact.id,number+'@s.whatsapp.net');
 db.addMessage({threadId:thread.id,providerId:'prospect-queue:'+db.id(),direction:'out',
  status:'sent',body:'Oi, tudo bem?'});
 return contact;
}
test('real verified prospect activity remains visible and eligible',()=>{
 const lead=approached('Oficina real', '5511988001234','maps_extension');
 assert.equal(prospectorLeadEligible(lead.id),true);
});
test('internal owner-to-owner WhatsApp test cannot become a real sales lead',()=>{
 const qa=approached('TESTE INTERNO 2994','5511988002994','WA_PAIR_QA');
 db.stage(qa.id,'INTERESTED','SIMULATED_INTEREST');
 assert.equal(prospectorLeadEligible(qa.id),false);
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
