/**
 * Backup da Railway Function prospector-ui em 20/10/2026.
 * Variáveis sensíveis são referenciadas via Bun.env, sem armazenar valores neste arquivo.
 * NÃO ativar como serviço independente sem conferir a ligação ao backend.
 */
// Consecom Prospector: link privado + sessão, sem formulário usuário/senha.
import {createHmac,randomBytes,timingSafeEqual} from "node:crypto";
const token=Bun.env.ACCESS_LINK_TOKEN||"";
const secret=Bun.env.ACCESS_SESSION_KEY||"";
const upstream=(Bun.env.UPSTREAM_URL||"").replace(/\/$/,"");
const upstreamUser=Bun.env.UPSTREAM_USERNAME||"";
const upstreamPass=Bun.env.UPSTREAM_PASSWORD||"";
const upstreamToken=Bun.env.UPSTREAM_ACCESS_TOKEN||"";
let backendCookie="";
async function getBackendCookie(){
 if(backendCookie)return backendCookie;
 const response=await fetch(upstream+"/api/auth/exchange",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:upstreamToken}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error("Backend private session HTTP "+response.status);
 const raw=response.headers.get("set-cookie")||"";
 backendCookie=raw.split(";")[0];
 if(!backendCookie.startsWith("ps_session="))throw Error("Backend did not issue private session");
 return backendCookie;
}
if(token.length<40||secret.length<40||upstreamToken.length<40||!/^https:\/\//.test(upstream))throw new Error("Gateway sem configuração segura");
const cookieName="prospector_session";
const sessionMs=60*24*60*60*1000;
const failures=new Map<string,{count:number,expires:number}>();
const enc=(s:string)=>Buffer.from(s,"utf8").toString("base64url");
const sign=(p:string)=>createHmac("sha256",secret).update(p).digest("base64url");
function same(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function cookieValue(req:Request){return (req.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(cookieName+"="))?.slice(cookieName.length+1)||"";}
function authorized(req:Request){
 const raw=cookieValue(req),i=raw.lastIndexOf(".");
 if(i<=0)return false;
 const payload=raw.slice(0,i),sig=raw.slice(i+1);
 if(!same(sig,sign(payload)))return false;
 try{const v=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));return v.v===1&&Number.isFinite(v.exp)&&v.exp>Date.now()&&v.exp<Date.now()+sessionMs+60000;}catch{return false;}
}
function establishCookie(){
 const data=enc(JSON.stringify({v:1,exp:Date.now()+sessionMs,nonce:randomBytes(16).toString("hex")}));
 return cookieName+"="+data+"."+sign(data)+"; HttpOnly; Secure; SameSite=Strict; Max-Age="+(sessionMs/1000)+"; Path=/";
}
function baseHeaders(type:string){return {"Content-Type":type,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","X-Frame-Options":"DENY"};}
const accessPage="<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Consecom Prospector</title><style>body{font:15px system-ui;background:#f4f7f4;color:#203b32;min-height:100dvh;display:grid;place-items:center;margin:0;padding:20px}main{max-width:440px;background:#fff;border-radius:28px;border:1px solid #e2e9e4;padding:34px;box-shadow:0 22px 60px #143a2714}h1{font-size:25px;margin:0 0 12px}p{line-height:1.8;color:#6a8073;margin:0}.brand{font-size:12px;text-transform:uppercase;letter-spacing:.16em;font-weight:800;color:#4e8b73;margin-bottom:12px}</style><main><div class=\"brand\">Consecom</div><h1>Prospector</h1><p id=\"msg\">Abrindo seu painel seguro…</p></main><script>(async()=>{const value=location.hash.slice(1);const next=new URLSearchParams(location.search).get(\"next\");const destination=next===\"connections\"?\"/#/connections\":\"/\";history.replaceState(null,\"\",location.pathname+location.search);const msg=document.getElementById(\"msg\");if(!value||value.startsWith(\"/\")){msg.textContent=\"Este endereço não contém o código de acesso. Abra o link privado enviado nesta conversa.\";return;}try{const r=await fetch(\"/_access/exchange\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({token:value})});if(!r.ok)throw Error();location.replace(destination);}catch{msg.textContent=\"Este link não é mais válido. Utilize o link privado mais recente enviado nesta conversa.\";}})();</script></html>";
async function proxy(req:Request){
 const url=new URL(req.url);
 if(!authorized(req)){
  if(req.method==="GET"&&url.pathname==="/")return Response.redirect(url.origin+"/access",302);
  return new Response("Acesso privado necessário",{status:401,headers:baseHeaders("text/plain; charset=utf-8")});
 }
 const method=req.method.toUpperCase();
 if(!["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"].includes(method))return new Response("Método inválido",{status:405});
 if(["POST","PUT","PATCH","DELETE"].includes(method)){const origin=req.headers.get("origin");const allowedOrigin="https://"+(Bun.env.RAILWAY_PUBLIC_DOMAIN||"prospector-ui-production.up.railway.app");if(origin&&origin!==allowedOrigin)return new Response("Origem não autorizada",{status:403});}
 const remote=new URL(url.pathname+url.search,upstream);
 const headers=new Headers();
 for(const name of ["accept","accept-language","content-type","range","last-event-id","if-none-match","if-modified-since"]){const val=req.headers.get(name);if(val)headers.set(name,val);}
 headers.set("Cookie",await getBackendCookie());
 if(["POST","PUT","PATCH","DELETE"].includes(method))headers.set("Origin",new URL(upstream).origin);
 headers.set("Accept-Encoding","identity");
 const opts:RequestInit={method,headers,redirect:"manual"};
 if(!["GET","HEAD"].includes(method))opts.body=req.body;
 let response:Response;
 try{response=await fetch(remote,opts);}catch(err){
  console.warn("upstream unavailable",String(err).slice(0,160));
  return new Response("Painel temporariamente indisponível",{status:502,headers:baseHeaders("text/plain; charset=utf-8")});
 }
 if(method==="GET"&&url.pathname==="/app.js"&&response.ok){
  const original=await response.text();
  const streaming=/const feed=new EventSource\('\/api\/events'\);let debounce=null;[\s\S]*?setInterval\(\(\)=>load\(page!=='workflows'&&page!=='settings'&&page!=='discovery'\),20000\);/;
  if(!streaming.test(original)){
   console.error("[gateway] expected app.js event handling not found; refusing unpatched script");
   return new Response("Falha ao carregar painel",{status:503,headers:baseHeaders("text/plain; charset=utf-8")});
  }
  const updated=original.replace(streaming,"/* connectionPollEvery2500ms: SSE replaced at gateway */\nsetInterval(()=>{if(page==='connections')load(true);},2500);\nsetInterval(()=>{if(page!=='connections')load(page!=='workflows'&&page!=='settings'&&page!=='discovery');},20000);");
  return new Response(updated,{status:200,headers:{"Content-Type":"text/javascript; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
 }
 const returned=new Headers();
 for(const name of ["content-type","content-disposition","etag","last-modified","accept-ranges","content-range"]){const val=response.headers.get(name);if(val)returned.set(name,val);}
 returned.set("Cache-Control","no-store");returned.set("X-Content-Type-Options","nosniff");returned.set("X-Frame-Options","DENY");returned.set("Referrer-Policy","no-referrer");
 if(response.status>=300&&response.status<400){const location=response.headers.get("location");if(location){const target=new URL(location,remote);if(target.origin===remote.origin)returned.set("Location",url.origin+target.pathname+target.search+target.hash);}}
 return new Response(method==="HEAD"?null:response.body,{status:response.status,headers:returned});
}
Bun.serve({hostname:"0.0.0.0",port:Number(Bun.env.PORT||3000),async fetch(req:Request){
 const url=new URL(req.url),path=url.pathname;
 if(path==="/health")return new Response("OK",{status:200,headers:baseHeaders("text/plain; charset=utf-8")});
 if(path==="/favicon.ico")return new Response(null,{status:204,headers:{"Cache-Control":"public, max-age=86400"}});
 if(path==="/api/events")return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
 if(path==="/access"&&req.method==="GET")return new Response(accessPage,{status:200,headers:{...baseHeaders("text/html; charset=utf-8"),"Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"}});
 if(path==="/_access/exchange"&&req.method==="POST"){
  const key=req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";
  const cur=failures.get(key)||{count:0,expires:Date.now()+600_000};
  const state=cur.expires<Date.now()?{count:0,expires:Date.now()+600_000}:cur;
  if(state.count>=8)return new Response("Muitas tentativas",{status:429});
  let candidate="";
  try{const raw=await req.text();if(raw.length>4096)throw Error("oversize");candidate=String(JSON.parse(raw).token||"");}catch{}
  if(!same(candidate,token)){failures.set(key,{count:state.count+1,expires:state.expires});return new Response("Link inválido",{status:401,headers:baseHeaders("text/plain; charset=utf-8")});}
  failures.delete(key);
  return new Response(JSON.stringify({ok:true}),{headers:{"Content-Type":"application/json","Set-Cookie":establishCookie(),"Cache-Control":"no-store"}});
 }
 if(req.method==="GET"&&/^\/studio\/sites\/[a-z0-9-]{2,80}\.html$/.test(path)){
  try{
   const remote=await fetch("https://raw.githubusercontent.com/WmAgencia/Prospector/main"+path,{signal:AbortSignal.timeout(12000)});
   if(!remote.ok)return new Response("Página não encontrada",{status:remote.status===404?404:502,headers:baseHeaders("text/plain; charset=utf-8")});
   const html=await remote.arrayBuffer();
   if(html.byteLength>2_000_000)return new Response("Página excedeu o limite",{status:413});
   return new Response(html,{status:200,headers:{...baseHeaders("text/html; charset=utf-8"),"Content-Security-Policy":"frame-ancestors 'none'"}});
  }catch{return new Response("Prévia temporariamente indisponível",{status:502,headers:baseHeaders("text/plain; charset=utf-8")});}
 }
 return proxy(req);
}});

// Safe startup smoke test: only HTTP status codes are logged, never keys or customer data.
void (async()=>{
 try{
  const local="http://127.0.0.1:"+Number(Bun.env.PORT||3000);
  const exchange=await fetch(local+"/_access/exchange",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:Bun.env.ACCESS_LINK_TOKEN})});
  const issuedCookie=exchange.headers.get("set-cookie")?.split(";")[0]||"";
  if(exchange.status!==200||!issuedCookie)throw Error("exchange HTTP "+exchange.status);
  const state=await fetch(local+"/api/state",{headers:{"Cookie":issuedCookie}});
  const stateJson=state.ok?await state.clone().json():{};
  console.info("[prospector-status] "+JSON.stringify({paused:stateJson.settings?.paused,autoInitial:stateJson.settings?.auto_initial,automationEnabled:stateJson.settings?.automation_enabled,braveConfigured:stateJson.searchConfigured,found:stateJson.stats?.found,contacted:stateJson.stats?.contacted,responded:stateJson.stats?.responded,jobStatuses:(stateJson.jobs||[]).reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{}),recentDiscoveries:(stateJson.discoveries||[]).length,whatsapp:stateJson.connection?.status}));
  const conn=stateJson.connection||{};
  console.info("[gateway-wa] status="+String(conn.status||"unknown")+" qr="+Boolean(conn.qr)+" userPresent="+Boolean(conn.user)+" error="+String(conn.error||"none").slice(0,160));

  const page=await fetch(local+"/",{headers:{"Cookie":issuedCookie}});
  const published=await fetch(local+"/studio/sites/wrs-brasil.html");
  const js=await fetch(local+"/app.js",{headers:{"Cookie":issuedCookie}});
  const patched=js.status===200&&(await js.text()).includes("connectionPollEvery2500ms");
  const sameOriginPost=await fetch(local+"/api/automations/test",{method:"POST",headers:{"Cookie":issuedCookie,"Content-Type":"application/json","Origin":"https://prospector-ui-production.up.railway.app"},body:JSON.stringify({text:"pode sim",context:"sample_offer"})});
  
  console.info("[gateway-smoke] session=200 api="+state.status+" page="+page.status+" publicSite="+published.status+" appPolling="+patched+" postStatus="+sameOriginPost.status);
 }catch(ex){console.error("[gateway-smoke] failure: "+String(ex).slice(0,160));}
})();

