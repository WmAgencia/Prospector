import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {one,all,run,tx,id,now,addLead,stage,getThread,getSetting,setSetting,audit,phone} from './db.mjs';
import {providerStatus,scoreLead,recordOrigin,discoverProfiles,verifyWebsiteCandidate} from './discovery.mjs';
import {connection,connectWhatsApp,disconnectWhatsApp,startWorkflow,drive,manualJob,takeover,resume,tick,saveWorkflow,setDefaultWorkflow,setNotifier} from './runtime.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(here,'public');
const mediaDir=path.resolve('data','media');fs.mkdirSync(mediaDir,{recursive:true});
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
const allowedSettings=new Set(['paused','auto_initial','min_minutes','daily_limit','business_start','business_end','automation_enabled','segments','cities','discovery_sources','discovery_priority','discovery_brazil_wide','score_weights']);
function snapshot(){
 const leadOrigins=all('SELECT lead_id,source,verified FROM lead_origins ORDER BY at DESC');
 const leads=all('SELECT * FROM leads ORDER BY COALESCE(last_activity_at,created_at) DESC LIMIT 2000').map(l=>{const origins=leadOrigins.filter(o=>o.lead_id===l.id);return {...l,origins:[...new Set(origins.map(o=>o.source))],...scoreLead(l,origins)};});
 const threads=all('SELECT t.*,l.business,l.name,l.phone,l.stage FROM threads t JOIN leads l ON l.id=t.lead_id ORDER BY COALESCE(t.last_message_at,t.created_at) DESC LIMIT 1000');
 const workflows=all('SELECT * FROM workflows ORDER BY is_default DESC,updated_at DESC').map(w=>({...w,steps:JSON.parse(w.steps)}));
 const settings={};for(const x of all('SELECT key,value FROM settings'))try{settings[x.key]=JSON.parse(x.value);}catch{}
 const meetings=all("SELECT m.*,l.business,l.name FROM meetings m JOIN leads l ON m.lead_id=l.id ORDER BY m.start_at ASC LIMIT 100");
 const stats={profiles_analyzed:all('SELECT COUNT(*) as n FROM discoveries').reduce((a,x)=>a+x.n,0),qualified:leads.filter(l=>l.website_status==='NO_WEBSITE'&&l.phone).length,meetings:meetings.filter(x=>x.status==='SCHEDULED').length,found:leads.length,contacted:leads.filter(x=>x.stage!=='DISCOVERED').length,responded:leads.filter(x=>['REPLIED','INTERESTED','NO_INTEREST'].includes(x.stage)).length,interested:leads.filter(x=>x.stage==='INTERESTED').length,no_interest:leads.filter(x=>x.stage==='NO_INTEREST').length,without_site:leads.filter(x=>x.website_status==='NO_WEBSITE').length};
 return {providers:providerStatus(),stats,leads,threads,meetings,workflows,settings,media:all('SELECT * FROM media ORDER BY created_at DESC'),jobs:all('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 60'),discoveries:all('SELECT * FROM discoveries ORDER BY at DESC LIMIT 20'),connection:connection(),searchConfigured:!!process.env.BRAVE_SEARCH_API_KEY};
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
  const url=new URL(req.url,'http://localhost');
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
  if(req.method==='POST'&&pathname==='/api/workflows/default'){
   const v=await json(req);setDefaultWorkflow(v.id);notify();return respond(res,200,{ok:true});
  }
  if(req.method==='POST'&&pathname==='/api/settings'){
   const v=await json(req);
   for(const [k,value] of Object.entries(v)){
    if(!allowedSettings.has(k))throw Error('Configuração desconhecida: '+k);
    if(['min_minutes','daily_limit','business_start','business_end'].includes(k)&&(!Number.isInteger(Number(value))||Number(value)<0||Number(value)>10000))throw Error('Valor inválido');
    setSetting(k,value);
   }
   notify();return respond(res,200,{ok:true});
  }
  if(req.method==='POST'&&pathname.startsWith('/api/workflows/start/')){
   const leadId=pathname.split('/')[4];const runId=startWorkflow(leadId);drive(runId);notify();return respond(res,200,{executionId:runId});
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
   if(!['DISCOVERED','CONTACTED','REPLIED','INTERESTED','NO_INTEREST'].includes(v.stage))throw Error('Etapa inválida');
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
  if(req.method!=='GET')return respond(res,404,{error:'Rota inexistente'});
  const target=pathname==='/'?'index.html':pathname.slice(1);
  if(!['index.html','app.js','style.css'].includes(target))return respond(res,404,{error:'Arquivo inexistente'});
  const f=path.join(root,target),ext=path.extname(f);
  res.writeHead(200,{'Content-Type':web[ext]||'text/plain','Cache-Control':'no-cache'});fs.createReadStream(f).pipe(res);
 }catch(e){console.error('[API]',e?.message);error(res,e);}
}
const host='127.0.0.1',port=Number(process.env.PORT||3030);
const server=http.createServer(handler);
const interval=setInterval(()=>tick().catch(e=>console.error('[tick]',e.message)),2500);
server.listen(port,host,()=>console.log('Prospector: http://'+host+':'+port));
process.on('SIGINT',()=>{clearInterval(interval);server.close();process.exit(0);});
