import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {one,all,run,tx,id,now,addLead,stage,getThread,getSetting,setSetting,audit,phone} from './db.mjs';
import {providerStatus,scoreLead,recordOrigin,discoverProfiles,verifyWebsiteCandidate} from './discovery.mjs';
import {setSalesCampaign} from './sales-campaign.mjs';
import {searchDirectory} from './external-research.mjs';
import {catalogQuery,catalogSummary} from './lead-catalog.mjs';
import {googleIndexStatus} from './google-places-index.mjs';
import {decideMessage,scoreOpportunity,contexts} from './decision-intelligence/engine.mjs';
import {modelPredict,modelStatistics,labelExample} from './decision-intelligence/learning.mjs';
import {evidence,STATUSES} from './website-review.mjs';
import {eligibleRecontacts,scheduleApprovedRecontact} from './contact-cadence.mjs';
import {discoverLocal,dailyLocalDiscovery,reconcileInterruptedSearches,LOCATIONS,SEGMENTS} from './osm-discovery.mjs';
import {radarSnapshot} from './radar.mjs';
import {importCampaignPackage} from './campaign-package.mjs';
import {bridgeStatus,bridgeSpec,syncAgentBridge} from './agent-bridge.mjs';
import {restorePrivateCampaign,privateRestoreStatus} from './private-restore.mjs';
import {activateCampaign,selectedCampaign,rejectActiveCampaignEdit} from './campaign-selection.mjs';
import {outreachQueueSnapshot} from './outreach-queue.mjs';
import {queueOperatorTest,refreshOperatorReplies,runOperatorDeliveryRetry} from './operator-campaign-check.mjs';
import {enableInvitationCampaign} from './permission-invitation.mjs';
import {enableAuthorizedOutreach} from './authorized-outreach.mjs';
import {importOfficial} from './official-import.mjs';
import {siteAudit} from './site-audit.mjs';
import {productionList,offer,manualAccept,move,approveAndQueue,closeDeal,brief} from './production.mjs';
import {evaluateDecision,selectAutomationForLead} from './automation-router.mjs';
import {dailyReport,reportText,targetNumber} from './notifications.mjs';
import {syncPublishedSamples} from './studio-sync.mjs';
import {connection,tickStatus,connectWhatsApp,disconnectWhatsApp,restoreWhatsAppSession,startWorkflow,drive,manualJob,takeover,resume,tick,saveWorkflow,setDefaultWorkflow,setNotifier} from './runtime.mjs';
import {queueHealth} from './queue-health.mjs';
import {aiStatus,aiDraft} from './ai-groq.mjs';
import {gatewayStatus,gatewayInbox,receiveWebhook,draftInbox,sendApproved} from './waakg-bridge.mjs';
import {placesStatus,placesSearch} from './google-places-live.mjs';

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
const web={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
function respond(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function error(res,e){const msg=e?.message||'Erro desconhecido';respond(res,400,{error:msg});}
async function body(req,limit=3*1024*1024){
 const parts=[];let size=0;
 for await (const chunk of req){size+=chunk.length;if(size>limit)throw Error('Corpo de requisição excede o limite');parts.push(chunk);}
 return Buffer.concat(parts);
}
async function json(req){const b=await body(req);return b.length?JSON.parse(b.toString('utf8')):{};}
const allowedSettings=new Set(['decision_learning_enabled','decision_engine_enabled','paused','auto_initial','min_minutes','daily_limit','business_start','business_end','initial_interval_seconds','discovery_target_daily','discovery_start_hour','automation_enabled','segments','cities','discovery_sources','discovery_auto_enabled','discovery_priority','discovery_brazil_wide','score_weights','owner_phone_a','owner_phone_b','owner_notifications_enabled','owner_report_hour']);
function snapshot(){
 const leadOrigins=all('SELECT o.lead_id,o.source,o.verified FROM lead_origins o WHERE o.lead_id IN (SELECT id FROM leads ORDER BY COALESCE(last_activity_at,created_at) DESC LIMIT 2000) ORDER BY o.at DESC');
  const originsByLead=new Map();for(const origin of leadOrigins){if(!originsByLead.has(origin.lead_id))originsByLead.set(origin.lead_id,[]);originsByLead.get(origin.lead_id).push(origin);}
 const lastSiteReview=new Map();
 for(const row of all("SELECT lead_id,detail FROM audit WHERE action='WEBSITE_EVIDENCE_RECORDED' ORDER BY at DESC LIMIT 3000")){
  if(!lastSiteReview.has(row.lead_id)){try{lastSiteReview.set(row.lead_id,JSON.parse(row.detail));}catch{}}
 }
 const leads=all('SELECT * FROM leads ORDER BY COALESCE(last_activity_at,created_at) DESC LIMIT 2000').map(l=>{const origins=originsByLead.get(l.id)||[];return {...l,origins:[...new Set(origins.map(o=>o.source))],siteEvidence:lastSiteReview.get(l.id)||null,...scoreLead(l,origins)};});
 const threads=all('SELECT t.*,l.business,l.name,l.phone,l.stage FROM threads t JOIN leads l ON l.id=t.lead_id ORDER BY COALESCE(t.last_message_at,t.created_at) DESC LIMIT 1000');
 const workflows=all('SELECT * FROM workflows ORDER BY is_default DESC,updated_at DESC').map(w=>({...w,enabled:!!w.enabled,segments:JSON.parse(w.segments_json||'[]'),steps:JSON.parse(w.steps)}));
 const settings={};for(const x of all('SELECT key,value FROM settings'))try{settings[x.key]=JSON.parse(x.value);}catch{}
 const meetings=all("SELECT m.*,l.business,l.name FROM meetings m JOIN leads l ON m.lead_id=l.id ORDER BY m.start_at ASC LIMIT 100");
 const stats={profiles_analyzed:all('SELECT details FROM discoveries').reduce((total,row)=>{try{return total+(JSON.parse(row.details||'{}').examined||0);}catch{return total;}},0),qualified:leads.filter(l=>l.website_status==='NO_WEBSITE'&&l.phone).length,meetings:meetings.filter(x=>x.status==='SCHEDULED').length,found:one('SELECT COUNT(*) AS total FROM leads')?.total||0,contacted:one("SELECT COUNT(*) AS total FROM initial_contacts WHERE status='SENT'")?.total||0,responded:leads.filter(x=>['REPLIED','INTERESTED','NO_INTEREST'].includes(x.stage)).length,interested:leads.filter(x=>x.stage==='INTERESTED').length,no_interest:leads.filter(x=>x.stage==='NO_INTEREST').length,without_site:leads.filter(x=>x.website_status==='NO_WEBSITE').length};
 return {radar:radarSnapshot(),catalog:catalogSummary(),googleIndex:googleIndexStatus(),outreachQueue:outreachQueueSnapshot(),activeCampaign:selectedCampaign(),bridge:bridgeStatus(),recontacts:eligibleRecontacts(),localDiscovery:{cities:Object.values(LOCATIONS).map(x=>x.label),segments:Object.keys(SEGMENTS).map(k=>({id:k,label:SEGMENTS[k].label})),autoEnabled:getSetting('discovery_auto_enabled',true),source:'© OpenStreetMap contributors (ODbL)'},production:productionList(),report:dailyReport(),ownerTarget:targetNumber(connection().user),providers:providerStatus(),stats,leads,threads,meetings,workflows,settings,media:all('SELECT * FROM media ORDER BY created_at DESC'),jobs:all('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 60'),discoveries:all('SELECT * FROM discoveries ORDER BY at DESC LIMIT 20'),connection:connection(),searchConfigured:!!process.env.BRAVE_SEARCH_API_KEY};
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
  // Only WA-AKG HMAC-signed events may bypass dashboard session authentication.
  // Do not allow browser proxies or the public Vercel frontend to forge this header.
  if(url.pathname==='/api/wa-akg/webhook'){
   if(req.method!=='POST')return respond(res,405,{error:'Method not allowed'});
   try{const output=await receiveWebhook(req);return respond(res,output.status,output.body);}
   catch(err){return respond(res,400,{error:'Webhook inválido'});}
  }
  if(!protectedAccess(req,res,url.pathname))return;
  const pathname=decodeURIComponent(url.pathname);
  if(pathname==='/api/events'){
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
   res.write('event: ready\ndata: {}\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;
  }
  if(req.method==='GET'&&pathname==='/api/state')return respond(res,200,snapshot());
  if(req.method==='GET'&&pathname==='/api/google-places/status')return respond(res,200,placesStatus());
  if(req.method==='POST'&&pathname==='/api/google-places/search'){const result=await placesSearch(await json(req));return respond(res,result.status,result.body);}
  if(req.method==='GET'&&pathname==='/api/wa-akg/status')return respond(res,200,gatewayStatus());
  if(req.method==='GET'&&pathname==='/api/wa-akg/inbox')return respond(res,200,gatewayInbox());
  if(req.method==='POST'&&pathname==='/api/wa-akg/draft'){const r=await draftInbox(await json(req));return respond(res,r.status,r.body);}
  if(req.method==='POST'&&pathname==='/api/wa-akg/send-approved'){const r=await sendApproved(await json(req));return respond(res,r.status,r.body);}
  if(req.method==='GET'&&pathname==='/api/ai/status')return respond(res,200,aiStatus());
  if(req.method==='POST'&&pathname==='/api/ai/test'){
   const result=await aiDraft({text:"Responda somente OK."});
   // Health-only output; never reveal provider text, credentials, or customer data.
   return respond(res,result.ok?200:result.httpStatus||502,{ok:result.ok,provider:result.provider,model:result.model||null,code:result.code||null,autoSend:false});
  }
  if(req.method==='POST'&&pathname==='/api/ai/draft'){
   const payload=await json(req);
   const result=await aiDraft({text:payload.text,context:payload.context});
   return respond(res,result.ok?200:result.httpStatus||502,result);
  }

  if(req.method==='GET'&&pathname==='/api/agent-bridge/status')return respond(res,200,{...bridgeStatus(),privateMediaRestore:privateRestoreStatus()});
  if(req.method==='GET'&&pathname==='/api/agent-bridge/spec')return respond(res,200,bridgeSpec());
  if(req.method==='POST'&&pathname==='/api/agent-bridge/sync'){
   const result=await syncAgentBridge();notify();return respond(res,result.state==='SYNC_ERROR'?502:200,result);
  }
  if(req.method==='GET'&&pathname==='/api/radar')return respond(res,200,radarSnapshot());
  if(req.method==='GET'&&pathname==='/api/outreach-queue')return respond(res,200,outreachQueueSnapshot());
  if(req.method==='GET'&&pathname==='/api/recontacts')return respond(res,200,eligibleRecontacts());
  if(req.method==='POST'&&pathname==='/api/recontacts/approve'){
   const v=await json(req),result=scheduleApprovedRecontact(v.lead_id,v.text);
   notify();return respond(res,202,result);
  }
  if(req.method==='POST'&&pathname==='/api/campaign/configure'){
   const v=await json(req),result=setSalesCampaign(v);
   notify();return respond(res,200,result);
  }
  if(req.method==='GET'&&pathname==='/api/queue-health')return respond(res,200,{...queueHealth({waStatus:connection().status,busy:tickStatus().locked}),worker:tickStatus()});
  if(req.method==='GET'&&pathname==='/api/diagnostics'){
   const last=one('SELECT query,found,status,at FROM discoveries ORDER BY at DESC LIMIT 1');
   const totals=all('SELECT status,COUNT(*) AS total FROM jobs GROUP BY status');
   const data={at:now(),uptimeSeconds:Math.round(process.uptime()),connection:connection(),queueHealth:queueHealth({waStatus:connection().status,busy:tickStatus().locked}),worker:tickStatus(),discovery:{osmEnabled:getSetting('discovery_sources',{}).osm!==false,braveConfigured:!!process.env.BRAVE_SEARCH_API_KEY,last},leadCount:one('SELECT COUNT(*) AS n FROM leads')?.n||0,queue:Object.fromEntries(totals.map(x=>[x.status,x.total])),settings:{paused:getSetting('paused',true),autoInitial:getSetting('auto_initial',false)}};
   // QR image, phone number and session identifiers never appear in diagnostics.
   data.connection={decryption:data.connection.decryption,status:data.connection.status,error:data.connection.error,closeCode:data.connection.closeCode,lastEventAt:data.connection.lastEventAt,hasQr:Boolean(data.connection.qr)};
   return respond(res,200,data);
  }
  if(req.method==='POST'&&pathname.startsWith('/api/threads/ensure/')){const leadId=pathname.split('/')[4];if(!one('SELECT id FROM leads WHERE id=?',leadId))throw Error('Lead não existe');const t=getThread(leadId);notify();return respond(res,200,t);}
  if(req.method==='GET'&&/^\/api\/threads\/[^/]+\/messages$/.test(pathname)){
   const threadId=pathname.split('/')[3];return respond(res,200,all('SELECT * FROM messages WHERE thread_id=? ORDER BY at DESC LIMIT 300',threadId).reverse());
  }
  if(req.method==='POST'&&pathname==='/api/connect'){const args=await json(req);return respond(res,200,await connectWhatsApp({fresh:args.fresh===true}));}
  if(req.method==='POST'&&pathname==='/api/disconnect')return respond(res,200,await disconnectWhatsApp());
  if(req.method==='POST'&&pathname==='/api/leads'){
   const value=await json(req);
   if(value.contact_permission===true&&!String(value.permission_proof||'').trim())throw Error('Contato autorizado exige registro de comprovante');
   const result=addLead(value);recordOrigin(result.lead.id,'MANUAL',{method:'panel'});
   if(value.contact_permission===true)audit('CONSENT_UPDATED',result.lead.id,{permitted:true,evidence:String(value.permission_proof).trim().slice(0,300),method:'manual_registration'});
   notify();return respond(res,201,result);
  }
  if(req.method==='POST'&&pathname==='/api/import'){
   const v=await json(req);if(!Array.isArray(v.leads)||v.leads.length>300)throw Error('Máximo de 300 leads por importação');
   let created=0;const problems=[];
   for(const l of v.leads){try{
    if(l.contact_permission===true&&!String(l.permission_proof||'').trim())throw Error('Importação de contato autorizado exige comprovante');
    const result=addLead(l);recordOrigin(result.lead.id,'MANUAL',{method:'import'});
    if(l.contact_permission===true)audit('CONSENT_UPDATED',result.lead.id,{permitted:true,evidence:String(l.permission_proof).trim().slice(0,300),method:'import'});
    if(result.created)created++;
   }catch(e){problems.push(e.message);}}
   notify();return respond(res,200,{created,duplicates:v.leads.length-created-problems.length,errors:problems.slice(0,10)});
  }
  if(req.method==='POST'&&pathname.startsWith('/api/leads/')&&pathname.endsWith('/update')){
   const leadId=pathname.split('/')[3],v=await json(req),old=one('SELECT * FROM leads WHERE id=?',leadId);
   if(!old)throw Error('Lead não encontrado');
   if(v.website_status&&!STATUSES.includes(v.website_status))throw Error('Status do site inválido');
   const siteReview=evidence(v,old);
   const nPhone=v.phone!==undefined?phone(v.phone):old.phone;
   if(v.phone!==undefined&&old.phone!==nPhone&&one('SELECT lead_id FROM initial_contacts WHERE lead_id=?',leadId))throw Error('Telefone de lead já abordado não pode ser modificado');
   if(v.phone!==undefined&&v.phone&&!nPhone)throw Error('Telefone inválido');
   run('UPDATE leads SET name=?,business=?,phone=?,segment=?,city=?,website=?,website_status=?,notes=? WHERE id=?',
     String(v.name??old.name??''),String(v.business??old.business),nPhone,String(v.segment??old.segment??''),
     String(v.city??old.city??''),String(v.website??old.website??''),String(v.website_status??old.website_status),
     String(v.notes??old.notes??''),leadId);
   if(siteReview)audit('WEBSITE_EVIDENCE_RECORDED',leadId,siteReview);
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
  if(req.method==='GET'&&pathname==='/api/catalog')return respond(res,200,catalogQuery(Object.fromEntries(url.searchParams)));
   if(req.method==='GET'&&pathname==='/api/catalog/summary')return respond(res,200,catalogSummary());
   if(req.method==='GET'&&pathname==='/api/research/google-index')return respond(res,200,googleIndexStatus());
  if(req.method==='GET'&&pathname==='/api/intelligence/status')return respond(res,200,{enabled:getSetting('decision_engine_enabled',true),learningEnabled:getSetting('decision_learning_enabled',false),models:contexts.map(modelStatistics),mode:'contextual_rules_plus_optional_review_only_classifier',leadScoreVersion:'consecom-lead-score-v2'});
  if(req.method==='POST'&&pathname==='/api/intelligence/test'){
   const input=await json(req);if(typeof input.text!=='string'||input.text.length>1500)throw Error('Mensagem inválida');
   const context=String(input.context||'general_interest');
   if(!contexts.includes(context))throw Error('Contexto inválido');
   const model=getSetting('decision_learning_enabled',false)?modelPredict(input.text,context):null;
   return respond(res,200,{...decideMessage(input.text,context,{modelPrediction:model}),statisticalModel:model});
  }
  if(req.method==='POST'&&pathname==='/api/intelligence/label'){
   const input=await json(req);const out=labelExample(input);notify();return respond(res,200,out);
  }
   if(req.method==='POST'&&pathname==='/api/research/external'){const result=await searchDirectory(await json(req));return respond(res,200,result);}
  if(req.method==='POST'&&pathname==='/api/discover/official'){const raw=await body(req,8*1024*1024);const out=importOfficial(JSON.parse(raw.toString('utf8')));notify();return respond(res,200,out);}
  if(req.method==='POST'&&pathname.startsWith('/api/leads/')&&pathname.endsWith('/site-audit')){return respond(res,200,await siteAudit(pathname.split('/')[3]));}
  if(req.method==='POST'&&pathname==='/api/discover/osm'){const out=await discoverLocal(await json(req));notify();return respond(res,200,out);}
  if(req.method==='POST'&&pathname==='/api/discover'){const out=await discoverProfiles(await json(req));notify();return respond(res,200,out);}
  if(req.method==='POST'&&pathname.startsWith('/api/leads/')&&pathname.endsWith('/verify-site')){const leadId=pathname.split('/')[3];return respond(res,200,await verifyWebsiteCandidate(leadId));}
  if(req.method==='POST'&&pathname==='/api/workflows'){
   const payload=await json(req);rejectActiveCampaignEdit(payload);
   const workflowId=saveWorkflow(payload);notify();return respond(res,200,{id:workflowId});
  }
  if(req.method==='POST'&&pathname==='/api/workflows/activate'){
   const payload=await json(req),result=activateCampaign(payload.id);
   notify();return respond(res,200,result);
  }
  if(req.method==='POST'&&pathname==='/api/automations/test'){
   const v=await json(req);if(!['sample_offer','general_interest','website_interest'].includes(v.context))throw Error('Contexto inválido');
   if(typeof v.text!=='string'||v.text.length>1000)throw Error('Texto de teste inválido');
   return respond(res,200,evaluateDecision(v.text,v.context));
  }
  if(req.method==='POST'&&pathname==='/api/workflows/default'){
   const payload=await json(req),result=activateCampaign(payload.id);
   notify();return respond(res,200,result);
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
    if(['min_minutes','daily_limit','business_start','business_end','initial_interval_seconds','discovery_target_daily','discovery_start_hour'].includes(k)&&(!Number.isInteger(Number(value))||Number(value)<0||Number(value)>10000))throw Error('Valor inválido');
    if(k==='daily_limit'&&Number(value)>150)throw Error('O teto diário é 150 primeiras abordagens');
     // Controles do motor de decisão são booleanos (sem alterar campanha/horários).
     if(['decision_engine_enabled','decision_learning_enabled'].includes(k)&&typeof value!=='boolean')throw Error('Use verdadeiro ou falso para o motor de decisão');
    if(k==='discovery_target_daily'&&(Number(value)<1||Number(value)>150))throw Error('A meta de descoberta deve ser de 1 a 150');
    if(k==='discovery_start_hour'&&(Number(value)<0||Number(value)>23))throw Error('O início da descoberta deve ficar entre 0h e 23h');
    if(k==='initial_interval_seconds'&&Number(value)<144)throw Error('Intervalo mínimo é 144 segundos');
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
   const oldPermission=one('SELECT id,contact_permission FROM leads WHERE id=?',leadId);
   if(!oldPermission)throw Error('Lead não encontrado');
   if(v.value===true&&oldPermission.contact_permission===1&&!String(v.proof||'').trim())return respond(res,200,{ok:true,unchanged:true});
   if(v.value===true&&!String(v.proof||'').trim())throw Error('Registre como a pessoa autorizou mensagens pelo WhatsApp');
   run('UPDATE leads SET contact_permission=? WHERE id=?',v.value?1:0,leadId);
   if(v.value!==true){
    run("UPDATE jobs SET status='CANCELLED',updated_at=? WHERE lead_id=? AND status='PENDING'",now(),leadId);
    run("UPDATE executions SET state='NEEDS_REVIEW',updated_at=? WHERE lead_id=? AND state NOT IN ('COMPLETE','CANCELLED')",now(),leadId);
   }
   audit('CONSENT_UPDATED',leadId,{permitted:v.value===true,evidence:String(v.proof||'').slice(0,150)});
   notify();return respond(res,200,{ok:true});
  }
  if(req.method==='POST'&&pathname.startsWith('/api/leads/')&&pathname.endsWith('/messages')){
   const leadId=pathname.split('/')[3],v=await json(req);return respond(res,202,{jobId:manualJob(leadId,v.text||'',v.type||'message',v.media_id||null)});
  }
  if(req.method==='POST'&&pathname==='/api/campaign/import-package'){
   const mime=String(req.headers['content-type']||'').split(';')[0];
   if(!['application/zip','application/octet-stream'].includes(mime))throw Error('Envie o arquivo ZIP de campanha');
   const result=importCampaignPackage(await body(req,38*1024*1024));
   const bridge=await syncAgentBridge();
   notify();return respond(res,200,{...result,bridge:bridge.state});
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
  if(!['index.html','app.js','style.css','campaign-ui.js','campaign-ui.mjs','campaign-ui-state.mjs','campaign-ui.css','radar-ui.js'].includes(target))return respond(res,404,{error:'Arquivo inexistente'});
  const f=path.join(root,target),ext=path.extname(f);
  res.writeHead(200,{'Content-Type':web[ext]||'text/plain','Cache-Control':'no-cache'});fs.createReadStream(f).pipe(res);
 }catch(e){console.error('[API]',e?.message);error(res,e);}
}
const host=envIsProd?'0.0.0.0':'127.0.0.1',port=Number(process.env.PORT||3030);
const server=http.createServer(handler);
const activation=enableAuthorizedOutreach();
const invitationActivation=enableInvitationCampaign();
const invitationQueue=outreachQueueSnapshot();
console.log('[invitation campaign]',JSON.stringify({...invitationActivation,ready:invitationQueue.ready,waiting:invitationQueue.awaitingConsent,paused:getSetting('paused',true),autoInitial:getSetting('auto_initial',false)}));
console.log('[authorized outreach]',activation.status,'ready='+activation.ready,'waiting='+activation.awaitingConsent);
let testInstructionError=null;
let lastQueueReason=null,lastQueueLogAt=0;
function reportQueueHealth(){
 const snapshot=queueHealth({waStatus:connection().status,busy:tickStatus().locked});
 if(snapshot.reason!==lastQueueReason||Date.now()-lastQueueLogAt>=15*60000||snapshot.alert){
  console.info('[queue health]',JSON.stringify({reason:snapshot.reason,alert:snapshot.alert,ready:snapshot.eligibleWaiting,pending:snapshot.initialPending,oldestPendingMinutes:snapshot.oldestPendingMinutes,unknown:snapshot.unknownInitial,sentToday:snapshot.initialToday.sent,counted:snapshot.initialToday.counted,limit:snapshot.initialToday.limit,nextAt:snapshot.initialToday.nextAt,lastAccepted:snapshot.lastConfirmedInitialAt,inventory:snapshot.inventory,queue:snapshot.queue,discovery:snapshot.discovery,uncertainReasons:snapshot.uncertainReasons,tick:tickStatus()}));
  lastQueueReason=snapshot.reason;lastQueueLogAt=Date.now();
 }
}
const healthTimer=setInterval(()=>{try{reportQueueHealth();}catch(e){console.error('[queue health]',e.message);}},3*60000);
setTimeout(()=>{try{reportQueueHealth();}catch(e){console.error('[queue health]',e.message);}},5000).unref();
const interval=setInterval(()=>{
 try{queueOperatorTest();}catch(error){if(testInstructionError!==error.message){testInstructionError=error.message;console.error('[campaign test]',error.message);}}
 runOperatorDeliveryRetry().catch(error=>console.error('[campaign test] Falha no reenvio controlado: '+error.message));
 refreshOperatorReplies().catch(error=>console.error('[campaign test] Falha na recuperação de resposta: '+error.message));
 tick().catch(e=>console.error('[tick]',e.message));
},2500);
const agentBridgeTimer=setInterval(()=>syncAgentBridge().then(s=>{const result=enableAuthorizedOutreach();if(result.status==='ENABLED')console.log('[authorized outreach]',result.status,'ready='+result.ready);if(s.state==='READY'||s.state==='WAITING_MEDIA')notify();}).catch(e=>console.error('[agent bridge]',e.message)),120000);
setTimeout(()=>restorePrivateCampaign().then(s=>{console.log('[private media restore]',s.state,s.message||'');if(s.state==='IMPORTED')syncAgentBridge().then(()=>notify()).catch(()=>{});}).catch(e=>console.error('[private media restore]',e.message)),5000).unref();
setTimeout(()=>syncAgentBridge().then(()=>{const x=enableAuthorizedOutreach();if(x.status==='ENABLED')console.log('[authorized outreach]',x.status,'ready='+x.ready);notify();}).catch(e=>console.error('[agent bridge]',e.message)),10000).unref();
const interruptedSearches=reconcileInterruptedSearches();
if(interruptedSearches.recovered)console.info('[osm discovery] Recuperadas '+interruptedSearches.recovered+' consultas interrompidas; mantidas na cota diária');
function checkOSMDiscovery(){
 return dailyLocalDiscovery().then(x=>{
  if(x?.source==='osm'&&x.added)notify();
  if(x?.source==='osm'||x?.status==='SOURCE_ERROR'||x?.status==='PROVIDER_LIMIT')
   console.info('[osm discovery]',JSON.stringify({status:x.status||'COMPLETE',city:x.city,segment:x.segment,examined:x.examined,added:x.added,withPhone:x.withPhone,foundToday:x.foundToday,reason:x.error}));
 }).catch(err=>console.error('[osm discovery]',err.message));
}
const osmTimer=setInterval(checkOSMDiscovery,60*1000);
// Somente OSM executa pesquisas automáticas. Google Places permanece inativo.
setTimeout(checkOSMDiscovery,12000).unref();
const syncInterval=setInterval(()=>syncPublishedSamples().then(r=>{if(r.ready)notify()}).catch(e=>console.error('[studio sync]',e.message)),60_000);
server.listen(port,host,()=>{console.log('Prospector: http://'+host+':'+port);restoreWhatsAppSession().then(r=>{if(r.restored)console.log('[whatsapp] Restaurando sessão persistida');}).catch(e=>console.error('[whatsapp] Falha ao restaurar sessão:',e.message));});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(interval);clearInterval(syncInterval);clearInterval(osmTimer);clearInterval(agentBridgeTimer);clearInterval(healthTimer);server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),7000).unref();});
