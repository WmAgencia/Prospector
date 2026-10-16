import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {db,run,one,audit} from './db.mjs';

db.exec('CREATE TABLE IF NOT EXISTS whatsapp_retry_messages(jid TEXT NOT NULL,message_id TEXT NOT NULL,payload TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(jid,message_id))');
const RETENTION=7*86400000;
let writes=0;
export function rememberMessage(message,codec){
 const key=message?.key;
 if(!key?.id||!key.remoteJid||!message.message)return false;
 const encoded=Buffer.from(codec.encode(message.message).finish());
 if(encoded.length>4*1024*1024)return false;
 run('INSERT OR REPLACE INTO whatsapp_retry_messages VALUES(?,?,?,?)',key.remoteJid,key.id,encoded.toString('base64'),Date.now());
 if(++writes%100===1){
  run('DELETE FROM whatsapp_retry_messages WHERE at<?',Date.now()-RETENTION);
  run('DELETE FROM whatsapp_retry_messages WHERE rowid IN (SELECT rowid FROM whatsapp_retry_messages ORDER BY at DESC LIMIT -1 OFFSET 5000)');
 }
 return true;
}
export function retryMessage(key,codec){
 if(!key?.remoteJid||!key.id)return undefined;
 const row=one('SELECT payload,at FROM whatsapp_retry_messages WHERE jid=? AND message_id=?',key.remoteJid,key.id);
 if(!row||row.at<Date.now()-RETENTION)return undefined;
 return codec.decode(Buffer.from(row.payload,'base64'));
}
export function createRetryCache(clock=Date.now){
 const data=new Map(),ttl=3600000;
 return {
  get(key){const x=data.get(key);if(!x||x.expires<=clock()){data.delete(key);return undefined;}return x.value;},
  set(key,value){if(data.size>=10000&&!data.has(key))data.delete(data.keys().next().value);data.set(key,{value,expires:clock()+ttl});return true;},
  // Keep exhausted counters until expiry, including across socket restarts.
  del(key){if((this.get(key)||0)>=5)return 0;return data.delete(key)?1:0;},
  flushAll(){data.clear();}
 };
}
export function recoveryRepository(factory,{folder,onFailure=()=>{},onSuccess=()=>{},clock=Date.now}={}){
 const failures=new Map(),lastRepair=new Map();
 return auth=>{
  const repository=factory(auth),decrypt=repository.decryptMessage.bind(repository);
  repository.decryptMessage=async input=>{
   try{const result=await decrypt(input);failures.delete(input.jid);onSuccess(input.jid);return result;}
   catch(error){
    const recoverable=/No matching sessions found|Over 2000 messages into the future|No session record|No sessions available/i.test(String(error.message));
    if(!recoverable)throw error;
    onFailure(input.jid);
    const peer=crypto.createHash('sha256').update(input.jid).digest('hex').slice(0,16);
    const count=(failures.get(input.jid)||0)+1;failures.set(input.jid,count);
    if(count>=2&&(!lastRepair.has(input.jid)||clock()-lastRepair.get(input.jid)>=600000)){
     const address=repository.jidToSignalProtocolAddress(input.jid);
     const previous=await auth.keys.get('session',[address]);
     if(previous[address]){
      // Preserve the affected peer key before renewing it. Never remove account credentials.
      const directory=path.join(folder,'session-recovery');
      await fs.mkdir(directory,{recursive:true,mode:0o700});
      await fs.writeFile(path.join(directory,peer+'.json'),JSON.stringify(previous[address]),{mode:0o600});
      await auth.keys.set({session:{[address]:null}});
      lastRepair.set(input.jid,clock());failures.delete(input.jid);
      audit('WHATSAPP_PEER_SESSION_RENEWED',null,{peer,reason:'repeated_decryption_failure'});
      console.warn('[whatsapp] Chave de uma conversa renovada; aguardando reenvio criptografado');
     }
    }
    // Baileys handles the ciphertext failure and requests a fresh encrypted copy.
    throw error;
   }
  };
  return repository;
 };
}
