import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-flow-'));
process.env.WA_AKG_SESSION_ID='consecom-principal';
process.env.PROSPECTOR_PITCH_AUDIO_ENABLED='true';
process.env.PROSPECTOR_REQUIRE_DOCUMENTED_OPTIN='true';
process.env.PROSPECTOR_GROUP_IMPORT_JID='12036302123456789@g.us';
const db=await import('../dashboard/db.mjs');
const {acceptsProposalAudio,interestedAfterProposal}=await import('../dashboard/prospector-sales-signals.mjs');
const {registerGreeting,routeIntroductionReply,introductionStatus,tickIntroductions,WESLEY_INTRO}=await import('../dashboard/prospecting-introduction.mjs');
const {recordInboundTranscript}=await import('../dashboard/waakg-bridge.mjs');
const {tickProspectorFarewells,queueProspectorFarewell,PROSPECTOR_FAREWELL}=await import('../dashboard/prospector-farewell.mjs');
const {handleSalesTurn,flushInterestAlerts}=await import('../dashboard/groq-sales-automation.mjs');
const {queueNotice}=await import('../dashboard/notifications.mjs');
let counter=1000;
function prospect(){
 const phone='55159976'+String(counter++).padStart(4,'0');
 const lead=db.addLead({business:'Oficina Fictícia '+counter,name:'João',phone,source:'maps_extension',contact_permission:true}).lead;
 db.audit('CONSENT_UPDATED',lead.id,{permitted:true,evidence:'Opt-in fictício no teste automatizado'});
 const jid=phone+'@s.whatsapp.net', greetingId=db.id(),thread=db.getThread(lead.id,jid);
 db.addMessage({threadId:thread.id,providerId:'prospect-queue:'+greetingId,direction:'out',body:'Olá, bom dia! Tudo bem?',status:'sent'});
 assert.equal(registerGreeting({leadId:lead.id,greetingId,sessionId:'consecom-principal'}),true);
 return {lead,jid,thread,greetingId};
}
async function introText({lead,jid},time=Date.now()-41000){
 const first=routeIntroductionReply({leadId:lead.id,providerId:'hello-'+lead.id,body:'Oi, tudo certo',receivedAt:new Date(time)});
 assert.equal(first.state,'WAITING');
 let textCount=0, audioCount=0;
 const result=await tickIntroductions({currentTime:()=>Date.now(),status:async()=>({connected:true}),session:()=> 'consecom-principal',
  send:async(_route,{data})=>{textCount++;assert.equal(data.message.text,WESLEY_INTRO);return {status:true};},
  sendAudio:async()=>{audioCount++;return {accepted:true};}});
 assert.equal(result.state,'SENT',JSON.stringify(result));
 assert.equal(textCount,1);assert.equal(audioCount,0);
 return result;
}
test('short positive replies authorize original audio but refusals do not',()=>{
 for(const phrase of ['sim','Claro','pode','Pode mandar','beleza','ok','Pode me mandar o áudio','Quero ouvir'])
  assert.equal(acceptsProposalAudio(phrase),true,phrase);
 for(const phrase of ['não quero','não pode','sem interesse','agora não','Não quero áudio','oi tudo bem'])
  assert.equal(acceptsProposalAudio(phrase),false,phrase);
 for(const phrase of ['Gostei da proposta','Tenho interesse','Podemos conversar?','Pode me ligar','Qual o valor?', 'sim'])
  assert.equal(interestedAfterProposal(phrase),true,phrase);
 for(const phrase of ['Não tenho interesse','Não gostei','Agora não','Não quero o site'])
  assert.equal(interestedAfterProposal(phrase),false,phrase);
});
test('first reply always sends permission question; only second permission sends voice, never substitute text',async()=>{
 const item=prospect();
 await introText(item);
 const first=routeIntroductionReply({leadId:item.lead.id,providerId:'permission-'+item.lead.id,body:'sim',receivedAt:new Date(Date.now()-41000)});
 assert.equal(first.state,'VOICE_WAITING');
 let text=0,audio=0;
 const delivered=await tickIntroductions({status:async()=>({connected:true}),session:()=> 'consecom-principal',
  loadAudio:async()=>({bytes:Buffer.alloc(300000,11)}),send:async()=>{text++;return {status:true};},
  sendAudio:async({jid,session})=>{audio++;assert.equal(jid,item.jid);assert.equal(session,'consecom-principal');return {accepted:true};}});
 assert.equal(delivered.state,'VOICE_SENT');
 assert.equal(audio,1);assert.equal(text,0);
 assert.equal((await tickIntroductions({sendAudio:async()=>{throw Error('duplicate');}})).state,'IDLE');
});
test('without audio asset, never send a different written offer',async()=>{
 const item=prospect();
 await introText(item);
 routeIntroductionReply({leadId:item.lead.id,providerId:'perm-'+item.lead.id,body:'pode mandar',receivedAt:new Date(Date.now()-41000)});
 let calls=0;
 const result=await tickIntroductions({status:async()=>({connected:true}),loadAudio:async()=>{throw Error('VOICE_ASSET_MISSING');},
  send:async()=>{calls++;return {status:true};},sendAudio:async()=>{calls++;return {accepted:true};}});
 assert.equal(result.state,'VOICE_ASSET_UNAVAILABLE');
 assert.equal(introductionStatus(item.lead.id).stage,'VOICE_WAITING');
 assert.equal(calls,0);
});
test('a refusal sends exactly one farewell; subsequent inbound does not revive the lead',async()=>{
 const item=prospect();
 const first=recordInboundTranscript({sessionId:'consecom-principal',jid:item.jid,
  unique:'consecom-principal:decline-'+item.lead.id,content:'Não tenho interesse, obrigado.'});
 assert.equal(first.status,200);
 assert.equal(db.one('SELECT stage FROM leads WHERE id=?',item.lead.id).stage,'NO_INTEREST');
 let sent=0;
 const result=await tickProspectorFarewells({status:async()=>({connected:true}),
  send:async(_url,{data})=>{sent++;assert.equal(data.message.text,PROSPECTOR_FAREWELL);return {status:true};}});
 assert.equal(result.state,'SENT');assert.equal(sent,1);
 const again=recordInboundTranscript({sessionId:'consecom-principal',jid:item.jid,
  unique:'consecom-principal:decline2-'+item.lead.id,content:'Obrigado, tchau.'});
 assert.equal(again.status,200);
 assert.equal(db.one('SELECT stage FROM leads WHERE id=?',item.lead.id).stage,'NO_INTEREST');
 assert.equal(queueProspectorFarewell({leadId:item.lead.id,sessionId:'consecom-principal',jid:item.jid}),false);
 assert.equal((await tickProspectorFarewells({send:async()=>{sent++;}})).state,'IDLE');
 assert.equal(sent,1);
 assert.equal(db.one('SELECT manual_takeover FROM threads WHERE lead_id=?',item.lead.id).manual_takeover,1);
});
test('positive reply after audio transfers silently to owner and queues one notice',async()=>{
 const item=prospect();
 await introText(item);
 routeIntroductionReply({leadId:item.lead.id,providerId:'perm-'+item.lead.id,body:'claro',receivedAt:new Date(Date.now()-41000)});
 const sent=await tickIntroductions({status:async()=>({connected:true}),session:()=> 'consecom-principal',
  loadAudio:async()=>({bytes:Buffer.alloc(300000,12)}),sendAudio:async()=>({accepted:true})});
 assert.equal(sent.state,'VOICE_SENT');
 const unique='consecom-principal:interest-'+item.lead.id;
 assert.equal(recordInboundTranscript({sessionId:'consecom-principal',jid:item.jid,unique,content:'Gostei, podemos conversar por chamada?'}).status,200);
 const reply=await handleSalesTurn(unique,{qualify:async()=>{throw Error('No AI needed after voice');}});
 assert.equal(reply.state,'HOT');
 assert.equal(db.one('SELECT stage FROM leads WHERE id=?',item.lead.id).stage,'INTERESTED');
 assert.equal(db.one('SELECT manual_takeover FROM threads WHERE lead_id=?',item.lead.id).manual_takeover,1);
 const notice=db.one("SELECT * FROM owner_notices WHERE kind='GROQ_HOT_LEAD' AND lead_id=?",item.lead.id);
 assert.ok(notice);
 assert.match(notice.message,/Oficina Fictícia/);
 assert.match(notice.message,/https:\/\/wa.me\//);
 const recipients=[];
 const delivered=await flushInterestAlerts({status:async()=>({connected:true,sessionId:'consecom-principal'}),
  groupInfo:async()=>({subject:'Meu Prospector',jid:'12036302123456789@g.us'}),
  send:async(route)=>{recipients.push(route);return {status:true};}});
 assert.equal(delivered,1);
 assert.equal(recipients.length,1);
 assert.match(recipients[0],/12036302123456789%40g.us/);
 assert.equal((await handleSalesTurn(unique)).state,'SKIP');
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
