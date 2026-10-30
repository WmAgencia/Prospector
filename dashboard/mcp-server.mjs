import {enqueueApprovedApproaches,approachQueueStatus,cancelApproachQueue} from './prospecting-queue.mjs';
import {ENABLED,RESOURCE,SITE,SCOPES,random,hash,eq,validScope,checkClient,registerClient,putCode,exchangeCode,refresh,verifyBearer} from './mcp-oauth-store.mjs';
import {all,one,getSetting} from './db.mjs';
import {prepareApproaches} from './prospecting-approach.mjs';
const pending=new Map();
const versions=['2025-11-25','2025-06-18'];
const tools=[
 {name:'prospector_enqueue',description:'Explicitly approve queueing up to 20 selected documented opt-ins for actual delivery by the existing worker; consent, suppression, interval and unknown-delivery guards remain enforced.',inputSchema:{type:'object',properties:{leadIds:{type:'array',items:{type:'string'},minItems:1,maxItems:20},approve:{const:true}},required:['leadIds','approve'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}},
 {name:'prospector_queue',description:'Read aggregate outreach queue status.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'prospector_cancel',description:'Cancel remaining queued outreach. Already sending or uncertain deliveries remain unchanged. Requires explicit approval.',inputSchema:{type:'object',properties:{approve:{const:true}},required:['approve'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}},
 {name:'prospector_status',description:'Read bounded aggregate status; never sends messages.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'prospector_prospects',description:'Read up to 50 prospects without phone numbers or private conversation content.',inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:50}},additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'prospector_prepare',description:'Preview up to 20 selected prospects using existing documented consent checks. Does not queue or send. Operator approval remains required in dashboard.',inputSchema:{type:'object',properties:{leadIds:{type:'array',items:{type:'string'},minItems:1,maxItems:20}},required:['leadIds'],additionalProperties:false},annotations:{readOnlyHint:true}}
];
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let text='';for await(const c of req){text+=c;if(Buffer.byteLength(text)>16384)throw Error('invalid_request');}return text;}
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function cookie(req){return String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('ps_mcp_approval='))?.slice(16)||'';}
export async function handleMcp(req,res,url,{authorized=()=>false}={}){
 const p=url.pathname;if(!(p==='/mcp'||p.startsWith('/oauth/')||p.startsWith('/.well-known/oauth-')))return false;
 if(!ENABLED){send(res,404,{error:'MCP is disabled'});return true;}
 try{
 if(req.headers.origin&&req.headers.origin!==SITE){send(res,403,{error:'invalid_origin'});return true;}
 if(req.method==='GET'&&['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'].includes(p)){send(res,200,{resource:RESOURCE,authorization_servers:[SITE],scopes_supported:SCOPES,bearer_methods_supported:['header']});return true;}
 if(req.method==='GET'&&p==='/.well-known/oauth-authorization-server'){send(res,200,{issuer:SITE,authorization_endpoint:SITE+'/oauth/authorize',token_endpoint:SITE+'/oauth/token',registration_endpoint:SITE+'/oauth/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:SCOPES});return true;}
 if(req.method==='POST'&&p==='/oauth/register'){send(res,201,registerClient(JSON.parse(await body(req))));return true;}
 if(req.method==='POST'&&p==='/oauth/token'){
  if(!String(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded')){send(res,415,{error:'invalid_request'});return true;}
  const data=Object.fromEntries(new URLSearchParams(await body(req)));const result=data.grant_type==='authorization_code'?exchangeCode(data):data.grant_type==='refresh_token'?refresh(data):null;send(res,result?200:400,result||{error:'invalid_grant'});return true;
 }
 if(req.method==='GET'&&p==='/oauth/authorize'){
  if(!authorized(req)){send(res,401,{error:'Open the dashboard private access link, then retry authorization.'});return true;}
  const q=Object.fromEntries(url.searchParams);if(q.response_type!=='code'||!checkClient(q.client_id,q.redirect_uri)||q.resource!==RESOURCE||q.code_challenge_method!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge||'')||!validScope(q.scope)||!q.state||q.state.length>1024)throw Error('invalid_request');
  for(const [key,value] of pending)if(value.expires<Date.now())pending.delete(key);
  if(pending.size>=1000){send(res,429,{error:'temporarily_unavailable'});return true;}
  const nonce=random(),binding=random();pending.set(hash(nonce),{q,binding:hash(binding),expires:Date.now()+300000});
  res.setHeader('Set-Cookie','ps_mcp_approval='+binding+'; HttpOnly; Secure; SameSite=Strict; Path=/oauth; Max-Age=300');
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});
  res.end('<!doctype html><meta charset="utf-8"><title>Authorize Prospector</title><h1>Authorize MCP client</h1><p>Client: '+escape(q.client_id)+'</p><p>Scopes: '+escape(q.scope)+'</p><p>'+ (q.scope.split(' ').includes('prospector:outreach')?'Outreach access: this client may explicitly approve selected documented opt-ins for queueing and actual sending, inspect the queue, and cancel pending items.':'Read and preview only. No messages will be sent.') +'</p><form action="/oauth/approve" method="post"><input type="hidden" name="nonce" value="'+nonce+'"><button name="decision" value="approve">Authorize</button><button name="decision" value="deny">Deny</button></form>');return true;
 }
 if(req.method==='POST'&&p==='/oauth/approve'){
  if(!authorized(req)||req.headers.origin!==SITE){send(res,403,{error:'access_denied'});return true;}
  const data=Object.fromEntries(new URLSearchParams(await body(req))),key=hash(data.nonce),grant=pending.get(key);
  if(!grant||grant.expires<Date.now()||!eq(grant.binding,hash(cookie(req)))){send(res,403,{error:'invalid_approval'});return true;}
  pending.delete(key);const q=grant.q,target=new URL(q.redirect_uri);target.searchParams.set('state',q.state);
  if(data.decision==='approve')target.searchParams.set('code',putCode({client:q.client_id,redirect:q.redirect_uri,challenge:q.code_challenge,scope:q.scope}));else target.searchParams.set('error','access_denied');
  res.writeHead(302,{Location:target.href,'Cache-Control':'no-store'});res.end();return true;
 }
 if(p==='/mcp'){
  const token=verifyBearer(req);if(!token){res.setHeader('WWW-Authenticate','Bearer resource_metadata="'+SITE+'/.well-known/oauth-protected-resource/mcp", scope="prospector:read"');send(res,401,{error:'invalid_token'});return true;}
  if(req.method!=='POST'){res.setHeader('Allow','POST');send(res,405,{error:'Method not allowed'});return true;}
  if(!String(req.headers.accept||'').includes('application/json')||!String(req.headers.accept||'').includes('text/event-stream')){send(res,406,{error:'Accept must include application/json and text/event-stream'});return true;}
  if(!String(req.headers['content-type']||'').startsWith('application/json')){send(res,415,{error:'Content-Type must be application/json'});return true;}
  const rpc=JSON.parse(await body(req));if(!rpc||Array.isArray(rpc)||rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string')throw Error('invalid_request');
  const version=req.headers['mcp-protocol-version']||'2025-06-18';if(!versions.includes(version)){send(res,400,{error:'Unsupported MCP protocol version'});return true;}
  res.setHeader('MCP-Protocol-Version',version);
  if(rpc.id===undefined){res.writeHead(202);res.end();return true;}
  const result=value=>send(res,200,{jsonrpc:'2.0',id:rpc.id,result:value});
  const failure=(code,message)=>send(res,200,{jsonrpc:'2.0',id:rpc.id,error:{code,message}});
  if(rpc.method==='initialize'){result({protocolVersion:versions.includes(rpc.params?.protocolVersion)?rpc.params.protocolVersion:versions[0],capabilities:{tools:{listChanged:false}},serverInfo:{name:'prospector',version:'1.0.0'},instructions:token.scope.split(' ').includes('prospector:outreach')?'Outreach enabled: explicit approve=true and selected documented opt-ins are required to queue actual sends. Never invent consent.':'Read and preview only. Outreach requires separate prospector:outreach authorization.'});return true;}
  if(rpc.method==='ping'){result({});return true;}
  const requiredScope=t=>['prospector_enqueue','prospector_queue','prospector_cancel'].includes(t.name)?'prospector:outreach':t.name==='prospector_prepare'?'prospector:prepare':'prospector:read';
  const scopes=token.scope.split(' '),allowed=t=>scopes.includes(requiredScope(t));
  if(rpc.method==='tools/list'){result({tools:tools.filter(allowed)});return true;}
  if(rpc.method==='tools/call'){
   const tool=tools.find(t=>t.name===rpc.params?.name);if(!tool){failure(-32602,'Unknown tool');return true;}
   if(!allowed(tool)){res.setHeader('WWW-Authenticate','Bearer error="insufficient_scope", scope="'+requiredScope(tool)+'"');send(res,403,{error:'insufficient_scope'});return true;}
   const args=rpc.params.arguments||{};let value;
   if(typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(tool.inputSchema.properties,k))){failure(-32602,'Invalid arguments');return true;}
   if(['prospector_enqueue','prospector_prepare'].includes(tool.name)&&(!Array.isArray(args.leadIds)||args.leadIds.length<1||args.leadIds.length>20||args.leadIds.some(v=>typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)))){failure(-32602,'Select 1 to 20 valid UUID leadIds');return true;}
   if(['prospector_enqueue','prospector_cancel'].includes(tool.name)&&args.approve!==true){failure(-32602,'Explicit approve=true is required');return true;}
   if(tool.name==='prospector_queue')value=approachQueueStatus();
   if(tool.name==='prospector_cancel')value=cancelApproachQueue();
   if(tool.name==='prospector_enqueue'){const queued=enqueueApprovedApproaches(args);if(queued.status!==202){result({isError:true,content:[{type:'text',text:JSON.stringify(queued.body)}]});return true;}value=queued.body;}
   if(tool.name==='prospector_status')value={paused:getSetting('paused',true),leads:one('SELECT count(*) count FROM leads').count,jobs:all('SELECT status,count(*) count FROM jobs GROUP BY status')};
   if(tool.name==='prospector_prospects'){const limit=args.limit??20;if(!Number.isInteger(limit)||limit<1||limit>50){failure(-32602,'Invalid limit');return true;}value=all('SELECT id,business,city,segment,stage,website_status FROM leads ORDER BY created_at DESC LIMIT ?',limit);}
   if(tool.name==='prospector_prepare'){if(!Array.isArray(args.leadIds)||args.leadIds.length>20){failure(-32602,'Select 1 to 20 leadIds');return true;}value=prepareApproaches(args);value.items=value.items.map(({manualUrl,...item})=>item);}
   result({content:[{type:'text',text:JSON.stringify(value)}]});return true;
  }
  failure(-32601,'Method not found');return true;
 }
 send(res,404,{error:'Not found'});return true;
 }catch{send(res,400,{error:'invalid_request'});return true;}
}

