import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-ui-data-'));
const d=await import('../dashboard/db.mjs');
const {recordSalesOutcome:record}=await import('../dashboard/sales-outcomes.mjs');
test.after(()=>{d.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
test('duplicate discovery enriches missing metadata without changing reviewed values or permission',()=>{
 const l=d.addLead({phone:'5515999112233',business:'Reviewed',city:'Sorocaba'}).lead;
 const enriched=d.addLead({phone:l.phone,business:'Other',city:'Campinas',segment:'dentista',website:'https://example.test',instagram:'clinic',contact_permission:true}).lead;
 assert.equal(enriched.business,'Reviewed');assert.equal(enriched.city,'Sorocaba');assert.equal(enriched.segment,'dentista');assert.equal(enriched.website,'https://example.test');assert.equal(enriched.instagram,'clinic');assert.equal(enriched.contact_permission,0);
 const other=d.addLead({phone:'5515999112244',instagram:'other'}).lead;
 assert.throws(()=>d.addLead({phone:l.phone,instagram:other.instagram,website:'collision'}),/IDENTITY_CONFLICT/);
 d.run('INSERT INTO lead_origins(id,lead_id,source,identity,details,at) VALUES(?,?,?,?,?,?)',d.id(),other.id,'osm','https://www.openstreetmap.org/node/1','{}',d.now());
 assert.throws(()=>d.addLead({phone:l.phone,source:'osm',osm_id:'https://www.openstreetmap.org/node/1'}),/IDENTITY_CONFLICT/);
 assert.equal(d.one('SELECT website FROM leads WHERE id=?',l.id).website,'https://example.test');
});
test('refusal can strengthen to opt-out, while opt-out and won stay protected',()=>{
 const l=d.addLead({phone:'5515999112255'}).lead;
 const rec=status=>record({leadId:l.id,status,notify:false});
 rec('NO_INTEREST');assert.equal(rec('INTERESTED').ok,false);assert.equal(rec('OPT_OUT').ok,true);assert.equal(rec('CLOSED_WON').ok,false);
 const won=d.addLead({phone:'5515999112266'}).lead;record({leadId:won.id,status:'CLOSED_WON',notify:false});assert.equal(record({leadId:won.id,status:'NO_INTEREST',notify:false}).ok,false);
 assert.equal(record({leadId:won.id,status:'OPT_OUT',notify:false}).ok,true);
});
test('new actual inbound permits a later interested result after refusal',()=>{
 const l=d.addLead({phone:'5515999112277'}).lead;
 record({leadId:l.id,status:'NO_INTEREST',notify:false});
 d.run("UPDATE sales_outcomes SET updated_at='2020-01-01T00:00:00.000Z' WHERE lead_id=?",l.id);
 const t=d.getThread(l.id);d.addMessage({threadId:t.id,providerId:'renewed:1',direction:'in',body:'Quero contratar'});d.stage(l.id,'INTERESTED');
 assert.equal(record({leadId:l.id,status:'INTERESTED',providerId:'missing:1',notify:false}).ok,false);
 assert.equal(record({leadId:l.id,status:'INTERESTED',providerId:'renewed:1',notify:false}).ok,true);
 assert.equal(record({leadId:l.id,status:'CLOSED_WON',notify:false}).ok,true);
});
test('audio validates individual JIDs and relationship action uses declared chat state',()=>{
 const source=fs.readFileSync(new URL('../dashboard/public/simple-app.js',import.meta.url),'utf8');
 const match=source.match(/if\(!\/(.*?)\/\.test\(jid\)\)/);assert.ok(match);
 assert.equal(new RegExp(match[1]).test('5515999112233@s.whatsapp.net'),true);
 assert.equal(new RegExp(match[1]).test('5515999112233@g.us'),false);
 assert.ok(!source.includes('[...remoteChats,...chats]'));
});
