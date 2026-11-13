// Real Groq model evaluation of a single, verified TW&CO demo workspace.
// Uses tenant-local training files; never sends or changes WhatsApp messages.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {getSetting,setSetting,now} from './db.mjs';
import {getExternalTenantInventory} from './tenant-live-whatsapp-audit.mjs';
import {waRequest} from './waakg-control.mjs';
import {workerEnvironment} from './platform.mjs';

export const TW_MODEL_MARKER='owner_tw_model_read_only_20261113_v1';
const n=x=>String(x?.me?.id||x?.me?.jid||'').split('@')[0].split(':')[0].replace(/\D/g,'');
const connected=x=>x?.status==='CONNECTED'&&x?.hasInstance===true;
export async function runTwDemoModelAudit({
 env=process.env,provider=waRequest,dataDir=env.PROSPECTOR_DATA_DIR||'data',
 getMarker=getSetting,setMarker=setSetting,runChild=null
}={}){
 if(env.RUN_TW_DEMO_MODEL_DRYRUN_ONCE!=='true'||env.PROSPECTOR_TENANT_ID)return {status:'NOT_ENABLED'};
 if(getMarker(TW_MODEL_MARKER,null))return {status:'ALREADY_ATTEMPTED'};
 const inventory=getExternalTenantInventory(dataDir);
 const external=inventory.tenants.filter(x=>x.status==='active');
 if(external.length!==1||inventory.tenants.length!==1||external[0].sessionIds.length!==1)
  return {status:'DEMO_ACCOUNT_NOT_UNIQUE'};
 const sid=external[0].sessionIds[0];
 const folder=path.resolve(dataDir,'platform','clients',external[0].id);
 const dbFile=path.join(folder,'prospector.sqlite');
 let db,registry,client,approved,guard;
 try{
  db=new DatabaseSync(dbFile,{readOnly:true});
  const pick=key=>{const raw=db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
   try{return raw?JSON.parse(raw):null}catch{return null}};
  approved=pick('training_active');
  guard=pick('twco_demo_test_reply_guard_v1');
  registry=new DatabaseSync(path.resolve(dataDir,'platform','platform.sqlite'),{readOnly:true});
  client=registry.prepare('SELECT * FROM clients WHERE id=?').get(external[0].id);
 }catch{return {status:'DEMO_DATABASE_NOT_READABLE'};}
 finally{try{db?.close()}catch{}try{registry?.close()}catch{}}
 if(!client||client.is_internal!==0||client.status!=='active'||
  !/^Ag[eê]ncia Exemplo.*Demonstra[cç][aã]o$/i.test(client.name))
  return {status:'WRONG_CLIENT'};
 const content=path.join(folder,'training','francisca.md');
 if(!approved?.sha256||!fs.existsSync(content)||!fs.readFileSync(content,'utf8').includes('TW & CO Premium')||
  guard?.enabled!==true||guard.sessionId!==sid)
  return {status:'TRAINING_OR_GUARD_MISSING'};
 let source,target;
 try{[source,target]=await Promise.all([
  provider('/api/sessions/consecom-principal',{method:'GET'}),
  provider('/api/sessions/'+encodeURIComponent(sid),{method:'GET'})]);}
 catch{return {status:'GATEWAY_READ_FAILED'};}
 const sn=n(source?.data),tn=n(target?.data);
 if(!connected(source?.data)||!connected(target?.data)||!sn.endsWith('7336')||
  !tn.endsWith('3900')||guard.senderJid!==sn+'@s.whatsapp.net')
  return {status:'LIVE_IDENTITY_MISMATCH'};
 setMarker(TW_MODEL_MARKER,{attemptedAt:now(),purpose:'TW_DEMO_DRYRUN_ONLY'});
 const childEnv={...workerEnvironment(client,39992),TW_DEMO_OWNED_SESSION_ID:sid,TW_DEMO_VERIFIED_SENDER_JID:guard.senderJid};
 if(runChild)return {...await runChild(childEnv),workspaceVerified:true};
 const response=await new Promise(resolve=>{
  const ch=spawn(process.execPath,[fileURLToPath(new URL('./tw-demo-model-dryrun.mjs',import.meta.url)),'--run'],
   {env:childEnv,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let out='',err='';
  ch.stdout.on('data',v=>{out+=v.toString().slice(0,12000)});
  ch.stderr.on('data',v=>{err+=v.toString().slice(0,500)});
  const timeout=setTimeout(()=>ch.kill('SIGKILL'),150000);
  ch.on('close',code=>{
   clearTimeout(timeout);
   const data=out.split('\n').find(x=>x.startsWith('TW_DEMO_MODEL_RESULT='));
   try{resolve(code===0&&data?JSON.parse(data.slice('TW_DEMO_MODEL_RESULT='.length)):
    {status:'MODEL_CHILD_FAILED',reason:err.slice(0,120)})}
   catch{resolve({status:'MODEL_OUTPUT_INVALID'})}
  });
  ch.on('error',()=>{clearTimeout(timeout);resolve({status:'MODEL_CHILD_START_FAILED'})});
 });
 return {...response,workspaceVerified:true,whatsappSends:0};
}
