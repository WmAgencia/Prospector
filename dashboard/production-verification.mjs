// Explicit, single-use operator verification. Never called by queues or campaigns.
const recipient='5515981817336',jid=recipient+'@s.whatsapp.net';
const text='Teste autorizado de produção do Prospector: mensagem de texto para validar o envio. Confirme o recebimento no seu WhatsApp.';
const speech='Olá! Este é o teste autorizado de produção do Prospector, com a voz Francisca. Por favor, confirme o recebimento deste áudio.';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function messageId(result){
 const value=result?.data?.key?.id||result?.data?.messageId||result?.key?.id||result?.providerMessageId;
 return typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value)?value:null;
}
export async function runProductionVerification(deps={}){
 const env=deps.env||process.env,report=state=>({state,recipientSuffix:'7336',delivery:'UNVERIFIED_ON_PHONE'});
 if(env.PROSPECTOR_PRODUCTION_VERIFY_ENABLED!=='true')return report('DISABLED');
 const verificationId=String(env.PROSPECTOR_PRODUCTION_VERIFY_ID||'').toLowerCase();
 if(!uuid.test(verificationId))return report('INVALID_ID');
 // Resolve production transports only after explicit activation; tests inject isolated dependencies.
 const storage=deps.database?null:await import('./db.mjs');
 const database=deps.database||storage.db;
 const control=deps.selected&&deps.status&&deps.request?null:await import('./waakg-control.mjs');
 const selected=deps.selected||control.selectedWaSession,status=deps.status||control.waControlStatus;
 const request=deps.request||control.waRequest;
 const suppressed=deps.suppressed||storage.suppressed;
 const synthesize=deps.synthesize||(await import('./francisca-tts.mjs')).makeFranciscaVoice;
 const sendVoice=deps.sendVoice||(await import('./waakg-media.mjs')).sendVoiceMedia;
 database.exec(`CREATE TABLE IF NOT EXISTS production_verifications(id TEXT PRIMARY KEY,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS production_verification_parts(verification_id TEXT NOT NULL,part TEXT NOT NULL CHECK(part IN ('TEXT','VOICE')),state TEXT NOT NULL CHECK(state IN ('UNKNOWN','ACCEPTED')),provider_message_id TEXT,PRIMARY KEY(verification_id,part));`);
 const exists=()=>database.prepare('SELECT id FROM production_verifications WHERE id=?').get(verificationId);
 const parts=()=>database.prepare('SELECT part,state,provider_message_id AS providerMessageId FROM production_verification_parts WHERE verification_id=? ORDER BY part').all(verificationId).map(row=>({...row}));
 if(exists())return {...report('ALREADY_RESERVED'),parts:parts()};
 let session,blockedReason='STATUS_ERROR';
 const blocked=()=>({...report('BLOCKED'),blockedReason});
 async function ready(){
  blockedReason='STATUS_ERROR';
  if(suppressed(recipient)){blockedReason='SUPPRESSED';return false;}
  const picked=selected(),remote=await status();
  if(!remote.connected){blockedReason='OFFLINE';return false;}
  if(!picked||remote.sessionId!==picked||(session&&session!==picked)){blockedReason='SESSION_MISMATCH';return false;}
  const detail=await request('/api/sessions/'+encodeURIComponent(picked));
  if(detail.data?.sessionId&&detail.data.sessionId!==picked){blockedReason='SESSION_MISMATCH';return false;}
  const raw=String(detail.data?.me?.id||detail.data?.me?.jid||'');
  const sender=raw.split('@')[0].split(':')[0];
  if(!/^\d{10,15}$/.test(sender)){blockedReason='INVALID_IDENTITY';return false;}
  if(sender===recipient){blockedReason='SELF_SENDER';return false;}
  session=picked;return true;
 }
 try{if(!await ready())return blocked();}catch{return blocked();}
 let voice;
 try{voice=await synthesize(speech);if(!Buffer.isBuffer(voice?.bytes)||voice.bytes.length<256)throw Error('INVALID_AUDIO');}
 catch{return report('VOICE_UNAVAILABLE');}
 try{if(!await ready())return blocked();}catch{return blocked();}
 // Atomic reservation binds this ID to both fixed parts before any outbound request.
 // A crash or timeout leaves UNKNOWN permanently; no restart resumes this verification.
 database.exec('BEGIN IMMEDIATE');
 try{
  if(exists()){database.exec('ROLLBACK');return {...report('ALREADY_RESERVED'),parts:parts()};}
  database.prepare('INSERT INTO production_verifications VALUES(?,?)').run(verificationId,new Date().toISOString());
  for(const part of ['TEXT','VOICE'])database.prepare("INSERT INTO production_verification_parts(verification_id,part,state) VALUES(?,?,'UNKNOWN')").run(verificationId,part);
  database.exec('COMMIT');
 }catch(error){database.exec('ROLLBACK');throw error;}
 try{
  for(const part of ['TEXT','VOICE']){
   try{if(!await ready())return {...blocked(),parts:parts()};}catch{return {...blocked(),parts:parts()};}
   const result=part==='TEXT'
    ?await request('/api/messages/'+encodeURIComponent(session)+'/'+encodeURIComponent(jid)+'/send',{method:'POST',data:{message:{text}}})
    :await sendVoice({jid,session,bytes:voice.bytes});
   if(part==='TEXT'?result?.status!==true:result?.accepted!==true)throw Error('UNCONFIRMED');
   database.prepare("UPDATE production_verification_parts SET state='ACCEPTED',provider_message_id=? WHERE verification_id=? AND part=?").run(messageId(result),verificationId,part);
  }
  return {...report('PROVIDER_ACCEPTED'),parts:parts()};
 }catch{return {...report('UNKNOWN'),parts:parts()};}
}
