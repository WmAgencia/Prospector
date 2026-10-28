// Private WA-AKG control-plane for the Prospector dashboard.
// All credentials remain in Railway variables; no admin tokens sent to the browser.
import {getSetting,setSetting} from "./db.mjs";
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
 const apiKey=await getGatewayApiKey();
 async function send(k){
  const res=await fetch(base+path,{method,headers:{"X-API-Key":k,"Accept":"application/json",...(data!==undefined?{"Content-Type":"application/json"}:{})},body:data!==undefined?JSON.stringify(data):undefined,signal:AbortSignal.timeout(14000)});
  const json=await res.json().catch(()=>({}));
  return {res,json};
 }
 let result=await send(apiKey);
 if(result.res.status===401&&!process.env.WA_AKG_API_KEY){cachedKey="";result=await send(await getGatewayApiKey());}
 if(!result.res.ok||result.json.status===false)throw errorFrom(result.res,result.json);
 return result.json;
}
export async function waControlStatus(){
 const sessionId=selectedWaSession();
 try{
  const data=await waRequest("/api/sessions");
  const arr=Array.isArray(data.data)?data.data:[];
  const target=arr.find(x=>x.sessionId===sessionId)||arr.find(x=>x.sessionId==="consecom-principal")||null;
  if(target&&!sessionId)setSetting(sessionKey,target.sessionId);
  const picked=target?.sessionId||"";
  return {ok:true,connected:target?.status==="CONNECTED",status:target?.status||"DISCONNECTED",sessionId:picked,hasSession:!!target,totalSessions:arr.length,qrAvailable:!!target&&target.status!=="CONNECTED"};
 }catch(e){return {ok:false,connected:false,status:"ERROR",message:String(e.message).slice(0,180),sessionId,hasSession:!!sessionId};}
}
export async function waConnect(){
 let state=await waControlStatus();
 if(!state.ok)throw Error(state.message);
 let sessionId=state.sessionId;
 if(!sessionId){
  const created=await waRequest("/api/sessions",{method:"POST",data:{name:"Consecom Principal",sessionId:"consecom-principal"}});
  sessionId=created.data?.sessionId||"";
  if(!safeId(sessionId))throw Error("WA-AKG não criou uma sessão válida");
  setSetting(sessionKey,sessionId);
 }
 if(!state.connected&&!["SCAN_QR","CONNECTING","INITIALIZING"].includes(state.status))await waRequest("/api/sessions/"+encodeURIComponent(sessionId)+"/start",{method:"POST",data:{}});
 // Configure webhook once, without exposing the shared secret to the browser.
 const destination="https://prospector-operacional-production.up.railway.app/api/wa-akg/webhook";
 const hookSecret=process.env.WA_AKG_WEBHOOK_SECRET||"";
 if(hookSecret.length>=40){
  const hooks=await waRequest("/api/webhooks/"+encodeURIComponent(sessionId));
  const existing=(hooks.data||[]).some(x=>x.url===destination&&x.isActive!==false);
  if(!existing)await waRequest("/api/webhooks/"+encodeURIComponent(sessionId),{method:"POST",data:{name:"Consecom Prospector",url:destination,secret:hookSecret,events:["message.received","message.sent","connection.update"]}});
 }
 return {ok:true,sessionId,connected:state.connected,message:state.connected?"WhatsApp conectado":"Sessão iniciada. Escaneie o QR Code."};
}
export async function waGetQR(){
 const status=await waControlStatus();
 if(!status.ok||!status.sessionId)return {status:status.status,connected:false,message:status.message||"Clique em Conectar para iniciar a sessão",qr:null};
 if(status.connected)return {status:"CONNECTED",connected:true,qr:null};
 try{
  const res=await waRequest("/api/sessions/"+encodeURIComponent(status.sessionId)+"/qr");
  const qr=typeof res.base64==="string"&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(res.base64)&&res.base64.length<250000?res.base64:null;
  return {status:status.status,connected:false,qr,message:qr?"Escaneie o código com WhatsApp > Aparelhos conectados":"O QR Code está sendo gerado"};
 }catch(e){
  if(/Already connected|400/.test(e.message))return {status:"CONNECTED",connected:true,qr:null};
  return {status:status.status,connected:false,qr:null,message:"Aguardando QR Code. O servidor pode demorar alguns segundos."};
 }
}
export async function waDisconnect(){
 const sid=selectedWaSession();if(!sid)return {ok:true,connected:false};
 await waRequest("/api/sessions/"+encodeURIComponent(sid)+"/stop",{method:"POST",data:{}});
 return {ok:true,connected:false};
}
