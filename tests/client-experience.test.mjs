import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-client-ux-'));
process.env.PROSPECTOR_DATA_DIR=temp;
const db=await import('../dashboard/db.mjs');
await import('../dashboard/sales-outcomes.mjs');
const {prospectingCalendar,localDay}=await import('../dashboard/prospecting-calendar.mjs');
const {getProspectingPreferences,setProspectingPreferences,effectiveDiscoveryScope}=await import('../dashboard/prospecting-preferences.mjs');
const {handlePanelAssistant,panelAssistantContext}=await import('../dashboard/francisca-panel-assistant.mjs');

test('calendar counts only accepted sends and confirmed sales on local São Paulo days',()=>{
 const business=db.addLead({business:'Cliente Exemplo',city:'Sorocaba',phone:'11988776655'}).lead;
 const other=db.addLead({business:'Outro Contato',city:'Campinas',phone:'11988776656'}).lead;
 const time='2026-11-06T01:40:00.000Z'; // November 5th, São Paulo.
 assert.equal(localDay(time),'2026-11-05');
 db.run("INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)",business.id,business.phone,'SENT',crypto.randomUUID(),time);
 db.run("INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)",other.id,other.phone,'UNKNOWN',crypto.randomUUID(),time);
 db.run("INSERT INTO sales_outcomes(lead_id,status,source,summary,updated_at) VALUES(?,?,?,?,?)",business.id,'CLOSED_WON','PRODUCTION','Negociação confirmada',time);
 const report=prospectingCalendar({month:'2026-11',day:'2026-11-05',kind:'approached'});
 const day=report.days.find(x=>x.day==='2026-11-05');
 assert.equal(day.approached,1);assert.equal(day.closed,1);assert.equal(day.conversionRate,100);
 assert.equal(report.detail.items.length,1);
 assert.equal(report.detail.items[0].business,'Cliente Exemplo');
 assert.equal(prospectingCalendar({month:'2026-11',day:'2026-11-05',kind:'closed'}).detail.items.length,1);
 assert.throws(()=>prospectingCalendar({month:'invalid'}),/Mês inválido/);
 assert.throws(()=>prospectingCalendar({month:'2026-11',kind:'secret'}),/Categoria inválida/);
});

test('automatic research preference stays tenant-local, accepts only known cities and niches',()=>{
 const all=getProspectingPreferences();
 assert.equal(all.mode,'all');
 const changed=setProspectingPreferences({mode:'niche_city',niche:'oficina',city:'Sorocaba'});
 assert.equal(changed.city,'Sorocaba');
 assert.equal(effectiveDiscoveryScope().cities.length,1);
 assert.equal(effectiveDiscoveryScope().segments.length,1);
 assert.throws(()=>setProspectingPreferences({mode:'niche_city',niche:'oficina',city:'Cidade inexistente'}),/Cidade não disponível/);
 assert.throws(()=>setProspectingPreferences({mode:'niche_all_cities',niche:'categoria-que-nao-existe'}),/Nicho não disponível/);
 const global=setProspectingPreferences({mode:'all',city:'segredo',niche:'xxx'});
 assert.equal(global.city,'');assert.equal(global.niche,'');
 assert.ok(effectiveDiscoveryScope().cities.length>10);
});

test('Francisca only receives local database context and never runs actions',async()=>{
 db.setSetting('training_business',{name:'Minha Agência',description:'Marketing para oficinas'});
 db.setSetting('training_active',{id:'approved',text:'Não prometer resultados',at:new Date().toISOString()});
 const ctx=panelAssistantContext();
 assert.equal(ctx.companyName,'Minha Agência');
 assert.equal(ctx.trainingApproved,true);
 assert.equal(ctx.autoApproach,false);
 let response;
 const received=await handlePanelAssistant({method:'POST'},{},{pathname:'/api/assistant/panel/turn'},
  {json:async()=>({text:'Quais são as empresas recentes?'}),respond:(res,status,data)=>{response={status,data};}},
  {model:async args=>{
   assert.equal(args.task,'voice');
   assert.ok(args.messages[0].content.includes('Minha Agência'));
   assert.ok(args.messages[0].content.includes('Não posso executar ações'));
   return {choice:{content:'Você tem empresas recentes no seu painel. Confira a lista de prospecção.'}};
  }});
 assert.equal(received,true);
 assert.equal(response.status,200);
 assert.equal(response.data.readOnly,true);
 assert.match(response.data.text,/empresas recentes/);
 assert.equal(response.data.audioBase64,null);
 let error;
 await handlePanelAssistant({method:'POST'},{},{pathname:'/api/assistant/panel/turn'},
  {json:async()=>({text:'ok',audioBase64:'a'.repeat(300),audioType:'image/jpeg'}),respond:(res,status,data)=>{error={status,data};}},
  {model:async()=>{throw Error('Must not call model for invalid audio');}});
 assert.equal(error.status,422);
});
test.after(()=>{
 db.db.close();
 fs.rmSync(temp,{recursive:true,force:true});
});
