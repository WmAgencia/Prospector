import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-workspace-v3-'));
process.env.PROSPECTOR_DATA_DIR=dir;
const db=await import('../dashboard/db.mjs');
const preference=await import('../dashboard/client-preferences.mjs');
const window=await import('../dashboard/outreach-window.mjs');
const calendar=await import('../dashboard/prospecting-calendar.mjs');

test('search scope is constrained to real supported industries and cities',()=>{
 assert.ok(preference.scopeOptions().cities.includes('Sorocaba'));
 const result=preference.saveScope({mode:'niche-city',niche:'oficina',city:'Sorocaba'});
 assert.equal(result.selection.niche,'oficina');
 assert.equal(result.selection.city,'Sorocaba');
 assert.equal(db.getSetting('cities'),'Sorocaba');
 assert.equal(db.getSetting('segments'),'oficina');
 assert.throws(()=>preference.saveScope({mode:'niche-city',niche:'oficina',city:'Cidade imaginária'}),/cidade disponível/);
 const withState=preference.saveScope({mode:'niche-city',niche:'oficina',city:'Sorocaba / SP'});
 assert.equal(withState.selection.city,'Sorocaba');
 assert.throws(()=>preference.saveScope({mode:'all-city',city:'Sorocaba / RJ'}),/cidade disponível/);
 const all=preference.saveScope({mode:'all'});
 assert.equal(all.selection.citiesCovered,preference.scopeOptions().cities.length);
 assert.equal(all.selection.nichesCovered,preference.scopeOptions().segments.length);
});

test('per-client outreach hours are restricted to approved window without widening channel gate',()=>{
 assert.throws(()=>preference.saveOutreachHours({start:'05:00',end:'17:30'}),/08:00/);
 assert.throws(()=>preference.saveOutreachHours({start:'09:00',end:'18:00'}),/08:00/);
 assert.throws(()=>preference.saveOutreachHours({start:'16:00',end:'09:00'}),/08:00/);
 assert.deepEqual(preference.saveOutreachHours({start:'09:30',end:'16:30'}),{start:'09:30',end:'16:30'});
 assert.equal(window.insideApproachWindow(new Date('2026-11-05T12:25:00Z')),false);
 assert.equal(window.insideApproachWindow(new Date('2026-11-05T12:30:00Z')),true);
 assert.equal(window.insideApproachWindow(new Date('2026-11-05T19:29:00Z')),true);
 assert.equal(window.insideApproachWindow(new Date('2026-11-05T19:30:00Z')),false);
});

test('calendar only reports accepted approaches and confirmed closed-won sales',()=>{
 const a=db.addLead({business:'Oficina Exemplo',city:'Sorocaba',phone:'5515999991234',source:'MANUAL'}).lead;
 const b=db.addLead({business:'Outro Exemplo',city:'Sorocaba',phone:'5515999991235',source:'MANUAL'}).lead;
 db.run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',a.id,a.phone,'SENT',db.id(),'2026-11-05T12:00:00.000Z');
 db.run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',b.id,b.phone,'UNKNOWN',db.id(),'2026-11-05T13:00:00.000Z');
 db.db.exec("CREATE TABLE IF NOT EXISTS sales_outcomes(lead_id TEXT PRIMARY KEY,status TEXT NOT NULL,source TEXT,provider_id TEXT,summary TEXT,updated_at TEXT)");
 db.run('INSERT INTO sales_outcomes(lead_id,status,source,summary,updated_at) VALUES(?,?,?,?,?)',a.id,'CLOSED_WON','MANUAL','Fechamento confirmado','2026-11-06T13:00:00.000Z');
 const r=calendar.monthlyProspectingCalendar('2026-11');
 assert.equal(r.totals.approached,1);
 assert.equal(r.totals.closed,1);
 assert.equal(r.days.find(x=>x.date==='2026-11-05').approachedCount,1);
 assert.equal(r.days.find(x=>x.date==='2026-11-05').conversionRate,100);
 assert.equal(r.days.find(x=>x.date==='2026-11-06').closedCount,1);
 assert.throws(()=>calendar.monthlyProspectingCalendar('2026-13'),/Mês inválido/);
});

test.after(()=>{db.db.close();fs.rmSync(dir,{force:true,recursive:true});});
