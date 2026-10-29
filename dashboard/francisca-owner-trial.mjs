// One intentionally authorized, one-time Francisca voice test to the owner's
// full WhatsApp number. Never sends to arbitrary contacts or retries an
// uncertain attempt. No production prospecting queue is involved.
import {db,one,run,now} from './db.mjs';
import {waControlStatus,waIdentityStatus,waRequest,selectedWaSession} from './waakg-control.mjs';
import {makeFranciscaVoice} from './francisca-tts.mjs';
import {sendVoiceMedia} from './waakg-media.mjs';
import {testModeAllowed} from './groq-live-test-guard.mjs';

const RECIPIENT='5515981817336',SENDER_SUFFIX='2994',ID='francisca-7336-voice-trial-v1';
export const FRANCISCA_TRIAL_MESSAGE='Olá! Aqui é a Francisca, assistente virtual da Consecom Brasil. Estou pronta para nosso teste de áudio. Pode responder a esta mensagem com a sua voz? Vou transcrever o que você disser e responder por aqui.';
db.exec("CREATE TABLE IF NOT EXISTS francisca_qa_once(id TEXT PRIMARY KEY,recipient TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,error_code TEXT)");
export async function sendOneTimeFranciscaTrial(deps={}){
 const enabled=process.env.RUN_FRANCISCA_7336_SEND_ONCE==='true'&&
   process.env.PROSPECTOR_LIVE_TEST_ENABLED==='true'&&
   testModeAllowed(RECIPIENT)&&
   process.env.FRANCISCA_TTS_ENABLED==='true'&&
   process.env.AI_CONVERSATION_AUTOSEND==='false'&&
   process.env.PROSPECTOR_INBOUND_AUTOREPLY_ENABLED!=='true';
 if(!enabled)return {state:'DISABLED',accepted:false};
 if(one('SELECT id FROM francisca_qa_once WHERE id=?',ID))return {state:'ALREADY_ATTEMPTED',accepted:false};
 if(one('SELECT phone FROM suppressions WHERE phone=?',RECIPIENT))return {state:'OPT_OUT',accepted:false};
 const state=await (deps.status||waControlStatus)(),identity=await (deps.identity||waIdentityStatus)();
 const session=selectedWaSession()||state.sessionId;
 if(!state.connected||!session||!identity.connected||identity.numberSuffix!==SENDER_SUFFIX)
  return {state:'UNSAFE_SESSION',accepted:false,connected:!!state.connected,senderSuffix:identity.numberSuffix||null};
 let webhook=false;
 try{
  const hooks=await (deps.request||waRequest)('/api/webhooks/'+encodeURIComponent(session));
  webhook=Array.isArray(hooks.data)&&hooks.data.some(h=>h.isActive!==false&&
    h.url==='https://prospector-operacional-production.up.railway.app/api/wa-akg/webhook'&&
    Array.isArray(h.events)&&h.events.includes('message.received'));
 }catch{return {state:'WEBHOOK_ERROR',accepted:false};}
 if(!webhook)return {state:'WEBHOOK_MISSING',accepted:false};
 // Render audio first: a synthesis error is not a transport attempt.
 let voice;
 try{voice=await (deps.synthesize||makeFranciscaVoice)(FRANCISCA_TRIAL_MESSAGE);}
 catch(e){return {state:'TTS_FAILED',accepted:false,errorCode:String(e.message||'ERROR').slice(0,60)};}
 if(!Buffer.isBuffer(voice.bytes)||voice.bytes.length<256)return {state:'INVALID_VOICE',accepted:false};
 // Insert-before-send: even network timeout or deployment restart cannot
 // accidentally replay a voice message whose delivery state is unknown.
 const inserted=run('INSERT OR IGNORE INTO francisca_qa_once(id,recipient,state,created_at,updated_at) VALUES(?,?,?,?,?)',
  ID,RECIPIENT,'UNKNOWN',now(),now()).changes;
 if(inserted!==1)return {state:'ALREADY_ATTEMPTED',accepted:false};
 try{
  const ack=await (deps.send||sendVoiceMedia)({jid:RECIPIENT+'@s.whatsapp.net',session,bytes:voice.bytes});
  if(ack?.accepted!==true)return {state:'UNKNOWN',accepted:false};
  run("UPDATE francisca_qa_once SET state='ACCEPTED',updated_at=? WHERE id=?",now(),ID);
  return {state:'ACCEPTED',accepted:true,deliveredOnPhoneVerified:false,
   senderSuffix:SENDER_SUFFIX,recipientSuffix:'7336',voice:'pt-BR-FranciscaNeural',
   size:voice.bytes.length};
 }catch(e){
  run('UPDATE francisca_qa_once SET error_code=?,updated_at=? WHERE id=?',String(e.message||'UNKNOWN').slice(0,60),now(),ID);
  return {state:'UNKNOWN',accepted:false,requiresManualCheck:true,recipientSuffix:'7336'};
 }
}
