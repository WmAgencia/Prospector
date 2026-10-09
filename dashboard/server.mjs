import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {one,all,run,tx,id,now,addLead,stage,getThread,getSetting,setSetting,audit,phone} from './db.mjs';
import {providerStatus,scoreLead,recordOrigin,discoverProfiles,verifyWebsiteCandidate} from './discovery.mjs';
import {productionList,offer,manualAccept,move,approveAndQueue,closeDeal,brief} from './production.mjs';
import {evaluateDecision,selectAutomationForLead} from './automation-router.mjs';
import {dailyReport,reportText,targetNumber} from './notifications.mjs';
import {syncPublishedSamples} from './studio-sync.mjs';
import {connection,connectWhatsApp,disconnectWhatsApp,restoreWhatsAppSession,startWorkflow,drive,manualJob,takeover,resume,tick,saveWorkflow,setDefaultWorkflow,setNotifier} from './runtime.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,'public');
const mediaDir=path.resolve(process.env.PROSPECTOR_DATA_DIR||'data','media');fs.mkdirSync(mediaDir,{recursive:true});

const envIsProd=process.env.NODE_ENV==='production'||!!process.env.RAILWAY_ENVIRONMENT;
const authToken=process.env.ADMIN_ACCESS_TOKEN||'';
const sessionSecret=process.env.ADMIN_SESSION_SECRET||'';
if(envIsProd&&(authToken.length<40||sessionSecret.length<40)){
 throw new Error('Acesso privado: configure ADMIN_ACCESS_TOKEN e ADMIN_SESSION_SECRET (40+ caracteres)');
}
const authCookieName='ps_session';
const sessionSeconds=90*24*60*60;
const attempts=new Map();
function safeEqual(a,b){
 const aa=Buffer.from(String(a||''),'utf8'),bb=Buffer.from(String(b||''),'utf8');
 return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);
}
function getCookie(req,name){
 const found=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));
 return found?found.slice(name.length+1):'';
}
function authorized(req){
 if(!envIsProd)return true;
 const raw=getCookie(req,authCookieName),dot=raw.lastIndexOf('.');
 if(dot<1)return false;
 const payload=raw.slice(0,dot),signature=raw.slice(dot+1);
 const expected=crypto.createHmac('sha256',sessionSecret).update(payload).digest('base64url');
 if(!safeEqual(signature,expected))return false;
 try{
  const claim=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  return claim.v===1&&Number.isFinite(claim.exp)&&claim.exp>Date.now()&&claim.exp<Date.now()+sessionSeconds*1000+60000;
 }catch{return false;}
}
function newSessionCookie(){
 const payload=Buffer.from(JSON.stringify({v:1,exp:Date.now()+sessionSeconds*1000,nonce:crypto.randomBytes(18).toString('base64url')}),'utf8').toString('base64url');
 const sig=crypto.createHmac('sha256',sessionSecret).update(payload).digest('base64url');
 return authCookieName+'='+payload+'.'+sig+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age='+sessionSeconds;
}
const accessHtml='<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acesso Consecom</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f4f6f3;color:#29382f;font:15px system-ui,sans-serif;padding:20px}main{max-width:440px;padding:36px;border:1px solid #d7e0d8;border-radius:22px;background:white;box-shadow:0 20px 60px #192c1920}h1{font-size:24px;margin:0 0 12px}p{line-height:1.7;color:#667468}</style><main><h1>Prospector Consecom</h1><p id="message">Validando acesso privado...</p></main><script>(async()=>{const p=location.hash.slice(1);history.replaceState(null,"","/access");const m=document.getElementById("message");if(!p){m.textContent="Abra seu link privado de acesso. Não é necessário usuário ou senha.";return;}try{const r=await fetch("/api/auth/exchange",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:p})});if(!r.ok)throw Error("link inválido");location.replace("/");}catch(e){m.textContent="Não foi possível validar seu acesso. Solicite um novo link privado.";}})();</script></html>';
function showAccess(res){
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(accessHtml);
}
async function exchangeAccess(req,res){
 const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim();
 const nowMs=Date.now(),previous=attempts.get(ip)||{count:0,reset:nowMs+600000};
 const item=previous.reset<nowMs?{count:0,reset:nowMs+600000}:previous;
 if(item.count>=8)return respond(res,429,{error:'Muitas tentativas'});
 const bytes=await body(req,4096);let token='';
 try{token=String(JSON.parse(bytes.toString('utf8')).token||'');}catch{}
 if(!safeEqual(token,authToken)){
  attempts.set(ip,{count:item.count+1,reset:item.reset});
  return respond(res,401,{error:'Link inválido'});
 }
 attempts.delete(ip);res.setHeader('Set-Cookie',newSessionCookie());
 return respond(res,200,{ok:true});
}
function protectedAccess(req,res,pathname){
 if(authorized(req))return true;
 if(req.method==='GET'&&(pathname==='/'||pathname==='/index.html')){
  res.writeHead(302,{Location:'/access','Cache-Control':'no-store'});res.end();return false;
 }
 respond(res,401,{error:'Acesso privado necessário'});return false;
}
function securityHeaders(res){
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Cross-Origin-Resource-Policy','same-origin');
 res.setHeader('Cache-Control','no-store');
}
function sameOriginWrite(req,res){
 if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return true;
 const origin=String(req.headers.origin||'');if(!origin)return true;
 const host=String(req.headers['x-forwarded-host']||req.headers.host||'');
 const protocol=String(req.headers['x-forwarded-proto']||'https').split(',')[0].trim();
 if(origin===protocol+'://'+host)return true;
 res.writeHead(403,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'Origem não autorizada'}));return false;
}

