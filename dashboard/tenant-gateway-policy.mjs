// The shared WA-AKG API is reachable by a *trusted parent process* only.
// Tenant workers may request narrowly scoped session operations via the broker.
const safeSession=id=>/^prospector-[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
const safeJid=jid=>/^\d{10,15}@s\.whatsapp\.net$/.test(jid);
const safeMedia=path=>/^\/api\/media\/([A-Za-z0-9_-]{3,140})\.(?:mp3|m4a|mp4|ogg|opus|wav|webm)$/i.exec(path);
export const TENANT_GATEWAY_BROKER_PATH='/api/internal/tenant-gateway';
export const BROKER_MEDIA_MAX_BYTES=15*1024*1024;
export function classifyTenantGatewayRequest(method,rawPath){
 const requestMethod=String(method||'').toUpperCase();
 if(!['GET','POST'].includes(requestMethod)||typeof rawPath!=='string'||rawPath.length>500||rawPath.includes('?')||rawPath.includes('#')||rawPath.includes('\\')||rawPath.includes('..'))return null;
 let path;try{path=decodeURIComponent(rawPath);}catch{return null;}
 if(!/^\/api\/[A-Za-z0-9_@./-]+$/.test(path))return null;
 if(requestMethod==='GET'&&path==='/api/sessions')return {kind:'list',sessionId:null,media:false};
 if(requestMethod==='POST'&&path==='/api/sessions')return {kind:'create',sessionId:null,media:false};
 let m=path.match(/^\/api\/sessions\/([^/]+)(?:\/(qr|start|restart|logout|bot-config))?$/);
 if(m&&safeSession(m[1])&&(
   (requestMethod==='GET'&&(!m[2]||m[2]==='qr'))||
   (requestMethod==='POST'&&['start','restart','logout','bot-config'].includes(m[2]))
 ))return {kind:m[2]||'session',sessionId:m[1],media:false};
 m=path.match(/^\/api\/webhooks\/([^/]+)$/);
 if(m&&safeSession(m[1])&&['GET','POST'].includes(requestMethod))return {kind:'webhook',sessionId:m[1],media:false};
 m=path.match(/^\/api\/chat\/([^/]+)(?:\/([^/]+))?$/);
 if(m&&requestMethod==='GET'&&safeSession(m[1])&&(!m[2]||safeJid(m[2])))return {kind:'chat',sessionId:m[1],media:false};
 m=path.match(/^\/api\/messages\/([^/]+)\/([^/]+)\/(send|media|interactive)$/);
 if(m&&requestMethod==='POST'&&safeSession(m[1])&&safeJid(m[2]))return {kind:m[3],sessionId:m[1],media:m[3]==='media'};
 if(requestMethod==='GET'){
  const file=safeMedia(path),name=file?.[1];
  if(name){const match=name.match(/^(prospector-[a-f0-9-]{36})-/i);
   if(match&&safeSession(match[1]))return {kind:'download',sessionId:match[1],media:true};
  }
 }
 return null;
}
export const validNewTenantSessionId=safeSession;
export function validateBrokerPostBody({kind,body,tenantId,secret}){
 if(kind==='create'){
  return Boolean(body&&validNewTenantSessionId(body.sessionId)&&
   typeof body.name==='string'&&body.name.trim().length>=1&&body.name.length<=70);
 }
 if(kind==='webhook'){
  const expected='https://prospector-operacional-production.up.railway.app/api/wa-akg/webhook?tenant='+encodeURIComponent(tenantId);
  return Boolean(body&&body.url===expected&&body.secret===secret&&Array.isArray(body.events)&&body.events.length===3&&
   ['message.received','message.sent','connection.update'].every(x=>body.events.includes(x)));
 }
 if(kind==='bot-config'){
  return Boolean(body&&body.botMode==='SPECIFIC'&&body.autoReplyMode==='SPECIFIC'&&
   Array.isArray(body.botAllowedJids)&&body.botAllowedJids.length===0&&
   Array.isArray(body.autoReplyAllowedJids)&&body.autoReplyAllowedJids.length===0);
 }
 return true;
}
