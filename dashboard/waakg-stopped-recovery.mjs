// Single-shot recovery for an already-configured STOPPED socket. Never
// logs out or resets credentials, never sends messages, and never tries to
// bypass a LOGGED_OUT session (a fresh WhatsApp QR scan is required).
import {waSessionList,waRequest,waControlStatus} from './waakg-control.mjs';
import {getSetting,setSetting,now,audit} from './db.mjs';
const MARKER='wa_stopped_single_recovery_20261116';
export async function recoverStoppedWhatsAppOnce({wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(getSetting(MARKER,false)===true)return {state:'ALREADY_RUN'};
 const sessions=await waSessionList();
 const stopped=sessions.items.filter(s=>s.status==='STOPPED'&&s.hasSession===true&&!s.connected);
 const loggedOut=sessions.items.filter(s=>s.status==='LOGGED_OUT');
 const results=[];
 // Mark before network calls to prevent automated repeated restarts.
 setSetting(MARKER,true);
 for(const s of stopped){
  try{
   await waRequest('/api/sessions/'+encodeURIComponent(s.session_id)+'/start',{method:'POST',data:{}});
   await wait(3000);
   const check=await waControlStatus(s.session_id);
   results.push({result:check.connected?'CONNECTED':check.status,connected:check.connected});
   audit('GATEWAY_STOPPED_SESSION_RESTART',null,{result:check.status,connected:check.connected,customerMessagesSent:0});
  }catch(error){results.push({result:'ERROR',reason:String(error?.message||'').slice(0,100)});}
 }
 return {state:'FINISHED',stoppedAttempted:stopped.length,loggedOutNeedingQR:loggedOut.length,
  results,customerMessagesSent:0,loggedOutSessionsUntouched:true};
}