const clients=new Set();
function notify(){for(const res of [...clients]){try{res.write('event: update\ndata: {}\n\n');}catch{clients.delete(res);}}}
setNotifier(notify);
const web={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
function respond(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function error(res,e){const msg=e?.message||'Erro desconhecido';respond(res,400,{error:msg});}
async function body(req,limit=3*1024*1024){
 const parts=[];let size=0;
 for await (const chunk of req){size+=chunk.length;if(size>limit)throw Error('Corpo de requisição excede o limite');parts.push(chunk);}
 return Buffer.concat(parts);
}
async function json(req){const b=await body(req);return b.length?JSON.parse(b.toString('utf8')):{};}
const allowedSettings=new Set(['paused','auto_initial','min_minutes','daily_limit','business_start','business_end','automation_enabled','segments','cities','discovery_sources','discovery_priority','discovery_brazil_wide','score_weights','owner_phone_a','owner_phone_b','owner_notifications_enabled','owner_report_hour']);
function snapshot(){
 const leadOrigins=all('SELECT lead_id,source,verified FROM lead_origins ORDER BY at DESC');
 const leads=all('SELECT * FROM leads ORDER BY COALESCE(last_activity_at,created_at) DESC LIMIT 2000').map(l=>{const origins=leadOrigins.filter(o=>o.lead_id===l.id);return {...l,origins:[...new Set(origins.map(o=>o.source))],...scoreLead(l,origins)};});
 const threads=all('SELECT t.*,l.business,l.name,l.phone,l.stage FROM threads t JOIN leads l ON l.id=t.lead_id ORDER BY COALESCE(t.last_message_at,t.created_at) DESC LIMIT 1000');
 const workflows=all('SELECT * FROM workflows ORDER BY is_default DESC,updated_at DESC').map(w=>({...w,enabled:!!w.enabled,segments:JSON.parse(w.segments_json||'[]'),steps:JSON.parse(w.steps)}));
 const settings={};for(const x of all('SELECT key,value FROM settings'))try{settings[x.key]=JSON.parse(x.value);}catch{}
 const meetings=all("SELECT m.*,l.business,l.name FROM meetings m JOIN leads l ON m.lead_id=l.id ORDER BY m.start_at ASC LIMIT 100");
 const stats={profiles_analyzed:all('SELECT details FROM discoveries').reduce((total,row)=>{try{return total+(JSON.parse(row.details||'{}').examined||0);}catch{return total;}},0),qualified:leads.filter(l=>l.website_status==='NO_WEBSITE'&&l.phone).length,meetings:meetings.filter(x=>x.status==='SCHEDULED').length,found:leads.length,contacted:leads.filter(x=>x.stage!=='DISCOVERED').length,responded:leads.filter(x=>['REPLIED','INTERESTED','NO_INTEREST'].includes(x.stage)).length,interested:leads.filter(x=>x.stage==='INTERESTED').length,no_interest:leads.filter(x=>x.stage==='NO_INTEREST').length,without_site:leads.filter(x=>x.website_status==='NO_WEBSITE').length};
 return {production:productionList(),report:dailyReport(),ownerTarget:targetNumber(connection().user),providers:providerStatus(),stats,leads,threads,meetings,workflows,settings,media:all('SELECT * FROM media ORDER BY created_at DESC'),jobs:all('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 60'),discoveries:all('SELECT * FROM discoveries ORDER BY at DESC LIMIT 20'),connection:connection(),searchConfigured:!!process.env.BRAVE_SEARCH_API_KEY};
}
async function upload(req,url,res){
 const kind=url.searchParams.get('kind'),name=String(url.searchParams.get('name')||'mídia').slice(0,100);
 const kinds={video:['video/mp4'],audio:['audio/ogg','audio/mpeg','audio/mp4','audio/x-m4a','audio/opus'],image:['image/png','image/jpeg','image/webp']};
 const mime=String(req.headers['content-type']||'').split(';')[0];
 if(!kinds[kind]?.includes(mime))throw Error('Formato de arquivo não permitido');
 const buf=await body(req,kind==='video'?65*1024*1024:25*1024*1024);
 if(buf.length===0)throw Error('Arquivo vazio');
 if(kind==='video'&&buf.toString('ascii',4,8)!=='ftyp')throw Error('MP4 inválido');
 if(kind==='audio'&&mime==='audio/ogg'&&buf.toString('ascii',0,4)!=='OggS')throw Error('OGG inválido');
 if(kind==='image'&&mime==='image/png'&&buf.toString('hex',0,8)!=='89504e470d0a1a0a')throw Error('PNG inválido');
 if(kind==='image'&&mime==='image/jpeg'&&buf.toString('hex',0,3)!=='ffd8ff')throw Error('JPEG inválido');
 const extByMime={'video/mp4':'.mp4','audio/ogg':'.ogg','audio/mpeg':'.mp3','audio/mp4':'.m4a','audio/x-m4a':'.m4a','audio/opus':'.opus','image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'};
 const itemId=id(),fileName=itemId+extByMime[mime],target=path.join(mediaDir,fileName);
 fs.writeFileSync(target,buf,{flag:'wx'});
 let duration=null;
 if(kind==='video'){
  const probe=spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',target],{encoding:'utf8',timeout:8000});
  duration=Number(String(probe.stdout||'').trim());
  if(probe.error||probe.status!==0||!Number.isFinite(duration)||duration<=0||duration>60){
   fs.unlinkSync(target);throw Error('Vídeo inválido ou acima de 60s. Instale FFmpeg/ffprobe no computador.');
  }
 }
 run('INSERT INTO media VALUES(?,?,?,?,?,?,?,?)',itemId,name,kind,mime,fileName,duration,buf.length,now());
 notify();respond(res,201,{id:itemId,name,kind,duration,bytes:buf.length});
}
async function discovery(payload){
 const key=process.env.BRAVE_SEARCH_API_KEY;
 if(!key)throw Error('Configure BRAVE_SEARCH_API_KEY no ambiente para pesquisar perfis públicos');
 const q=String(payload.query||'').trim();
 if(q.length<3||q.length>350)throw Error('Consulta inválida');
 const u=new URL('https://api.search.brave.com/res/v1/web/search');
 u.search=new URLSearchParams({q:'site:instagram.com/ '+q,count:'20',country:'BR',search_lang:'pt'}).toString();
 const response=await fetch(u,{headers:{'X-Subscription-Token':key,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Brave Search HTTP '+response.status);
 const data=await response.json();let added=0,examined=0;
 const results=[];
 for(const result of data.web?.results||[]){
  let url;try{url=new URL(result.url);}catch{continue;}
  if(!/(^|\.)instagram\.com$/.test(url.hostname))continue;
  const username=url.pathname.split('/').filter(Boolean)[0]||'';
  if(!/^[a-z0-9_.]{2,30}$/i.test(username)||['p','reel','reels','explore','stories','accounts','direct','about'].includes(username))continue;
  examined++;
  const business=String(result.title||username).split(/(?:\(|•|[-|])/)[0].trim().slice(0,90)||username;
  const item=addLead({business,instagram:username,source:'WEB_INSTAGRAM',website_status:'UNCERTAIN',notes:String(result.description||'').slice(0,500)});
  if(item.created)added++;
  results.push({username,business,created:item.created});
 }
 run('INSERT INTO discoveries VALUES(?,?,?,?,?,?)',id(),q,added,now(),'COMPLETE',JSON.stringify({examined}));
 audit('DISCOVERY',null,{q,added,examined});
 notify();return {added,examined,results};
}
async function handler(req,res){
 try{
  securityHeaders(res);
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/health'&&req.method==='GET')return respond(res,200,{status:'ok'});
  if(!sameOriginWrite(req,res))return;
  if(url.pathname==='/access'&&req.method==='GET')return showAccess(res);
  if(url.pathname==='/api/auth/exchange'&&req.method==='POST')return exchangeAccess(req,res);
  if(!protectedAccess(req,res,url.pathname))return;
  const pathname=decodeURIComponent(url.pathname);
  if(pathname==='/api/events'){
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
   res.write('event: ready\ndata: {}\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;
  }
  if(req.method==='GET'&&pathname==='/api/state')return respond(res,200,snapshot());
  if(req.method==='POST'&&pathname.startsWith('/api/threads/ensure/')){const leadId=pathname.split('/')[4];if(!one('SELECT id FROM leads WHERE id=?',leadId))throw Error('Lead não existe');const t=getThread(leadId);notify();return respond(res,200,t);}
  if(req.method==='GET'&&/^\/api\/threads\/[^/]+\/messages$/.test(pathname)){
   const threadId=pathname.split('/')[3];return respond(res,200,all('SELECT * FROM messages WHERE thread_id=? ORDER BY at DESC LIMIT 300',threadId).reverse());
  }
  if(req.method==='POST'&&pathname==='/api/connect')return respond(res,200,await connectWhatsApp());
  if(req.method==='POST'&&pathname==='/api/disconnect')return respond(res,200,await disconnectWhatsApp());
  if(req.method==='POST'&&pathname==='/api/leads'){
   const value=await json(req),result=addLead(value);recordOrigin(result.lead.id,'MANUAL',{method:'panel'});notify();return respond(res,201,result);
  }
  if(req.method==='POST'&&pathname==='/api/import'){
   const v=await json(req);if(!Array.isArray(v.leads)||v.leads.length>300)throw Error('Máximo de 300 leads por importação');
   let created=0;const problems=[];
   for(const l of v.leads){try{const result=addLead(l);recordOrigin(result.lead.id,'MANUAL',{method:'import'});if(result.created)created++;}catch(e){problems.push(e.message);}}
   notify();return respond(res,200,{created,duplicates:v.leads.length-created-problems.length,errors:problems.slice(0,10)});
  }
  if(req.method==='POST'&&pathname.startsWith('/api/leads/')&&pathname.endsWith('/update')){
   const leadId=pathname.split('/')[3],v=await json(req),old=one('SELECT * FROM leads WHERE id=?',leadId);
   if(!old)throw Error('Lead não encontrado');
   const allowedStatus=['UNCERTAIN','NO_WEBSITE','HAS_WEBSITE','SOCIAL_ONLY','LINK_AGGREGATOR_ONLY','BROKEN_WEBSITE'];
   if(v.website_status&&!allowedStatus.includes(v.website_status))throw Error('Status do site inválido');
   const nPhone=v.phone!==undefined?phone(v.phone):old.phone;
   if(v.phone!==undefined&&old.phone!==nPhone&&one('SELECT lead_id FROM initial_contacts WHERE lead_id=?',leadId))throw Error('Telefone de lead já abordado não pode ser modificado');
   if(v.phone!==undefined&&v.phone&&!nPhone)throw Error('Telefone inválido');
   run('UPDATE leads SET name=?,business=?,phone=?,segment=?,city=?,website=?,website_status=?,notes=? WHERE id=?',
     String(v.name??old.name??''),String(v.business??old.business),nPhone,String(v.segment??old.segment??''),
     String(v.city??old.city??''),String(v.website??old.website??''),String(v.website_status??old.website_status),
     String(v.notes??old.notes??''),leadId);
   audit('LEAD_UPDATED',leadId,{website_status:v.website_status});notify();return respond(res,200,{ok:true});
  }
  if(req.method==='POST'&&pathname==='/api/meetings'){
   const v=await json(req);if(!one('SELECT id FROM leads WHERE id=?',v.lead_id))throw Error('Lead não encontrado');
   const when=new Date(v.start_at);if(!Number.isFinite(when.getTime())||when.getTime()<Date.now())throw Error('Data da reunião deve ser futura');
   const meetingId=id();run('INSERT INTO meetings(id,lead_id,start_at,notes,created_at) VALUES(?,?,?,?,?)',meetingId,v.lead_id,when.toISOString(),String(v.notes||''),now());
   audit('MEETING_CREATED',v.lead_id,{at:when.toISOString()});notify();return respond(res,201,{id:meetingId});
  }
  if(req.method==='POST'&&pathname.startsWith('/api/meetings/')&&pathname.endsWith('/cancel')){
   const meetingId=pathname.split('/')[3];run("UPDATE meetings SET status='CANCELLED' WHERE id=?",meetingId);
   notify();return respond(res,200,{ok:true});
  }
  if(req.method==='POST'&&pathname==='/api/discover'){const out=await discoverProfiles(await json(req));notify();return respond(res,200,out);}
  if(req.method==='POST'&&pathname.startsWith('/api/leads/')&&pathname.endsWith('/verify-site')){const leadId=pathname.split('/')[3];return respond(res,200,await verifyWebsiteCandidate(leadId));}
  if(req.method==='POST'&&pathname==='/api/workflows'){
   const workflowId=saveWorkflow(await json(req));notify();return respond(res,200,{id:workflowId});
  }
  if(req.method==='POST'&&pathname==='/api/automations/test'){
   const v=await json(req);if(!['sample_offer','general_interest'].includes(v.context))throw Error('Contexto inválido');
   if(typeof v.text!=='string'||v.text.length>1000)throw Error('Texto de teste inválido');
   return respond(res,200,evaluateDecision(v.text,v.context));
  }
  if(req.method==='POST'&&pathname==='/api/workflows/default'){
   const v=await json(req);setDefaultWorkflow(v.id);notify();return respond(res,200,{ok:true});
  }
  if(req.method==='POST'&&pathname==='/api/production/sync'){const result=await syncPublishedSamples();notify();return respond(res,200,result);}
  if(req.method==='GET'&&pathname==='/api/production')return respond(res,200,productionList());
  if(req.method==='GET'&&/^\/api\/production\/brief\/[^/]+$/.test(pathname))return respond(res,200,brief(pathname.split('/')[4]));
  if(req.method==='POST'&&pathname==='/api/production/offer'){const v=await json(req);const x=offer(v.lead_id,v.media_id);notify();return respond(res,201,x);}
  if(req.method==='POST'&&pathname==='/api/production/accept'){const v=await json(req);const x=manualAccept(v.lead_id);notify();return respond(res,200,x);}
  if(req.method==='POST'&&pathname==='/api/production/move'){const v=await json(req);const x=move(v.lead_id,v.status,v.site_url);notify();return respond(res,200,x);}
  if(req.method==='POST'&&pathname==='/api/production/approve'){const v=await json(req);const x=approveAndQueue(v.lead_id);notify();return respond(res,200,x);}
  if(req.method==='POST'&&pathname==='/api/production/close'){const v=await json(req);closeDeal(v.lead_id);notify();return respond(res,200,{ok:true});}
  if(req.method==='GET'&&pathname==='/api/report/today')return respond(res,200,{metrics:dailyReport(),text:reportText(dailyReport())});
  if(req.method==='POST'&&pathname==='/api/settings'){
   const v=await json(req);
   for(const [k,value] of Object.entries(v)){
    if(!allowedSettings.has(k))throw Error('Configuração desconhecida: '+k);
    if(['min_minutes','daily_limit','business_start','business_end'].includes(k)&&(!Number.isInteger(Number(value))||Number(value)<0||Number(value)>10000))throw Error('Valor inválido');
    if(k==='owner_report_hour'&&(!Number.isInteger(Number(value))||Number(value)<0||Number(value)>23))throw Error('Hora do relatório inválida');
    if(['owner_phone_a','owner_phone_b'].includes(k)&&value&&(!phone(value)||phone(value).length<12||phone(value).length>13))throw Error('Informe WhatsApp brasileiro válido com DDD');
    setSetting(k,['owner_phone_a','owner_phone_b'].includes(k)&&value?phone(value):value);
   }
   const a=getSetting('owner_phone_a',''),b=getSetting('owner_phone_b','');
   if(a&&b&&a===b){setSetting('owner_notifications_enabled',false);throw Error('Os dois números de WhatsApp devem ser diferentes');}
   notify();return respond(res,200,{ok:true});
  }
  if(req.method==='POST'&&pathname.startsWith('/api/workflows/start/')){
   const leadId=pathname.split('/')[4],input=await json(req);const runId=startWorkflow(leadId,input.workflow_id||null);drive(runId);notify();return respond(res,200,{executionId:runId});
  }
  if(req.method==='POST'&&pathname.startsWith('/api/workflows/resume/')){
   const leadId=pathname.split('/')[4];resume(leadId);notify();return respond(res,200,{ok:true});
  }
  if(req.method==='POST'&&pathname.startsWith('/api/threads/')&&pathname.endsWith('/takeover')){
   const threadId=pathname.split('/')[3],v=await json(req);takeover(threadId,!!v.value);return respond(res,200,{ok:true});
  }
  if(req.method==='POST'&&pathname.startsWith('/api/threads/')&&pathname.endsWith('/read')){
   const threadId=pathname.split('/')[3];run('UPDATE threads SET unread_count=0 WHERE id=?',threadId);notify();return respond(res,200,{ok:true});
  }
  if(req.method==='POST'&&pathname.startsWith('/api/leads/')&&pathname.endsWith('/stage')){
   const leadId=pathname.split('/')[3],v=await json(req);
   if(!['DISCOVERED','CONTACTED','REPLIED','INTERESTED','NO_INTEREST','CLOSED_WON'].includes(v.stage))throw Error('Etapa inválida');
   stage(leadId,v.stage);notify();return respond(res,200,{ok:true});
  }
  if(req.method==='POST'&&pathname.startsWith('/api/leads/')&&pathname.endsWith('/permission')){
   const leadId=pathname.split('/')[3],v=await json(req);
   run('UPDATE leads SET contact_permission=? WHERE id=?',v.value?1:0,leadId);notify();return respond(res,200,{ok:true});
  }
  if(req.method==='POST'&&pathname.startsWith('/api/leads/')&&pathname.endsWith('/messages')){
   const leadId=pathname.split('/')[3],v=await json(req);return respond(res,202,{jobId:manualJob(leadId,v.text||'',v.type||'message',v.media_id||null)});
  }
  if(req.method==='POST'&&pathname==='/api/media')return upload(req,url,res);
  if(req.method==='GET'&&pathname.startsWith('/api/media/')){
   const media=one('SELECT * FROM media WHERE id=?',pathname.split('/')[3]);if(!media)return respond(res,404,{error:'Arquivo não encontrado'});
   const f=path.join(mediaDir,media.filename);res.writeHead(200,{'Content-Type':media.mime,'Content-Length':media.bytes,'Cache-Control':'private, max-age=120'});fs.createReadStream(f).pipe(res);return;
  }
  if(req.method==='GET'&&/^\/studio\/(?:projects\.json|sites\/[a-z0-9-]{2,80}\.html)$/.test(pathname)){
   const studioRoot=path.resolve(here,'..','studio');
   const filePath=path.resolve(here,'..',pathname.slice(1));
   if(!filePath.startsWith(studioRoot+path.sep)||!fs.existsSync(filePath))return respond(res,404,{error:'Prévia não encontrada'});
   const mime=pathname.endsWith('.json')?'application/json; charset=utf-8':'text/html; charset=utf-8';
   res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   fs.createReadStream(filePath).pipe(res);return;
  }
  if(req.method!=='GET')return respond(res,404,{error:'Rota inexistente'});
  const target=pathname==='/'?'index.html':pathname.slice(1);
  if(!['index.html','app.js','style.css'].includes(target))return respond(res,404,{error:'Arquivo inexistente'});
  const f=path.join(root,target),ext=path.extname(f);
  res.writeHead(200,{'Content-Type':web[ext]||'text/plain','Cache-Control':'no-cache'});fs.createReadStream(f).pipe(res);
 }catch(e){console.error('[API]',e?.message);error(res,e);}
}
const host=envIsProd?'0.0.0.0':'127.0.0.1',port=Number(process.env.PORT||3030);
const server=http.createServer(handler);
const interval=setInterval(()=>tick().catch(e=>console.error('[tick]',e.message)),2500);
const syncInterval=setInterval(()=>syncPublishedSamples().then(r=>{if(r.ready)notify()}).catch(e=>console.error('[studio sync]',e.message)),60_000);
server.listen(port,host,()=>{console.log('Prospector: http://'+host+':'+port);restoreWhatsAppSession().then(r=>{if(r.restored)console.log('[whatsapp] Restaurando sessão persistida');}).catch(e=>console.error('[whatsapp] Falha ao restaurar sessão:',e.message));});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(interval);clearInterval(syncInterval);server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),7000).unref();});
