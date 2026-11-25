import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-contact-profile-'));
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.WA_AKG_SESSION_ID='profile-test-session';
const db=await import('../dashboard/db.mjs');
const {contactProfile,saveContactProfile,whatsappProfileName}=await import('../dashboard/waakg-conversations.mjs');
const leadId='contact-profile-test',phone='5515999998888',stamp=db.now();
db.run('INSERT INTO leads(id,business,phone,stage,created_at,last_seen_at) VALUES(?,?,?,?,?,?)',leadId,'Empresa teste',phone,'CONTACTED',stamp,stamp);
db.run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',leadId,phone,'SENT','contact-job-test',stamp);
test('prefer a real WhatsApp profile name, never numeric JIDs or outbound sender names',()=>{
 assert.equal(whatsappProfileName({name:'5515999998888@s.whatsapp.net',notify:'Lydia'}),'Lydia');
 assert.equal(whatsappProfileName({name:'5515999998888',lastMessage:{fromMe:true,pushName:'Wesley'}}),'');
 assert.equal(whatsappProfileName({lastMessage:{fromMe:false,pushName:'Lydia'}}),'Lydia');
});
test('persist nickname and favorite without changing WhatsApp phone',()=>{
 db.run('INSERT INTO waakg_contact_profiles(lead_id,whatsapp_name,updated_at) VALUES(?,?,?)',leadId,'Lydia',stamp);
 assert.equal(contactProfile(leadId).name,'Lydia');
 assert.equal(saveContactProfile({leadId,name:'Lydia - compras',favorite:true}).favorite,true);
 db.run('UPDATE waakg_contact_profiles SET whatsapp_name=? WHERE lead_id=?','Lydia Silva',leadId);
 assert.equal(contactProfile(leadId).name,'Lydia - compras');
 assert.equal(saveContactProfile({leadId,name:'',favorite:false}).name,'Lydia Silva');
 assert.equal(contactProfile(leadId).favorite,false);
 assert.equal(db.one('SELECT phone FROM leads WHERE id=?',leadId).phone,phone);
});
test('contact editing cannot change a different recipient or unrecognized lead',()=>{
 assert.throws(()=>saveContactProfile({leadId:'missing',name:'Teste'}),/fora da prospecção/);
 assert.throws(()=>saveContactProfile({leadId,favorite:'yes'}),/Favorito inválido/);
});
test.after(()=>{db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
