import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/consecom-concierge-');
process.env.PROSPECTOR_DATA_DIR=dir;
const db=await import('../dashboard/db.mjs');
const {classifyInbound,firstGreeting,queueInboundBrief,personalPhone,flushPersonalNotices,statusConcierge}=await import('../dashboard/personal-concierge.mjs');
const original={n:process.env.PROSPECTOR_PERSONAL_PHONE,enabled:process.env.PROSPECTOR_PERSONAL_NOTICES_ENABLED};
const set=()=>{process.env.PROSPECTOR_PERSONAL_PHONE='5515981817336';process.env.PROSPECTOR_PERSONAL_NOTICES_ENABLED='true';};
test('Short greetings are answered with transparent assistance, not invented sales pitch',()=>{
 for(const greeting of ['Oi','Olá','Oie!','Bom dia','Boa tarde','Boa noite!','Tudo bem?']){
  const x=classifyInbound(greeting);
  assert.equal(x.category,'greeting',greeting);assert.equal(x.intro,true);
 }
 assert.match(firstGreeting(),/assistente virtual da Consecom/);
 assert.match(firstGreeting(),/Como posso ajudar\?/);
});
test('Triage separates service questions, support, human escalation and other messages',()=>{
 const rows=[
  ['Preciso de orçamento para meu site','commercial'],
  ['O site não funciona','support'],
  ['Preciso falar com um humano','human'],
  ['Vocês podem me passar o endereço?','other'],
  ['Quero cancelar e não quero mensagens','other'],
  ['Pare!','opt_out']
 ];
 for(const [message,kind] of rows)assert.equal(classifyInbound(message).category,kind,message);
});
test('A suffix alone is never a valid configured owner phone',()=>{
 process.env.PROSPECTOR_PERSONAL_PHONE='7366';process.env.PROSPECTOR_PERSONAL_NOTICES_ENABLED='true';
 assert.equal(personalPhone(),null);
 const lead=db.addLead({business:'Empresa teste',phone:'5515999991212',source:'MANUAL'}).lead;
 assert.equal(queueInboundBrief({leadId:lead.id,phone:lead.phone,body:'Oi'}),false);
 assert.equal(db.one("SELECT COUNT(*) n FROM owner_notices WHERE kind='PERSONAL_INBOUND'").n,0);
});
test('First-contact brief is queued only once, and notification gateway never sends to a lead',async()=>{
 set();
 const lead=db.addLead({business:'Empresa Beta',phone:'5515999991213',source:'MANUAL'}).lead;
 assert.equal(queueInboundBrief({leadId:lead.id,phone:lead.phone,body:'Como funciona o serviço?'}),true);
 assert.equal(queueInboundBrief({leadId:lead.id,phone:lead.phone,body:'Quanto custa?'}),false);
 assert.equal(db.one("SELECT COUNT(*) n FROM owner_notices WHERE kind='PERSONAL_INBOUND'").n,1);
 assert.equal(statusConcierge().notificationPhoneConfigured,true);
 let calls=0,route='';
 const deps={
  getStatus:async()=>({connected:true,sessionId:'consecom-principal'}),
  getIdentity:async()=>({connected:true,numberSuffix:'2994'}),
  send:async(path,args)=>{calls++;route=path;assert.match(args.data.message.text,/Novo contato recebido/);return {status:true};}
 };
 const n=await flushPersonalNotices(deps);
 assert.equal(n,1);assert.equal(calls,1);
 assert.match(route,/5515981817336%40s\.whatsapp\.net/);
 assert.equal((await flushPersonalNotices(deps)),0);
 assert.equal(calls,1);
 assert.equal(db.one("SELECT status FROM owner_notices WHERE kind='PERSONAL_INBOUND'").status,'SENT');
});
test('Never send when gateway account is recipient or disconnected',async()=>{
 set();
 const lead=db.addLead({business:'Empresa Gamma',phone:'5515999991214',source:'MANUAL'}).lead;
 queueInboundBrief({leadId:lead.id,phone:lead.phone,body:'Olá'});
 let calls=0;
 const fake={getStatus:async()=>({connected:true,sessionId:'consecom-principal'}),
   getIdentity:async()=>({connected:true,numberSuffix:'7336'}),send:async()=>{calls++;return {status:true};}};
 assert.equal((await flushPersonalNotices(fake)),0);
 assert.equal(calls,0);
});
test.after(()=>{
 if(original.n===undefined)delete process.env.PROSPECTOR_PERSONAL_PHONE;else process.env.PROSPECTOR_PERSONAL_PHONE=original.n;
 if(original.enabled===undefined)delete process.env.PROSPECTOR_PERSONAL_NOTICES_ENABLED;else process.env.PROSPECTOR_PERSONAL_NOTICES_ENABLED=original.enabled;
 db.db.close();fs.rmSync(dir,{force:true,recursive:true});
});
