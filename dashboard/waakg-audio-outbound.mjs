// Manually approved Francisca audio replies, 1:1 inbound chats only.
import {db,one,run,now,addMessage,audit,addLead,getThread,stage,phone} from './db.mjs';
import {selectedWaSession,waControlStatus} from './waakg-control.mjs';
import {makeFranciscaVoice,voiceStatus,checkVoiceText} from './francisca-tts.mjs';
import {sendVoiceMedia} from './waakg-media.mjs';
db.exec("CREATE TABLE IF NOT EXISTS waakg_voice_outbox(id TEXT PRIMARY KEY,jid TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
export async function voicePreview(text,deps={}){
 const item=await (deps.synthesize||makeFranciscaVoice)(checkVoiceText(text));
 return {buffer:item.bytes,voice:item.voice,mimeType:'audio/mp4',size:item.bytes.length};
}
export async function sendApprovedVoice(input={},deps={}){
 const jid=String(input.jid||''),requestId=String(input.requestId||''),text=String(input.text||'');
 if(input.approve!==true||!/^[a-f0-9-]{36}$/i.test(requestId)||!/^\d{10,15}@s\.whatsapp\.net$/.test(jid))
  return {status:400,body:{error:'Confirmação e destinatário válidos são obrigatórios'}};
 try{checkVoiceText(text);}catch{return {status:400,body:{error:'Texto do áudio deve ter entre 2 e 650 caracteres'}};}
 if(one('SELECT id FROM waakg_voice_outbox WHERE id=?',requestId))return {status:409,body:{error:'Áudio já foi processado; confira a conversa antes de tentar novamente'}};
 const number=phone(jid.split('@')[0]);
 if(!number||one('SELECT phone FROM suppressions WHERE phone=?',number))return {status:403,body:{error:'Contato bloqueado'}};
 const lead=one('SELECT * FROM leads WHERE phone=?',number);
 if(!lead||!one("SELECT 1 FROM threads t JOIN messages m ON m.thread_id=t.id WHERE t.lead_id=? AND m.direction='in' LIMIT 1",lead.id))
  return {status:403,body:{error:'Áudio de resposta permitido apenas em conversas iniciadas pelo cliente'}};
 const remote=deps.status?await deps.status():await waControlStatus(),session=selectedWaSession()||remote.sessionId;
 if(!remote.connected||!session)return {status:503,body:{error:'WhatsApp não conectado'}};
 run('INSERT INTO waakg_voice_outbox(id,jid,status,created_at,updated_at) VALUES(?,?,?,?,?)',requestId,jid,'UNKNOWN',now(),now());
 try{
  const voice=await (deps.synthesize||makeFranciscaVoice)(text);
  const result=await (deps.send||sendVoiceMedia)({jid,session,bytes:voice.bytes});
  if(!result.accepted)throw Error('VOICE_UNKNOWN');
  run("UPDATE waakg_voice_outbox SET status='ACCEPTED',updated_at=? WHERE id=?",now(),requestId);
  const thread=getThread(lead.id,jid);
  addMessage({threadId:thread.id,providerId:'voice-manual:'+requestId,direction:'out',body:'[Áudio Francisca] '+text,status:'accepted'});
  stage(lead.id,'CONVERSING','OPERATOR_FRANCISCA_AUDIO');
  run('UPDATE threads SET manual_takeover=1 WHERE id=?',thread.id);
  audit('FRANCISCA_VOICE_ACCEPTED',lead.id,{manual:true,chars:text.length});
  return {status:200,body:{ok:true,delivery:'UNVERIFIED_ON_PHONE',voice:voiceStatus().voice}};
 }catch(error){
  return {status:502,body:{error:'Falha ou entrega incerta do áudio; não reenviar automaticamente',code:String(error.message).slice(0,50)}};
 }
}
