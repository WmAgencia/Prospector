/**
 * Fonte de produção atualizada do gateway prospector-ui (Railway Function).
 * Acesso: login com senha persistente e compatibilidade com links antigos.
 * Credenciais são variáveis privadas Railway, NUNCA são gravadas neste repositório.
 * Fonte de referência; mudanças devem ser sincronizadas com a Railway Function ativa.
 */
// Consecom Prospector: link privado + sessão, sem formulário usuário/senha.
import {createHmac,randomBytes,timingSafeEqual} from "node:crypto";
const token=Bun.env.ACCESS_LINK_TOKEN||"";
const loginPassword=Bun.env.ACCESS_LOGIN_PASSWORD||"";
const secret=Bun.env.ACCESS_SESSION_KEY||"";
const upstream=(Bun.env.UPSTREAM_URL||"").replace(/\/$/,"");
const upstreamUser=Bun.env.UPSTREAM_USERNAME||"";
const upstreamPass=Bun.env.UPSTREAM_PASSWORD||"";
const upstreamToken=Bun.env.UPSTREAM_ACCESS_TOKEN||"";
let backendCookie="",backendCookieExpires=0;
let backendLogin:Promise<string>|null=null;
async function getBackendCookie(){
 if(backendCookie&&Date.now()<backendCookieExpires)return backendCookie;
 if(backendLogin)return backendLogin;
 backendLogin=(async()=>{
 const response=await fetch(upstream+"/api/auth/exchange",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:upstreamToken}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error("Backend private session HTTP "+response.status);
 const raw=response.headers.get("set-cookie")||"";
 backendCookie=raw.split(";")[0];
 if(!backendCookie.startsWith("ps_session="))throw Error("Backend did not issue private session");
 const maxAge=Number(raw.match(/(?:^|;)\s*Max-Age=(\d+)/i)?.[1]||300);
 backendCookieExpires=Date.now()+Math.max(0,maxAge-60)*1000;
 return backendCookie;
 })().finally(()=>{backendLogin=null;});
 return backendLogin;
}
if(token.length<40||loginPassword.length<10||secret.length<40||upstreamToken.length<40||!/^https:\/\//.test(upstream))throw new Error("Gateway sem configuração segura");
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
const accessPage="<!doctype html>\n<html lang=\"pt-BR\"><head>\n<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"theme-color\" content=\"#f5f8f6\"><title>Entrar • Prospector Consecom</title>\n<style>\n:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,\"Segoe UI\",sans-serif}\n*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:22px;background:radial-gradient(ellipse at 75% 10%,#dcefe3 0,transparent 44%),#f5f8f6;color:#183629}\nmain{width:min(100%,440px);background:#fff;border:1px solid #e1eae5;box-shadow:0 25px 85px #183b2714;border-radius:25px;padding:clamp(26px,5vw,42px)}\n.mark{width:48px;height:48px;display:grid;place-items:center;background:#21684c;color:white;border-radius:13px;font-weight:900;font-size:28px;margin-bottom:26px}\n.eyebrow{font-size:11px;letter-spacing:.17em;color:#5e9378;font-weight:850;text-transform:uppercase}\nh1{font-size:29px;letter-spacing:-.055em;margin:7px 0 9px;line-height:1.16}p{font-size:14px;line-height:1.6;margin:0 0 23px;color:#738b7e}\nlabel{font-size:13px;font-weight:750;display:block;margin-bottom:9px}\ninput{font:inherit;font-size:15px;padding:15px 16px;height:51px;width:100%;border:1px solid #cbdcd1;border-radius:11px;background:#fbfdfb;outline:none}\ninput:focus{border-color:#287a54;box-shadow:0 0 0 3px #287a5422}\nbutton{width:100%;font:inherit;font-weight:800;background:#246e4e;border:0;color:#fff;height:50px;margin-top:17px;border-radius:11px;cursor:pointer}\nbutton:disabled{opacity:.65;cursor:wait}.alert{min-height:22px;margin-top:15px;margin-bottom:0;font-size:13px;color:#af3e37}\n.foot{border-top:1px solid #e9efeb;padding-top:18px;margin-top:9px;font-size:12px;color:#8ca497;line-height:1.6}\n</style></head><body><main>\n<div class=\"mark\" aria-hidden=\"true\">P.</div><div class=\"eyebrow\">Consecom Brasil</div><h1>Entre no Prospector</h1>\n<p>Seu painel de prospecção, conversas e WhatsApp. Entre com sua senha para continuar. Não é necessário um link privado.</p>\n<form id=\"login\" autocomplete=\"on\"><label for=\"password\">Senha de acesso</label>\n<input id=\"password\" name=\"password\" type=\"password\" autocomplete=\"current-password\" placeholder=\"Digite sua senha\" required minlength=\"10\" autofocus>\n<button id=\"submit\" type=\"submit\">Entrar no Prospector</button><p class=\"alert\" id=\"msg\" role=\"status\" aria-live=\"polite\"></p></form>\n<div class=\"foot\">A sessão fica salva neste navegador por até 60 dias. Se expirar, entre novamente com sua senha.</div>\n</main>\n<script>\n(function(){\n const form=document.getElementById('login'),field=document.getElementById('password'),button=document.getElementById('submit'),msg=document.getElementById('msg');\n const next=new URLSearchParams(location.search).get('next'),destination=next&&next.startsWith('/oauth/authorize?')?next:'/master';\n async function exchange(payload){\n   button.disabled=true;msg.textContent='Verificando acesso…';\n   try{\n     const response=await fetch('/_access/exchange',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)});\n     if(response.ok){location.replace(destination);return;}\n     msg.textContent=response.status===429?'Muitas tentativas. Tente novamente mais tarde.':'Senha inválida. Confira e tente novamente.';\n   }catch(e){msg.textContent='Não foi possível conectar ao servidor. Tente novamente.'}\n   finally{button.disabled=false}\n }\n form.addEventListener('submit',e=>{e.preventDefault();const value=field.value;if(value.length>=10)exchange({password:value})});\n const legacy=location.hash.slice(1);\n if(legacy&&legacy.length>=40&&!legacy.startsWith('/')){\n   history.replaceState(null,'',location.pathname+location.search);\n   exchange({token:legacy});\n }\n})();\n</script></body></html>";

async function proxy(req:Request){
 const url=new URL(req.url);
 const clientCookie=(req.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("ps_client="))||"";
 const masterAuthorized=authorized(req);
 const publicClientAccess=new Set(["/","/conheca","/cadastro","/entrar","/landing.css","/landing.js","/client/access","/api/platform/login","/api/platform/logout","/api/platform/signup","/api/platform/signin"]).has(url.pathname);
 const oauthBrowser=url.pathname==="/oauth/authorize"||url.pathname==="/oauth/approve";
 const publicMcp=new Set(["/mcp","/.well-known/oauth-protected-resource","/.well-known/oauth-protected-resource/mcp","/.well-known/oauth-authorization-server","/oauth/register","/oauth/token"]).has(url.pathname);
 if(!publicMcp&&!masterAuthorized&&!clientCookie&&!publicClientAccess){
  if(req.method==="GET"&&url.pathname==="/oauth/authorize")return new Response(null,{status:302,headers:{"Location":"/access?next="+encodeURIComponent(url.pathname+url.search),"Cache-Control":"no-store"}});
  if(req.method==="GET"&&url.pathname==="/")return new Response(null,{status:302,headers:{"Location":"/access","Cache-Control":"no-store"}});
  return new Response("Acesso privado necessário",{status:401,headers:baseHeaders("text/plain; charset=utf-8")});
 }
 const method=req.method.toUpperCase();
 if(!["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"].includes(method))return new Response("Método inválido",{status:405});
 if(["POST","PUT","PATCH","DELETE"].includes(method)){const origin=req.headers.get("origin");const allowedOrigins=new Set(["https://"+(Bun.env.RAILWAY_PUBLIC_DOMAIN||"prospector-ui-production.up.railway.app"),...(Bun.env.FRONTEND_ORIGIN||"").split(",").map(s=>s.trim()).filter(Boolean)]);if(origin&&!allowedOrigins.has(origin))return new Response("Origem não autorizada",{status:403});}
 const remote=new URL(url.pathname+url.search,upstream);
 const headers=new Headers();
 const clientIp=(req.headers.get("x-real-ip")||req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim()||"");
 if(clientIp){const at=String(Date.now());headers.set("X-Prospector-Client-IP",clientIp);headers.set("X-Prospector-Client-At",at);headers.set("X-Prospector-Client-Signature",createHmac("sha256",upstreamToken).update(clientIp+"|"+at).digest("hex"));}
 for(const name of ["accept","accept-language","content-type","range","last-event-id","if-none-match","if-modified-since",...(publicMcp?["authorization","mcp-protocol-version","mcp-session-id","origin"]:[])]){const val=req.headers.get(name);if(val)headers.set(name,val);}
 if(oauthBrowser){headers.set("X-Forwarded-Host",url.host);headers.set("X-Forwarded-Proto",url.protocol.slice(0,-1));}
 if(["POST","PUT","PATCH","DELETE"].includes(method)&&!publicMcp)headers.set("Origin",oauthBrowser?(req.headers.get("origin")||url.origin):new URL(upstream).origin);
 headers.set("Accept-Encoding","identity");
 const opts:RequestInit={method,headers,redirect:"manual"};
 const replay=!publicMcp&&!["GET","HEAD"].includes(method)?req.clone():null;
 if(!["GET","HEAD"].includes(method)){opts.body=req.body;(opts as RequestInit & {duplex:string}).duplex="half";}
 let response:Response;
 try{
  // Client cookies are validated by the backend. Never add administrator
  // credentials for an unauthenticated client or retry it as the administrator.
  if(!publicMcp){
   const cookie=masterAuthorized?await getBackendCookie():"";
   if(cookie||clientCookie)headers.set("Cookie",[cookie,clientCookie].filter(Boolean).join("; "));
  }
  // Preserve only the short-lived OAuth approval cookie, never browser session cookies.
  if(oauthBrowser){const approval=(req.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("ps_mcp_approval="));if(approval)headers.set("Cookie",headers.get("Cookie")+"; "+approval);}
  const usedCookie=headers.get("Cookie");
  response=await fetch(remote,opts);
  // Backend 401 is issued by its authentication guard before any mutation.
  // OAuth authorization failures must never be retried as administrator calls.
  if(!publicMcp&&!oauthBrowser&&masterAuthorized&&!clientCookie&&!publicClientAccess&&response.status===401){
   if(backendCookie===usedCookie){backendCookie="";backendCookieExpires=0;}
   headers.set("Cookie",await getBackendCookie());
   if(replay)opts.body=replay.body;
   response=await fetch(remote,opts);
  }
 }catch(err){
  console.warn("upstream unavailable");
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
 for(const name of ["content-type","content-disposition","etag","last-modified","accept-ranges","content-range","www-authenticate","mcp-protocol-version","mcp-session-id","allow"]){const val=response.headers.get(name);if(val)returned.set(name,val);}
 if(oauthBrowser){for(const value of response.headers.getSetCookie()){if(value.startsWith("ps_mcp_approval="))returned.append("Set-Cookie",value);}}
 for(const value of response.headers.getSetCookie()){if(value.startsWith("ps_client="))returned.append("Set-Cookie",value);}
 returned.set("Cache-Control","no-store");returned.set("X-Content-Type-Options","nosniff");returned.set("X-Frame-Options","DENY");returned.set("Referrer-Policy","no-referrer");
 if(response.status>=300&&response.status<400){const location=response.headers.get("location");if(location){const target=new URL(location,remote);if(target.origin===remote.origin)returned.set("Location",target.pathname+target.search+target.hash);else if(oauthBrowser)returned.set("Location",target.href);}}
 return new Response(method==="HEAD"?null:response.body,{status:response.status,headers:returned});
}
Bun.serve({hostname:"0.0.0.0",port:Number(Bun.env.PORT||3000),async fetch(req:Request){
 const url=new URL(req.url),path=url.pathname;
 if(path==="/health")return new Response("OK",{status:200,headers:baseHeaders("text/plain; charset=utf-8")});
 if(path==="/favicon.ico")return new Response(null,{status:204,headers:{"Cache-Control":"public, max-age=86400"}});
 if(path==="/master"&&req.method==="GET"&&!authorized(req))return new Response(null,{status:302,headers:{"Location":"/access","Cache-Control":"no-store"}});
 if(path==="/api/events")return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
 if(path==="/access"&&req.method==="GET"){if(authorized(req))return new Response(null,{status:302,headers:{"Location":"/master","Cache-Control":"no-store"}});return new Response(accessPage,{status:200,headers:{...baseHeaders("text/html; charset=utf-8"),"Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"}});}
 if(path==="/_access/exchange"&&req.method==="POST"){
  const key=req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";
  const cur=failures.get(key)||{count:0,expires:Date.now()+600_000};
  const state=cur.expires<Date.now()?{count:0,expires:Date.now()+600_000}:cur;
  if(state.count>=8)return new Response("Muitas tentativas",{status:429});
  let candidate="",password="";
  try{const raw=await req.text();if(raw.length>4096)throw Error("oversize");const p=JSON.parse(raw);candidate=String(p.token||"");password=String(p.password||"");}catch{}
  const validToken=candidate.length>=40&&same(candidate,token);
  const validPassword=password.length>=10&&same(password,loginPassword);
  if(!validToken&&!validPassword){failures.set(key,{count:state.count+1,expires:state.expires});return new Response("Credenciais inválidas",{status:401,headers:baseHeaders("text/plain; charset=utf-8")});}
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

// Safe startup smoke test: reads only; no customer actions or identifiers are logged.
void (async()=>{
 try{
  const local="http://127.0.0.1:"+Number(Bun.env.PORT||3000);
  const exchange=await fetch(local+"/_access/exchange",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:Bun.env.ACCESS_LOGIN_PASSWORD})});
  const issued=exchange.headers.get("set-cookie")?.split(";")[0]||"";
  if(exchange.status!==200||!issued)throw Error("administrative access unavailable");
  const context=await fetch(local+"/api/platform/context",{headers:{Cookie:issued}});
  const role=context.ok?(await context.json()).role:null;
  const publicPage=await fetch(local+"/conheca");
  const signup=await fetch(local+"/cadastro");
  console.info("[gateway-smoke] "+JSON.stringify({masterHttp:context.status,masterRole:role,landingHttp:publicPage.status,signupHttp:signup.status}));
 }catch{console.warn("[gateway-smoke] public or administrative access unavailable");}
})();
