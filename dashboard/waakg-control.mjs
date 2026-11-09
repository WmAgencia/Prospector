// Private WA-AKG control-plane for the Prospector dashboard.
// All credentials remain in Railway variables; no admin tokens sent to the browser.
import {getSetting,setSetting} from "./db.mjs";
import {randomUUID} from 'node:crypto';
import {managedSessions,isManagedSession,registerSession,nextConnectedSession,rotationCursor} from './waakg-session-registry.mjs';
import {chooseConsecomAlternatingSender,consecomPairStatus} from './consecom-sender-rotation.mjs';
import {sessionOutreachBudget} from './session-outreach-budget.mjs';
const base="https://wa-akg-production-f9f0.up.railway.app";
const sessionKey="waakg_primary_session_id";
let cachedKey="",pendingKey=null;
const safeId=v=>/^[a-zA-Z0-9_-]{3,70}$/.test(String(v||""));
export function selectedWaSession(){const s=process.env.WA_AKG_SESSION_ID||getSetting(sessionKey,"");return safeId(s)?s:"";}
function errorFrom(res,data){
 const detail=String(data?.message||data?.error||"indisponível").slice(0,110);
 return Error("WA-AKG HTTP "+res.status+": "+detail);
}
async function loginAndKey(){
 const email=process.env.WA_AKG_ADMIN_EMAIL||"";
 const password=process.env.WA_AKG_ADMIN_PASSWORD||"";
 if(!email.includes("@")||password.length<12)throw Error("Credenciais internas do WA-AKG não configuradas no Railway");
 const csrfRes=await fetch(base+"/api/auth/csrf",{headers:{Accept:"application/json"},signal:AbortSignal.timeout(8500)});
 if(!csrfRes.ok)throw Error("WA-AKG indisponível durante autenticação");
 const csrf=await csrfRes.json();
 const cookies=new Map();
 function harvest(res){for(const v of (res.headers.getSetCookie?.()||[])){const pair=v.split(";")[0];const at=pair.indexOf("=");if(at>0)cookies.set(pair.slice(0,at),pair.slice(at+1));}}
 function header(){return [...cookies.entries()].map(([k,v])=>k+"="+v).join("; ");}
 harvest(csrfRes);
 const res=await fetch(base+"/api/auth/callback/credentials",{
  method:"POST",redirect:"manual",
  headers:{"Content-Type":"application/x-www-form-urlencoded","Cookie":header(),"Origin":base},
  body:new URLSearchParams({email,password,csrfToken:csrf.csrfToken||"",callbackUrl:base+"/dashboard",json:"true"}),
  signal:AbortSignal.timeout(12000)
 });
 harvest(res);
 const redirect=res.headers.get("location")||"";
 if(res.status>=400||/error=|\/error\b/i.test(redirect))throw Error("Credenciais administrativas do WA-AKG foram rejeitadas");
 const apiRes=await fetch(base+"/api/user/api-key",{headers:{"Cookie":header(),Accept:"application/json"},signal:AbortSignal.timeout(9500)});
 if(!apiRes.ok)throw Error("Login WA-AKG não gerou sessão autenticada (HTTP "+apiRes.status+")");
 const api=await apiRes.json();
 let key=api?.data?.apiKey||"";
 if(!key){
  const generated=await fetch(base+"/api/user/api-key",{method:"POST",headers:{"Cookie":header(),"Origin":base,"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(9000)});
  const out=await generated.json().catch(()=>({}));
  if(!generated.ok||!out?.data?.apiKey)throw Error("WA-AKG não permitiu criar chave de integração");
  key=out.data.apiKey;
 }
 if(!/^wag_[A-Za-z0-9_-]{20,}$/.test(key))throw Error("WA-AKG retornou credencial inválida");
 return key;
}
export async function getGatewayApiKey(){
 if(process.env.WA_AKG_API_KEY)return process.env.WA_AKG_API_KEY;
 if(cachedKey)return cachedKey;
 if(!pendingKey)pendingKey=loginAndKey().then(x=>(cachedKey=x,x)).finally(()=>pendingKey=null);
 return pendingKey;
}
export async function waRequest(path,{method="GET",data}={}){
 if(!path.startsWith("/api/")||path.includes(".."))throw Error("Rota interna inválida");
 if(process.env.PROSPECTOR_TENANT_ID){
  const parts=path.split('/').map(decodeURIComponent);
  if(path==='/api/sessions'&&method==='POST'){
   if(!String(data?.sessionId||'').startsWith('prospector-'))throw Error('Sessão inválida');
  }else if(path!=='/api/sessions'&&!isManagedSession(parts[3]))throw Error('Canal não pertence a esta conta');
 }
 const apiKey=await getGatewayApiKey();
 async function send(k){
  const res=await fetch(base+path,{method,headers:{"X-API-Key":k,"Accept":"application/json",...(data!==undefined?{"Content-Type":"application/json"}:{})},body:data!==undefined?JSON.stringify(data):undefined,signal:AbortSignal.timeout(14000)});
  const json=await res.json().catch(()=>({}));
  return {res,json};
 }
 let result=await send(apiKey);
 if(result.res.status===401&&!process.env.WA_AKG_API_KEY){cachedKey="";result=await send(await getGatewayApiKey());}
 if(!result.res.ok||result.json.status===false)throw errorFrom(result.res,result.json);
 if(process.env.PROSPECTOR_TENANT_ID&&path==='/api/sessions'&&method==='GET')return {...result.json,data:(result.json.data||[]).filter(x=>isManagedSession(x.sessionId))};
 return result.json;
}
export async function waControlStatus(requestedSession,listedSessions){
 const sessionId=requestedSession||selectedWaSession();
 if(requestedSession&&!isManagedSession(requestedSession))return {ok:false,connected:false,status:'UNAUTHORIZED_SESSION'};
 try{
  const data=Array.isArray(listedSessions)?{data:listedSessions}:await waRequest("/api/sessions");
  const arr=Array.isArray(data.data)?data.data:[];
  const target=(sessionId?arr.find(x=>x.sessionId===sessionId):!process.env.PROSPECTOR_TENANT_ID?arr.find(x=>x.sessionId==="consecom-principal"):null)||null;
  if(target&&!sessionId)setSetting(sessionKey,target.sessionId);
  const picked=target?.sessionId||sessionId;
  if(!target)return {ok:true,connected:false,status:"DISCONNECTED",sessionId:picked,hasSession:false,totalSessions:arr.length,qrAvailable:false};
  // The session LIST is backed by persisted DB state; it can keep saying
  // CONNECTED after the actual WA-AKG socket disappears. Confirm a live
  // instance and its authenticated identity before reporting online.
  const detail=await waRequest("/api/sessions/"+encodeURIComponent(picked));
  const live=detail?.data||{};
  const status=String(live.status||target.status||"DISCONNECTED");
  const connected=status==="CONNECTED"&&live.hasInstance===true&&Boolean(live.me?.id||live.me?.jid);
  const transportStale=status==="CONNECTED"&&!connected;
  const liveNumber=String(live.me?.id||live.me?.jid||'').split('@')[0].split(':')[0].replace(/\D/g,'');
  return {ok:true,connected,status:transportStale?"DISCONNECTED":status,
   transportStale,sessionId:picked,numberSuffix:liveNumber.slice(-4),number:connected&&/^\d{10,15}$/.test(liveNumber)?liveNumber:null,hasSession:true,totalSessions:arr.length,qrAvailable:!connected};
 }catch(e){return {ok:false,connected:false,status:"ERROR",message:String(e.message).slice(0,180),sessionId,hasSession:!!sessionId};}
}
export async function waConnect(requestedSession){
 let state=await waControlStatus(requestedSession);
 if(!state.ok)throw Error(state.message);
 let sessionId=state.sessionId;
 if(!sessionId){
  const created=await waRequest("/api/sessions",{method:"POST",data:{name:process.env.PROSPECTOR_TENANT_NAME||"Consecom Principal",sessionId:process.env.PROSPECTOR_TENANT_ID?'prospector-'+randomUUID():"consecom-principal"}});
  sessionId=created.data?.sessionId||"";
  if(!safeId(sessionId))throw Error("WA-AKG não criou uma sessão válida");
  setSetting(sessionKey,sessionId);
 }
 if(process.env.PROSPECTOR_TENANT_ID||requestedSession&&requestedSession!==selectedWaSession()){
  // New gateway sessions enable their own bot by default. Keep all customer
  // automation in Prospector so the gateway cannot answer in parallel.
  const config=await waRequest('/api/sessions/'+encodeURIComponent(sessionId)+'/bot-config',{method:'POST',data:{botMode:'SPECIFIC',botAllowedJids:[],autoReplyMode:'SPECIFIC',autoReplyAllowedJids:[],welcomeMessage:null,enableSticker:false,enableVideoSticker:false,enablePing:false,enableUptime:false}});
  if(config.data?.botMode!=='SPECIFIC'||config.data?.autoReplyMode!=='SPECIFIC'||!Array.isArray(config.data?.botAllowedJids)||config.data.botAllowedJids.length||!Array.isArray(config.data?.autoReplyAllowedJids)||config.data.autoReplyAllowedJids.length)throw Error('O gateway não confirmou a exclusividade do atendimento pelo Prospector');
 }
 if(state.transportStale){
  // WA-AKG still has a stale CONNECTED instance, but no authenticated user:
  // /start is a no-op in that state. Restart the socket before requesting QR.
  await waRequest("/api/sessions/"+encodeURIComponent(sessionId)+"/restart",{method:"POST",data:{}});
 }else if(!state.connected&&!["SCAN_QR","CONNECTING","INITIALIZING"].includes(state.status)){
  await waRequest("/api/sessions/"+encodeURIComponent(sessionId)+"/start",{method:"POST",data:{}});
 }
 // Configure webhook once, without exposing the shared secret to the browser.
 const destination="https://prospector-operacional-production.up.railway.app/api/wa-akg/webhook"+(process.env.PROSPECTOR_TENANT_ID?'?tenant='+encodeURIComponent(process.env.PROSPECTOR_TENANT_ID):'');
 const hookSecret=process.env.WA_AKG_WEBHOOK_SECRET||"";
 if(hookSecret.length>=40){
  const hooks=await waRequest("/api/webhooks/"+encodeURIComponent(sessionId));
  const existing=(hooks.data||[]).some(x=>x.url===destination&&x.isActive!==false);
  if(!existing)await waRequest("/api/webhooks/"+encodeURIComponent(sessionId),{method:"POST",data:{name:"Consecom Prospector",url:destination,secret:hookSecret,events:["message.received","message.sent","connection.update"]}});
 }
 return {ok:true,sessionId,connected:state.connected,message:state.connected?"WhatsApp conectado":"Sessão iniciada. Escaneie o QR Code."};
}
export async function waGetQR(requestedSession){
 const status=await waControlStatus(requestedSession);
 if(!status.ok||!status.sessionId)return {status:status.status,connected:false,message:status.message||"Clique em Conectar para iniciar a sessão",qr:null};
 if(status.connected)return {status:"CONNECTED",connected:true,qr:null};
 try{
  const res=await waRequest("/api/sessions/"+encodeURIComponent(status.sessionId)+"/qr");
  const qr=typeof res.base64==="string"&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(res.base64)&&res.base64.length<250000?res.base64:null;
  return {status:status.status,connected:false,qr,message:qr?"Escaneie o código com WhatsApp > Aparelhos conectados":"O QR Code está sendo gerado"};
 }catch(e){
  if(/Already connected/i.test(e.message))return {status:"VERIFYING",connected:false,qr:null,message:"O gateway informa uma conexão anterior. Clique em Reconectar para reiniciar a sessão."};
  return {status:status.status,connected:false,qr:null,message:"Aguardando QR Code. O servidor pode demorar alguns segundos."};
 }
}
export async function waDisconnect(requestedSession){
 const current=await waControlStatus(requestedSession);
 if(!current.ok)throw Error("Não foi possível verificar o WhatsApp antes da desconexão. Confira a conexão do gateway.");
 if(!current.hasSession)return {ok:true,connected:false,status:"DISCONNECTED",verified:true};
 const sid=current.sessionId;
 // stop only pauses the socket; logout revokes the pairing and requires a
 // fresh QR Code. Never claim success before read-back verification.
 if(!requestedSession)setSetting("paused",true);
 setSetting("waakg_disconnect_requested_at",new Date().toISOString());
 if(current.status!=="LOGGED_OUT"){
  await waRequest("/api/sessions/"+encodeURIComponent(sid)+"/logout",{method:"POST",data:{}});
 }
 for(let attempt=0;attempt<7;attempt++){
  const check=await waControlStatus(requestedSession);
  if(check.ok&&!check.connected&&check.status==="LOGGED_OUT"){
   setSetting("waakg_disconnect_verified_at",new Date().toISOString());
   return {ok:true,connected:false,status:check.status,verified:true,reconnectRequiresQr:true};
  }
  if(attempt<6)await new Promise(resolve=>setTimeout(resolve,400));
 }
 throw Error("O gateway não confirmou a desconexão. O envio foi pausado; confira a sessão antes de continuar.");
}

export async function waIdentityStatus(){
 const state=await waControlStatus();
 if(!state.ok||!state.sessionId)return {connected:false,numberSuffix:null,sessionFound:false};
 try{
  const detail=await waRequest("/api/sessions/"+encodeURIComponent(state.sessionId));
  const raw=String(detail.data?.me?.id||detail.data?.me?.jid||"");
  const digits=raw.split("@")[0].split(":")[0].replace(/\\D/g,"");
  return {connected:state.connected,numberSuffix:digits?digits.slice(-4):null,sessionFound:true};
 }catch{return {connected:state.connected,numberSuffix:null,sessionFound:true};}
}
export async function waSessionList(){
 const listed=await waRequest('/api/sessions');
 const arr=Array.isArray(listed.data)?listed.data:[];
 const items=await Promise.all(managedSessions().map(async row=>({...row,...await waControlStatus(row.session_id,arr),outreach:sessionOutreachBudget(row.session_id)})));
 return {items,connected:items.some(x=>x.connected),rotation:'round_robin',globalCadence:true};
}
export async function waCreateSession(label){
 const name=String(label||'').trim();
 if(!name||name.length>70)throw Error('Informe um nome de até 70 caracteres para o WhatsApp');
 const sessionId='prospector-'+randomUUID();
 const created=await waRequest('/api/sessions',{method:'POST',data:{name,sessionId}});
 if(created.data?.sessionId!==sessionId)throw Error('O gateway não confirmou a criação da sessão');
 registerSession(sessionId,name);
 if(!selectedWaSession())setSetting(sessionKey,sessionId);
 return {sessionId,label:name,...await waConnect(sessionId)};
}
export async function selectApproachSender(){
 const pool=await waSessionList(),cursor=rotationCursor();
 const internal=!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true';
 if(internal){
  const chosen=chooseConsecomAlternatingSender(pool.items,selectedWaSession(),cursor);
  return {...chosen,cursor};
 }
 // Other tenant accounts keep their own normal rotation behavior.
 const sessionId=nextConnectedSession(managedSessions().map(x=>x.session_id),pool.items.filter(x=>x.connected).map(x=>x.session_id),cursor);
 return {connected:!!sessionId,sessionId,cursor,reason:sessionId?null:'OFFLINE'};
}
export async function waOperationalStatus(){
 const internal=!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true';
 if(!internal&&managedSessions().length<=1){const status=await waControlStatus();return {...status,approachReady:status.connected};}
 const pool=await waSessionList();
 const pair=internal?consecomPairStatus(pool.items,selectedWaSession()):null;
 return {ok:pool.items.some(x=>x.ok),connected:pool.connected,
  approachReady:internal?pair.ready:pool.connected,
  approachReason:pair?.reason||null,
  status:pool.connected?'CONNECTED':'DISCONNECTED',
  totalSessions:pool.items.length,connectedSessions:pair?.onlineCount??pool.items.filter(x=>x.connected).length,
  requiredSenders:pair?.requiredOnline??1,sessionId:selectedWaSession()};
}
