import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/prospector-selection-');
process.env.PROSPECTOR_DATA_DIR=dir;
const db=await import('../dashboard/db.mjs');
const {prospectingList}=await import('../dashboard/prospecting-search.mjs');
const {prepareApproaches,greetingForTime}=await import('../dashboard/prospecting-approach.mjs');

test('time-of-day greeting follows São Paulo five/noon/eighteen boundaries',()=>{
 const cases=[
  ['2026-10-29T07:59:00Z','boa noite'],
  ['2026-10-29T08:00:00Z','bom dia'],
  ['2026-10-29T14:59:00Z','bom dia'],
  ['2026-10-29T15:00:00Z','boa tarde'],
  ['2026-10-29T20:59:00Z','boa tarde'],
  ['2026-10-29T21:00:00Z','boa noite']
 ];
 for(const [at,label] of cases)assert.equal(greetingForTime(new Date(at)),label,at);
});

test('Prospection lists only unapproached contacts; no phone stays visible but disabled',()=>{
 const active=db.addLead({business:'Mecânica Ativa',phone:'15988887777',city:'Sorocaba',segment:'oficina mecânica',source:'osm'});
 const contacted=db.addLead({business:'Mecânica Contatada',phone:'15988887778',city:'Sorocaba',segment:'oficina mecânica',source:'osm'});
 const blocked=db.addLead({business:'Mecânica Bloqueada',phone:'15988887779',city:'Sorocaba',segment:'oficina mecânica',source:'osm'});
 const missing=db.addLead({business:'Mecânica sem telefone',instagram:'mecanica.semtelefone.qa',city:'Sorocaba',segment:'oficina mecânica',source:'osm'});
 db.run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',contacted.lead.id,contacted.lead.phone,'SENT',db.id(),db.now());
 db.run('INSERT INTO suppressions(phone,reason,created_at) VALUES(?,?,?)',blocked.lead.phone,'OPTOUT',db.now());
 const list=prospectingList({niche:'oficina mecânica',city:'Sorocaba',status:'uncontacted'});
 assert.equal(list.uncontacted,2);
 assert.deepEqual(list.results.map(x=>x.business).sort(),['Mecânica Ativa','Mecânica sem telefone'].sort());
 assert.ok(list.results.find(x=>x.business==='Mecânica Ativa').selectable);
 const manual=list.results.find(x=>x.business==='Mecânica Ativa').manual_contact_url;
 assert.match(manual,/^https:\/\/wa\.me\/5515988887777\?text=/);
 assert.equal(decodeURIComponent(manual.split('text=')[1]),'Olá, Mecânica Ativa, tudo bem?');
 assert.equal(db.one('SELECT COUNT(*) n FROM messages').n,0,'generating a link never sends messages');

 assert.ok(!list.results.find(x=>x.business==='Mecânica sem telefone').selectable);
 assert.ok(list.results.every(x=>x.maps_url.includes('google.com/maps/')));
 assert.ok(!list.results.some(x=>x.business==='Mecânica Contatada'||x.business==='Mecânica Bloqueada'));
 const allContacts=prospectingList({niche:'oficina mecânica',city:'Sorocaba',status:'all'});
 assert.equal(allContacts.results.find(x=>x.business==='Mecânica Bloqueada').manual_contact_url,null);
 assert.equal(allContacts.results.find(x=>x.business==='Mecânica Contatada').manual_contact_url,null);
 assert.equal(allContacts.results.find(x=>x.business==='Mecânica sem telefone').manual_contact_url,null);

 const out=prepareApproaches({leadIds:[active.lead.id,contacted.lead.id,blocked.lead.id,missing.lead.id]});
 assert.equal(out.selected,4);
 assert.equal(out.ready,0,'public business listings are not permission evidence');
 assert.equal(out.needsPermission,1);
 assert.equal(out.manualReady,1,'public business is eligible for operator-led contact');
 assert.equal(out.items.find(x=>x.id===active.lead.id).manualUrl,'https://wa.me/5515988887777');
 assert.equal(out.items.find(x=>x.id===blocked.lead.id).manualUrl,null);

 assert.equal(out.items.filter(x=>x.eligible).length,1);
 assert.equal(db.one('SELECT COUNT(*) n FROM messages').n,0,'preview must never send or create messages');
});

test('An expressly consented lead can receive a preview ready for human approval',()=>{
 const ok=db.addLead({business:'Cliente que autorizou',phone:'15988887776',source:'MANUAL',contact_permission:true});
 db.audit('CONSENT_UPDATED',ok.lead.id,{permitted:true,evidence:'autorização documentada para teste'});
 const out=prepareApproaches({leadIds:[ok.lead.id]});
 assert.equal(out.ready,1);
 assert.equal(out.items[0].status,'READY_FOR_APPROVAL');
 assert.equal(out.items[0].message,out.message);
 assert.equal(out.autoSent,false);
 assert.equal(db.one('SELECT COUNT(*) n FROM messages').n,0);
 assert.throws(()=>prepareApproaches({leadIds:[]}),/Selecione/);
 assert.throws(()=>prepareApproaches({leadIds:['not-uuid']}),/inválida/);
});
test.after(()=>{db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
