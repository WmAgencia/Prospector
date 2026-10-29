// Internal WA-AKG voice turn bridge. Called only with an out-of-band shared secret.
// Inbound audio and responses are ephemeral; never stored or shown to other contacts.
import crypto from 'node:crypto';
import {newFranciscaCallSession,verifyVoiceOwner,convertM4aToPcm16,callLabStatus} from './francisca-call-lab.mjs';
import {makeFranciscaCallPcm} from './francisca-tts.mjs';
const sessions=new Map();
const MAX_SAMPLES=16000*2*14;
export function callBridgeStatus(){return {...callLabStatus(),bridgeConfigured:(process.env.WA_CALL_BRIDGE_SECRET||'').length>=40,activeCalls:sessions.size};}
export function authorizeCallBridge(key){
 const expected=String(process.env.WA_CALL_BRIDGE_SECRET||''),received=String(key||'');
 if(expected.length<40||received.length!==expected.length)return false;
 return crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(received));
}
function prune(){for(const [id,v] of sessions)if(Date.now()-v.updated>5*60_000){v.session.end();sessions.delete(id);}}
export async function processCallBridge(a={}){
 if(!a||typeof a!=='object')throw Error('CALL_BAD_REQUEST');
 const callId=String(a.callId||'');
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(callId))throw Error('CALL_ID_INVALID');
 const identity=verifyVoiceOwner({jid:a.jid,sessionId:a.sessionId});
 prune();
 if(a.event==='end'){
  const c=sessions.get(callId);
  if(c){c.session.end();sessions.delete(callId);}
  return {ok:true,ended:true};
 }
 if(!['greeting','turn'].includes(a.event))throw Error('CALL_EVENT_INVALID');
 if(sessions.size>2&&!sessions.has(callId))throw Error('CALL_CAPACITY');
 let c=sessions.get(callId);
 if(c&&(c.jid!==identity.jid||c.sessionId!==identity.sessionId))throw Error('CALL_IDENTITY_CHANGED');
 if(!c){c={jid:identity.jid,sessionId:identity.sessionId,session:newFranciscaCallSession(identity),updated:Date.now()};sessions.set(callId,c);}
 c.updated=Date.now();
 if(a.event==='greeting'){
  const greet='Alô! Aqui é a Francisca, da Consecom. Estou ouvindo, pode falar.';
  const voice=await makeFranciscaCallPcm(greet);
  return {ok:true,event:'greeting',spoken:greet,rate:16000,pcm16k:voice.pcm16k.toString('base64')};
 }
 if(typeof a.pcm16k!=='string'||a.pcm16k.length>Math.ceil(MAX_SAMPLES*4/3)+1024)throw Error('CALL_AUDIO_TOO_LARGE');
 const pcm=Buffer.from(a.pcm16k,'base64');
 if(pcm.length<16000||pcm.length>MAX_SAMPLES||pcm.length%2)throw Error('CALL_AUDIO_INVALID');
 const reply=await c.session.reply(pcm);
 return {ok:true,event:'reply',heard:reply.heard,spoken:reply.spoken,rate:reply.rate,pcm16k:reply.pcm16k.toString('base64')};
}
