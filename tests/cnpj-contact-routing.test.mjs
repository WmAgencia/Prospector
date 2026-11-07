import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-cnpj-route-'));
process.env.PROSPECTOR_DATA_DIR=folder;
const db=await import('../dashboard/db.mjs');
const {recordOrigin}=await import('../dashboard/discovery.mjs');
const {isSameBusiness}=await import('../dashboard/cnpj-identity-match.mjs');
const {enrichDecisorLead}=await import('../dashboard/decisor-enrichment.mjs');
const {selectionStatus,routingAllowsOutreach,checkWhatsappNumber}=await import('../dashboard/business-contact-routing.mjs');
const {greetingForProspect,CNPJ_FOLLOWUP_INTRO}=await import('../dashboard/prospecting-introduction.mjs');

const CNPJ='00000000000191';
const companyPhone='5515988888888';
const originalPhone='5515977777777';
const rawCompany=()=>({success:true,data:{
 cnpj:CNPJ,razaoSocial:'MECANICA TESTE LTDA',nomeFantasia:'MECANICA TESTE',
 municipio:'Sorocaba',uf:'SP',logradouro:'Rua Quinze de Novembro',
 numero:'123',bairro:'Centro',cep:'18010000',telefone:'(15) 98888-8888',
 socios:[{nomeSocio:'ROGÉRIO DA SILVA',descricao:'Sócio-Administrador'}]
}});
let seq=0;
function foundMapsCompany({business='MECANICA TESTE',address='Rua Quinze de Novembro, 123, Centro, Sorocaba - SP, 18010-000',city='Sorocaba'}={}){
 const k=++seq;
 const lead=db.addLead({business,city,phone:'1597777'+String(7000+k).padStart(4,'0'),
  source:'maps_extension',maps_id:'https://www.google.com/maps/place/mecanica-test-'+k,contact_permission:false}).lead;
 recordOrigin(lead.id,'maps_extension',{identity:'https://www.google.com/maps/place/mecanica-test-'+k,
  address,city,cnpj:CNPJ,phone:lead.phone});
 return lead;
}
const mockFetch=async()=>({status:200,ok:true,json:async()=>rawCompany()});
const yes=async() => ({state:'YES'});
const no=async() => ({state:'NO'});
test('exact company name, municipality, street, number and ZIP match',()=>{
 const company={company:'MECANICA TESTE LTDA',fantasy:'MECANICA TESTE',city:'Sorocaba',
  address:{street:'Rua Quinze de Novembro',number:'123',city:'Sorocaba',state:'SP',postcode:'18010000'}};
 const lead={business:'Mecânica Teste',city:'Sorocaba'};
 const source={raw:'R. Quinze de Novembro, 123, Centro, Sorocaba - SP, 18010-000',city:'Sorocaba'};
 assert.equal(isSameBusiness(lead,company,source),true);
 assert.equal(isSameBusiness(lead,company,{...source,raw:'R. Quinze de Novembro, 124, Sorocaba'}),false);
 assert.equal(isSameBusiness(lead,{...company,fantasy:'OUTRA EMPRESA'},source),false);
 assert.equal(isSameBusiness(lead,company,{...source,raw:''}),false);
 assert.equal(isSameBusiness(lead,company,{street:'Rua Quinze de Novembro',number:'123',city:'Campinas'}),false);
 assert.equal(isSameBusiness(lead,company,{street:'Rua Quinze de Novembro',number:'123',city:'Sorocaba',postcode:'18011000'}),false);
});
test('WA-AKG validation uses the actual check route and treats no response as unknown',async()=>{
 const checkSession=async()=>({connected:true,sessionId:'prospector-test'});
 const request=async(url,data)=>{
  assert.equal(url,'/api/chat/prospector-test/check');
  assert.equal(data.method,'POST');
  assert.deepEqual(data.data.numbers,[companyPhone]);
  return {success:true,results:[{number:companyPhone,exists:true,jid:companyPhone+'@s.whatsapp.net'}]};
 };
 assert.equal((await checkWhatsappNumber(companyPhone,{request,checkSession})).state,'YES');
 assert.equal((await checkWhatsappNumber(companyPhone,{request:async()=>({success:true,results:[]}),checkSession})).state,'UNKNOWN');
 assert.equal((await checkWhatsappNumber(companyPhone,{request,checkSession:async()=>({connected:false})})).state,'UNKNOWN');
 assert.equal((await checkWhatsappNumber(companyPhone,{request:async()=>({results:[{number:companyPhone,exists:false}]}),checkSession})).state,'NO');
});
test('CNPJ phone replaces business listing phone only with strict match and WhatsApp YES',async()=>{
 const lead=foundMapsCompany();
 const initial=db.one('SELECT phone FROM leads WHERE id=?',lead.id).phone;
 const r=await enrichDecisorLead(lead.id,{fetchImpl:mockFetch,checkWhatsapp:async p=>({state:p===companyPhone?'YES':'NO'})});
 assert.equal(r.status,'ENRICHED');
 assert.equal(r.route,'READY_CNPJ');
 assert.equal(db.one('SELECT phone FROM leads WHERE id=?',lead.id).phone,companyPhone);
 assert.equal(selectionStatus(lead.id).original_phone,initial);
 assert.equal(selectionStatus(lead.id).route_source,'cnpj_registered');
 assert.equal(db.one('SELECT decision_maker FROM lead_decisor_enrichment WHERE lead_id=?',lead.id).decision_maker,'ROGÉRIO DA SILVA');
 assert.equal(greetingForProspect({id:lead.id,business:lead.business}),'Oi, tudo bem? Me chamo Wesley, queria falar com Rogério.');
 assert.match(CNPJ_FOLLOWUP_INTRO,/Consecom/);
});
test('unregistered CNPJ phone falls back to WhatsApp from Google Maps',async()=>{
 const lead=foundMapsCompany();
 const original=lead.phone;
 const checked=[];
 const r=await enrichDecisorLead(lead.id,{fetchImpl:mockFetch,checkWhatsapp:async p=>{
  checked.push(p);return {state:p===companyPhone?'NO':'YES'};
 }});
 assert.equal(r.route,'READY_MAPS');
 assert.equal(selectionStatus(lead.id).chosen_phone,original);
 assert.equal(db.one('SELECT phone FROM leads WHERE id=?',lead.id).phone,original);
 assert.deepEqual(checked,[companyPhone,original]);
 assert.doesNotMatch(greetingForProspect({id:lead.id,business:lead.business}),/queria falar com Rogério/);
});
test('mismatched address or city never promotes CNPJ phone',async()=>{
 const lead=foundMapsCompany({address:'Rua Quinze de Novembro, 124, Centro, Sorocaba'});
 const original=lead.phone;
 const requested=[];
 const r=await enrichDecisorLead(lead.id,{fetchImpl:mockFetch,checkWhatsapp:async p=>{requested.push(p);return {state:'YES'};}});
 assert.equal(r.status,'NO_MATCH');
 assert.equal(r.route,'READY_MAPS');
 assert.deepEqual(requested,[original]);
 assert.equal(db.one('SELECT phone FROM leads WHERE id=?',lead.id).phone,original);
});
test('neither phone has WhatsApp: block autonomous approach, preserve original',async()=>{
 const lead=foundMapsCompany();
 const r=await enrichDecisorLead(lead.id,{fetchImpl:mockFetch,checkWhatsapp:no});
 assert.equal(r.route,'NO_WHATSAPP');
 assert.equal(routingAllowsOutreach(lead.id),false);
 assert.equal(db.one('SELECT phone FROM leads WHERE id=?',lead.id).phone,lead.phone);
});
test('gateway outage never counts as a negative, and neither number is sent',async()=>{
 const lead=foundMapsCompany();
 const r=await enrichDecisorLead(lead.id,{fetchImpl:mockFetch,checkWhatsapp:async()=>({state:'UNKNOWN'})});
 assert.equal(r.route,'PENDING_CHECK');
 assert.equal(routingAllowsOutreach(lead.id),false);
 assert.equal(db.one('SELECT phone FROM leads WHERE id=?',lead.id).phone,lead.phone);
});
test('an already started conversation locks the original number',async()=>{
 const lead=foundMapsCompany();
 db.run('INSERT INTO initial_contacts(lead_id,phone,status,job_id,created_at) VALUES(?,?,?,?,?)',lead.id,lead.phone,'SENT',db.id(),db.now());
 const r=await enrichDecisorLead(lead.id,{fetchImpl:mockFetch,checkWhatsapp:yes});
 assert.equal(r.route,'LOCKED');
 assert.equal(db.one('SELECT phone FROM leads WHERE id=?',lead.id).phone,lead.phone);
});
test.after(()=>{db.db.close();fs.rmSync(folder,{force:true,recursive:true});});
