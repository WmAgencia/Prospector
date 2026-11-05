// Each client runs the existing application in a separate process and data directory.
// Requests cannot select a database by supplying an identifier in an API payload.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openPlatformStore} from './platform-store.mjs';
import {createAccessLimiter,accessClientKey} from './access-rate-limit.mjs';
const isWorker=!!process.env.PROSPECTOR_TENANT_ID;
const root=path.resolve(process.env.PROSPECTOR_DATA_DIR||'data','platform');
let store;
const registry=()=>store||=openPlatformStore(root);
const workers=new Map(),starting=new Map(),limiter=createAccessLimiter();
const signupLimiter=createAccessLimiter({limit:5}),passwordLimiter=createAccessLimiter({limit:10});
const accountPasswordLimiter=createAccessLimiter({limit:10});
const cookieName='ps_client';
const secret=process.env.ADMIN_SESSION_SECRET||'local-development-secret';
const sign=s=>crypto.createHmac('sha256',secret).update(s).digest('base64url');
export function clientCookie(client){
 const p=Buffer.from(JSON.stringify({id:client.id,v:client.token_hash,exp:Date.now()+7*86400000})).toString('base64url');
 return cookieName+'='+p+'.'+sign(p)+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800';
}
export function clientFromRequest(req){
 const raw=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
 const [p,s,...rest]=raw.split('.');if(!p||!s||rest.length||s.length!==sign(p).length||!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(sign(p))))return null;
 try{const claim=JSON.parse(Buffer.from(p,'base64url'));const c=registry().get(claim.id);return c?.status==='active'&&claim.exp>Date.now()&&claim.v===c.token_hash?c:null;}catch{return null;}
}
export function isPrimaryClient(req){return !isWorker&&clientFromRequest(req)?.is_internal===1;}
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
export function workerEnvironment(client,port){
 const allowed=['PATH','Path','SystemRoot','TEMP','TMP','HOME','NODE_ENV','GROQ_API_KEY','GROQ_MODEL','WA_AKG_API_KEY','WA_AKG_ADMIN_EMAIL','WA_AKG_ADMIN_PASSWORD','FRANCISCA_PYTHON','EDGE_TTS_PYTHON','PUBLIC_BASE_URL'];
 const env=Object.fromEntries(allowed.filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
 return {...env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),PROSPECTOR_TENANT_ID:client.id,
  PROSPECTOR_TENANT_NAME:client.name,PROSPECTOR_PLATFORM_DIR:root,PROSPECTOR_DATA_DIR:path.join(root,'clients',client.id),
  PROSPECTOR_SESSION_DIR:path.join(root,'clients',client.id,'wa-session'),
  ADMIN_ACCESS_TOKEN:client.secret,ADMIN_SESSION_SECRET:client.secret,WA_AKG_WEBHOOK_SECRET:client.secret,
  WHATSAPP_TRANSPORT:'waakg',PROSPECTOR_INBOUND_AUTOREPLY_ENABLED:'true',AI_CONVERSATION_AUTOSEND:'true',
  PROSPECTOR_AUTONOMOUS_OUTREACH_OPT_IN:'false',PROSPECTOR_COLD_FIRST_APPROACH:'false',
  PROSPECTOR_REPLY_PACING_ENABLED:'true',PROSPECTOR_AUTO_MAPS_DISCOVERY_ENABLED:'false'};
}
async function worker(client){
 if(workers.has(client.id))return workers.get(client.id);
 if(starting.has(client.id))return starting.get(client.id);
 const pending=(async()=>{
  const port=await freePort();fs.mkdirSync(path.join(root,'clients',client.id),{recursive:true});
  const child=spawn(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url))],{env:workerEnvironment(client,port),stdio:['ignore','ignore','ignore'],windowsHide:true});
  const entry={port,child};workers.set(client.id,entry);child.on('exit',()=>{if(workers.get(client.id)===entry)workers.delete(client.id);});child.on('error',()=>workers.delete(client.id));
  for(let i=0;i<100;i++){
   if(child.exitCode!==null)throw Error('Não foi possível iniciar este espaço de trabalho');
   try{const r=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(500)});if(r.ok)return entry;}catch{}
   await new Promise(r=>setTimeout(r,100));
  }
  child.kill();throw Error('Espaço de trabalho demorou para iniciar');
 })().finally(()=>starting.delete(client.id));starting.set(client.id,pending);return pending;
}
function internalCookie(c){const p=Buffer.from(JSON.stringify({v:1,exp:Date.now()+3600000})).toString('base64url');return 'ps_session='+p+'.'+crypto.createHmac('sha256',c.secret).update(p).digest('base64url');}
async function proxy(req,res,client){
 const {port}=await worker(client);
 const headers={...req.headers,host:'127.0.0.1:'+port,cookie:internalCookie(client)};
 // Validate browser origins at the public edge; the private hop has its own origin.
 if(headers.origin)headers.origin='http://127.0.0.1:'+port;
 delete headers['x-forwarded-host'];headers['x-forwarded-proto']='http';
 const upstream=http.request({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers},r=>{
  const h={...r.headers};delete h['set-cookie'];res.writeHead(r.statusCode,h);r.pipe(res);
 });upstream.on('error',()=>{if(!res.headersSent){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Espaço de trabalho indisponível. Tente novamente.'}));}else res.destroy();});
 req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
}
export async function handlePlatform(req,res,url,{authorized,json,respond}){
 if(isWorker){
  if(url.pathname==='/api/platform/context'&&authorized(req)){respond(res,200,{role:'client',name:process.env.PROSPECTOR_TENANT_NAME});return true;}
  const allowed=/^\/api\/(?:training(?:\/|$)|state$|events$|kanban$|sales\/(?:status|outcomes)$|whatsapp\/(?:sessions|status|qr|connect|disconnect|chats|chat-messages|handoff|reply|reply-remote)$|prospecting(?:\/|$)|outreach\/consent-policy$|ai\/status$|settings$|maps(?:\/|$)|import$|threads\/[^/]+\/(?:messages|read)$|wa-akg\/webhook$)/;
  if(url.pathname.startsWith('/api/')&&!allowed.test(url.pathname)&&url.pathname!=='/api/auth/exchange'){respond(res,403,{error:'Recurso indisponível neste espaço de trabalho'});return true;}
  return false;
 }
 const p=url.pathname;
 if(req.method==='GET'&&(p==='/conheca'||p==='/cadastro'||p==='/entrar'||p==='/'&&!authorized(req)&&!clientFromRequest(req))){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  fs.createReadStream(fileURLToPath(new URL('./public/landing.html',import.meta.url))).pipe(res);return true;
 }
 if(req.method==='GET'&&['/landing.css','/landing.js','/product-theme.css'].includes(p)){
  res.writeHead(200,{'Content-Type':p.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-cache'});fs.createReadStream(fileURLToPath(new URL('./public'+p,import.meta.url))).pipe(res);return true;
 }
 if((p==='/api/platform/signup'||p==='/api/platform/signin')&&req.method==='POST'){
  const signingUp=p.endsWith('/signup'),guard=signingUp?signupLimiter:passwordLimiter,ip=accessClientKey(req);
  if(guard.blocked(ip)){respond(res,429,{error:'Muitas tentativas. Aguarde alguns minutos e tente novamente.'});return true;}
  guard.failed(ip);const input=await json(req),accountKey=crypto.createHash('sha256').update(String(input.identifier||input.email||'').trim().toLowerCase().slice(0,200)).digest('hex');
  if(!signingUp&&accountPasswordLimiter.blocked(accountKey)){respond(res,429,{error:'Muitas tentativas. Aguarde alguns minutos.'});return true;}
  if(!signingUp)accountPasswordLimiter.failed(accountKey);
  try{
   const c=signingUp?registry().signup(input):registry().signin(input);
   if(!c){respond(res,401,{error:'E-mail ou senha inválidos, ou conta indisponível.'});return true;}
   if(!signingUp){guard.clear(ip);accountPasswordLimiter.clear(accountKey);}
   res.setHeader('Set-Cookie',clientCookie(c));respond(res,signingUp?201:200,{ok:true,next:signingUp?'/#/training':'/#/overview'});
  }catch(e){respond(res,422,{error:String(e.message).slice(0,200)});}return true;
 }
 if(p==='/client/access'&&req.method==='GET'){
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  res.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acesso Prospector</title><link rel="stylesheet" href="/product-theme.css"><style>body{font:16px system-ui;background:#f4f7f6;display:grid;place-items:center;min-height:90vh}main{background:white;padding:40px;border-radius:20px;max-width:400px}a{color:#207c59}</style><body class="token-access"><main><h1>Seu espaço no Prospector</h1><p id="message">Validando seu acesso…</p><a href="/access">Acesso administrativo</a></main><script>(async()=>{const token=location.hash.slice(1);history.replaceState(null,"","/client/access");const m=document.getElementById("message");if(!token){m.textContent="Use o link privado recebido da sua agência.";return;}try{const r=await fetch("/api/platform/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});if(!r.ok)throw Error();location.replace("/");}catch{m.textContent="Acesso inválido ou suspenso. Solicite um novo link."}})()</script></html>');return true;
 }
 if(p==='/api/platform/login'&&req.method==='POST'){
  const ip=accessClientKey(req);if(limiter.blocked(ip)){respond(res,429,{error:'Muitas tentativas'});return true;}
  const c=registry().authenticate((await json(req)).token);if(!c){limiter.failed(ip);respond(res,401,{error:'Acesso inválido'});return true;}
  limiter.clear(ip);res.setHeader('Set-Cookie',clientCookie(c));respond(res,200,{ok:true});return true;
 }
 if(p==='/master'&&req.method==='GET'){
  res.writeHead(302,{'Location':'/#/clients','Set-Cookie':cookieName+'=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});res.end();return true;
 }
 const client=clientFromRequest(req);
 if(p==='/api/platform/context'){
  if(client)respond(res,200,{role:'client',...registry().publicClient(client),canReturnToMaster:authorized(req),package:{credits:250,priceBrl:9.9}});
  else if(authorized(req))respond(res,200,{role:'master',name:'Consecom Brasil',package:{credits:250,priceBrl:9.9}});
  else respond(res,401,{error:'Acesso necessário'});return true;
 }
 if(p==='/api/platform/logout'&&req.method==='POST'){res.setHeader('Set-Cookie',cookieName+'=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');respond(res,200,{ok:true});return true;}
 if(p==='/api/platform/credits'&&client){respond(res,200,{...registry().publicClient(client),items:registry().events(client.id),package:{credits:250,priceBrl:9.9}});return true;}
 if(p.startsWith('/api/platform/')){
  if(client||!authorized(req)){respond(res,403,{error:'Acesso exclusivo do painel master'});return true;}
  if(p==='/api/platform/primary-client'&&req.method==='POST'){respond(res,200,registry().configurePrimary(await json(req)));return true;}
  if(p==='/api/platform/clients'&&req.method==='GET'){respond(res,200,{items:registry().list()});return true;}
  if(p==='/api/platform/clients'&&req.method==='POST'){const r=registry().create(await json(req));respond(res,201,{...r,accessPath:'/client/access#'+r.token});return true;}
  const m=p.match(/^\/api\/platform\/clients\/([a-f0-9-]{36})\/(credits|status|access|open|release-reservations)$/);
  if(m){const c=registry().get(m[1]);if(!c){respond(res,404,{error:'Cliente não encontrado'});return true;}
   if(req.method==='POST'){const input=await json(req);
    if(m[2]==='open'){if(c.status!=='active'){respond(res,409,{error:'Reative a conta antes de abrir o painel'});return true;}res.setHeader('Set-Cookie',clientCookie(c));respond(res,200,{ok:true});}
    if(m[2]==='release-reservations'){if(input.confirmedNotSent!==true){respond(res,422,{error:'Confirme a conferência das entregas'});return true;}respond(res,200,{released:registry().releaseUncertain(c.id)});}
    if(m[2]==='credits')respond(res,200,{balance:registry().adjust(c.id,Number(input.amount),input.reason||'Ajuste pelo master',input.reference)});
    if(m[2]==='access')respond(res,200,{accessPath:'/client/access#'+registry().rotate(c.id)});
    if(m[2]==='status'){const r=registry().status(c.id,input.status);if(input.status==='suspended')workers.get(c.id)?.child.kill();respond(res,200,r);}return true;
   }
   if(m[2]==='credits'&&req.method==='GET'){respond(res,200,{balance:registry().balance(c.id),items:registry().events(c.id)});return true;}
  }
  respond(res,404,{error:'Recurso não encontrado'});return true;
 }
 if(p==='/api/wa-akg/webhook'&&url.searchParams.has('tenant')){
  const c=registry().get(url.searchParams.get('tenant'));if(!c||c.status!=='active'){respond(res,404,{error:'Canal indisponível'});return true;}
  await proxy(req,res,c);return true; // worker validates raw-body HMAC using this client's secret
 }
 if(client){
  if(p==='/access'||p==='/api/auth/exchange'||p.startsWith('/mcp')){respond(res,403,{error:'Acesso exclusivo do administrador'});return true;}
  if(client.is_internal===1)return false;
  await proxy(req,res,client);return true;
 }
 // A stale client cookie must never fall through to an administrator session.
 if(String(req.headers.cookie||'').includes(cookieName+'=')&&!['/access','/api/auth/exchange'].includes(p)){respond(res,401,{error:'Acesso do cliente expirou ou foi suspenso'});return true;}
 if(authorized(req)&&p.startsWith('/api/')&&!['/api/auth/exchange'].includes(p)){respond(res,403,{error:'Abra o painel de um cliente para acessar a operação.'});return true;}
 return false;
}
if(!isWorker)for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const w of workers.values())w.child.kill(signal);});
if(!isWorker&&process.env.NODE_ENV==='production'){
 const restore=()=>{for(const c of registry().list())if(c.status==='active'&&fs.existsSync(path.join(root,'clients',c.id,'prospector.sqlite')))void worker(registry().get(c.id)).catch(()=>{});};
 setTimeout(restore,15000).unref();setInterval(restore,60000).unref();
}
