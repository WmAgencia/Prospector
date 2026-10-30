import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
const dir=fs.mkdtempSync(os.tmpdir()+'/francisca-contact-names-');
process.env.PROSPECTOR_DATA_DIR=dir;
process.env.PROSPECTOR_OWNER_PHONE='5515981817336';
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.PROSPECTOR_LIVE_TEST_ENABLED='false';
process.env.WA_AKG_CALL_LAB_ENABLED='true';
const owner={jid:'5515981817336@s.whatsapp.net',sessionId:'consecom-principal'};
const {recipientNameInVoice,findContactByName,contactChoiceFromSpeech}=await import('../dashboard/francisca-contact-names.mjs');
const {newVoiceDirectMessageFlow,interpretVoiceSend}=await import('../dashboard/francisca-owner-voice-messages.mjs');
const A={name:'João Silva',jid:'5515999992244@s.whatsapp.net',notify:'João'};
const B={name:'João Silva',jid:'5515999992245@s.whatsapp.net'};
const mocks=contacts=>async path=>{
 assert(path.startsWith('/api/contacts/consecom-principal?search='));
 assert(path.includes('limit=all'));
 return {status:true,data:contacts};
};
test('Spoken message to named WhatsApp contact is parsed without guessing a phone',()=>{
 assert.equal(recipientNameInVoice('Francisca, manda uma mensagem para o João Silva falando que chego às 19h'),'João Silva');
 const instruction=interpretVoiceSend('Manda uma mensagem para o João Silva falando que chego às 19h');
 assert.equal(instruction.phone,null);
 assert.equal(instruction.contactName,'João Silva');
 assert.equal(instruction.text,'chego às 19h');
 assert.equal(recipientNameInVoice('manda uma mensagem para 15 99999 2244 falando que olá'),null);
});
test('The WA-AKG contact lookup uses exact saved name, not notify or partial similarity',async()=>{
 const result=await findContactByName('joao silva',{sessionId:'consecom-principal',request:mocks([
  A,{name:'Outra Pessoa',jid:'5515988883333@s.whatsapp.net',notify:'joão silva'},
  {name:'João Silvinho',jid:'5515999994455@s.whatsapp.net'}
 ])});
 assert.equal(result.state,'MATCH');
 assert.equal(result.number,'5515999992244');
 assert.equal(result.name,'João Silva');
});
test('LID-only and conflicting WhatsApp identities are never turned into an invented phone',async()=>{
 const res=await findContactByName('Maria',{sessionId:'consecom-principal',request:mocks([
  {name:'Maria',jid:'12345@lid'},
  {name:'Maria',jid:'12346@lid',remoteJidAlt:'5515999981234@s.whatsapp.net'},
  {name:'Maria',jid:'5515999989999@s.whatsapp.net',remoteJidAlt:'5515999988888@s.whatsapp.net'}
 ])});
 assert.equal(res.state,'MATCH');
 assert.equal(res.number,'5515999981234');
});
test('Ambiguous saved contact is not selected automatically; spoken suffix disambiguates exactly',async()=>{
 const found=await findContactByName('João Silva',{sessionId:'consecom-principal',request:mocks([A,B])});
 assert.equal(found.state,'AMBIGUOUS');
 assert.equal(found.matches.length,2);
 assert.equal(contactChoiceFromSpeech('o terminado em 2245',found.matches).number,'5515999992245');
 assert.equal(contactChoiceFromSpeech('o terminado em 9999',found.matches),null);
});
test('Named contact can be sent ONLY after full spoken number and exact message preview',async()=>{
 let sends=[];
 const flow=newVoiceDirectMessageFlow({
  lookupContact:async()=>({state:'MATCH',number:'5515999992244',name:'João Silva'}),
  send:async x=>{sends.push(x);return {state:'DELIVERED'};}
 });
 try{
  const prepared=await flow.turn('Manda uma mensagem para o João Silva falando que chego às 19h',owner);
  assert.match(prepared,/Encontrei o contato João Silva/);
  assert.match(prepared,/DDD um, cinco, número nove/);
  assert.match(prepared,/chego às 19h/);
  assert.equal(sends.length,0);
  assert.equal(flow.state.stage,'confirm');
  const approved=await flow.turn('pode enviar',owner);
  assert.match(approved,/confirmou a entrega/);
  assert.equal(sends.length,1);
  assert.equal(sends[0].jid,'5515999992244@s.whatsapp.net');
  assert.equal(sends[0].text,'chego às 19h');
  assert.equal(await flow.turn('pode enviar',owner),null);
  assert.equal(sends.length,1);
 }finally{flow.end();}
});
test('Duplicate contact requires explicit suffix choice, then confirmation before any send',async()=>{
 let sends=0;
 const flow=newVoiceDirectMessageFlow({
  lookupContact:async()=>({state:'AMBIGUOUS',matches:[
   {name:'João Silva',number:'5515999992244'},
   {name:'João Silva',number:'5515999992245'}]}),
  send:async()=>{sends++;return {state:'ACCEPTED'};}
 });
 try{
  let answer=await flow.turn('Envia uma mensagem para o João Silva falando que tudo bem',owner);
  assert.match(answer,/mais de um contato/);
  assert.equal(flow.state.stage,'chooseContact');
  answer=await flow.turn('pode enviar',owner);
  assert.match(answer,/Diga o final/);
  assert.equal(sends,0);
  answer=await flow.turn('o de final 2245',owner);
  assert.match(answer,/DDD um, cinco/);
  assert.equal(flow.state.stage,'confirm');
  assert.equal(sends,0);
  await flow.turn('pode enviar',owner);
  assert.equal(sends,1);
 }finally{flow.end();}
});
test('Unknown/unavailable saved name requires phone rather than guessing',async()=>{
 for(const state of ['NOT_FOUND','UNAVAILABLE']){
  let sends=0;
  const flow=newVoiceDirectMessageFlow({lookupContact:async()=>({state}),send:async()=>{sends++;}});
  try{
   const msg=await flow.turn('Envia mensagem para Mariana falando que te ligo depois',owner);
   assert.match(msg,state==='NOT_FOUND'?/Não encontrei/:/Não consegui consultar/);
   assert.equal(flow.state.stage,'phone');
   assert.equal(sends,0);
  }finally{flow.end();}
 }
});
test.after(async()=>{const {db}=await import('../dashboard/db.mjs');db.close();fs.rmSync(dir,{recursive:true,force:true});});
