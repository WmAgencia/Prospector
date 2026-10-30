import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileLooksTruncated,deliverVoiceDirectMessage,checkDeliveryById} from '../dashboard/francisca-message-delivery.mjs';

const jid='5515999992244@s.whatsapp.net',sessionId='consecom-principal';
const props={jid,sessionId,text:'Olá, tudo bem?'};
const messageId='3EB0FAKE6F8A9';
function fakeGateway({exists=true,lookupJid=jid,receipt='SENT',providerId=messageId,fromMe=true,remoteJid=jid,throwOnSend=false,checkFail=false}={}){
 const calls=[];
 const request=async (url,options={})=>{
  calls.push({url,method:options.method||'GET'});
  if(url.endsWith('/check')){
   if(checkFail)throw Error('NETWORK');
   return {status:true,data:{results:[{number:jid.split('@')[0],exists,jid:lookupJid}]}};
  }
  if(url.endsWith('/send')){
   if(throwOnSend)throw Error('REQUEST_FAILED');
   return {status:true,data:{key:{id:providerId,remoteJid:jid}}};
  }
  if(url.startsWith('/api/chat/'))return {status:true,data:[{
   keyId:messageId,remoteJid,fromMe,content:props.text,status:receipt
  }]};
  throw Error('UNEXPECTED '+url);
 };
 return {request,calls};
}
test('Reject truncated Brazilian mobile before any API request',async()=>{
 assert.equal(mobileLooksTruncated('551598114257'),true);
 assert.equal(mobileLooksTruncated('5515999992244'),false);
 const g=fakeGateway();
 const out=await deliverVoiceDirectMessage({...props,jid:'551598114257@s.whatsapp.net'},{request:g.request});
 assert.equal(out.state,'BLOCKED');
 assert.equal(g.calls.length,0);
});
test('Registered exact WhatsApp account is required before sending',async()=>{
 for(const settings of [{exists:false},{lookupJid:'5515999992245@s.whatsapp.net'},{checkFail:true}]){
  const g=fakeGateway(settings);
  const out=await deliverVoiceDirectMessage(props,{request:g.request});
  assert.equal(out.state,'BLOCKED');
  assert.equal(g.calls.filter(x=>x.url.endsWith('/send')).length,0);
 }
});
test('HTTP 200 with message key but no receipt proves only acceptance, NEVER delivery',async()=>{
 const g=fakeGateway({receipt:'SENT'});
 const out=await deliverVoiceDirectMessage(props,{request:g.request,pause:async()=>{},polls:2});
 assert.equal(out.state,'ACCEPTED');
 assert.equal(out.deliveryProof,false);
 assert.equal(out.providerId,messageId);
 assert.equal(g.calls.filter(x=>x.url.endsWith('/send')).length,1);
});
test('Only exact outgoing provider message ID with DELIVERED or READ proves delivery',async()=>{
 for(const receipt of ['DELIVERED','READ']){
  const g=fakeGateway({receipt});
  const out=await deliverVoiceDirectMessage(props,{request:g.request,pause:async()=>{},polls:1});
  assert.equal(out.state,receipt);
  assert.equal(out.deliveryProof,true);
  assert.equal(out.providerId,messageId);
 }
 for(const altered of [{fromMe:false},{remoteJid:'5515888888888@s.whatsapp.net'}]){
  const g=fakeGateway({...altered,receipt:'READ'});
  const out=await deliverVoiceDirectMessage(props,{request:g.request,pause:async()=>{},polls:1});
  assert.equal(out.state,'ACCEPTED');
  assert.equal(out.deliveryProof,false);
 }
});
test('Provider send errors or missing message IDs do not auto retry or claim success',async()=>{
 for(const opt of [{throwOnSend:true},{providerId:''}]){
  const g=fakeGateway(opt);
  const out=await deliverVoiceDirectMessage(props,{request:g.request,pause:async()=>{},polls:1});
  assert.equal(out.state,'UNKNOWN');
  assert.equal(g.calls.filter(x=>x.url.endsWith('/send')).length,1);
 }
});
test('A receipt lookup refuses messages from another contact',async()=>{
 const g=fakeGateway({receipt:'DELIVERED',remoteJid:'5515888888888@s.whatsapp.net'});
 const out=await checkDeliveryById({jid,sessionId,messageId},{request:g.request});
 assert.equal(out.proof,false);
});
