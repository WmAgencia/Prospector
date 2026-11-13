// One-time owner-triggered activation of the approved TW&CO demo playbook.
// No outbound messages. The target is verified from live WA-AKG identity and
// the platform registry before touching any tenant-specific training data.
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {workerEnvironment} from './platform.mjs';
import {getExternalTenantInventory} from './tenant-live-whatsapp-audit.mjs';
import {getSetting,setSetting,now} from './db.mjs';
import {waRequest} from './waakg-control.mjs';
import {validNewTenantSessionId} from './tenant-gateway-policy.mjs';

export const OWNER_TW_DEMO_TRAINING_MARKER='owner_twco_demo_training_20261113_v1';
const live=x=>x?.status==='CONNECTED'&&x?.hasInstance===true&&Boolean(x?.me?.id||x?.me?.jid);
const num=x=>String(x?.me?.id||x?.me?.jid||'').split('@')[0].split(':')[0].replace(/\D/g,'');
export async function installTwDemoTraining({
 env=process.env,provider=waRequest,dataDir=env.PROSPECTOR_DATA_DIR||'data',
 getMarker=getSetting,setMarker=setSetting,
 runChild=null
}={}){
 if(env.RUN_TW_DEMO_TRAINING_ONCE!=='true'||env.PROSPECTOR_TENANT_ID)
  return {status:'NOT_ENABLED'};
 if(getMarker(OWNER_TW_DEMO_TRAINING_MARKER,null))return {status:'ALREADY_ATTEMPTED'};
 const inventory=getExternalTenantInventory(dataDir);
 const clients=inventory.tenants.filter(x=>x.status==='active');
 if(clients.length!==1||inventory.tenants.length!==1)return {status:'NOT_EXACTLY_ONE_ACTIVE_EXTERNAL_DEMO'};
 const sidList=clients[0].sessionIds;
 if(sidList.length!==1||!validNewTenantSessionId(sidList[0]))return {status:'TEST_SESSION_NOT_UNIQUE'};
 const sessionId=sidList[0];
 const dbFile=path.resolve(dataDir,'platform','clients',clients[0].id,'prospector.sqlite');
 if(!fs.existsSync(dbFile))return {status:'TENANT_DATABASE_NOT_FOUND'};
 const registryFile=path.resolve(dataDir,'platform','platform.sqlite');
 let registry;
 let client;
 try{
  registry=new DatabaseSync(registryFile,{readOnly:true});
  client=registry.prepare("SELECT id,name,secret,is_internal,status FROM clients WHERE id=?").get(clients[0].id);
 }catch{return {status:'DEMO_ACCOUNT_REGISTRY_UNAVAILABLE'};}
 finally{try{registry?.close()}catch{}}
 if(!client||client.is_internal!==0||client.status!=='active'||
  !/^Ag[eê]ncia Exemplo.*Demonstra[cç][aã]o$/i.test(String(client.name||'').trim()))
  return {status:'DEMO_ACCOUNT_IDENTITY_UNVERIFIED'};
 let source,target;
 try{
  [source,target]=await Promise.all([
   provider('/api/sessions/consecom-principal',{method:'GET'}),
   provider('/api/sessions/'+encodeURIComponent(sessionId),{method:'GET'})
  ]);
 }catch{return {status:'WHATSAPP_PROVIDER_UNAVAILABLE'};}
 const s=source?.data,t=target?.data;
 if(!live(s)||!live(t)||!/^55\d{10,11}$/.test(num(s))||
  !/^55\d{10,11}$/.test(num(t))||
  !num(s).endsWith('7336')||!num(t).endsWith('3900')||num(s)===num(t))
  return {status:'REAL_TEST_NUMBERS_NOT_VERIFIED'};
 // Do not overwrite somebody's actual, approved work or unfinished training.
 let reader;
 try{
  reader=new DatabaseSync(dbFile,{readOnly:true});
  const keys=reader.prepare("SELECT key,value FROM settings WHERE key IN ('training_active','training_draft')").all();
  if(keys.some(x=>x.value&&x.value!=='null'))return {status:'TRAINING_ALREADY_PRESENT_NO_OVERWRITE'};
 }catch{return {status:'DEMO_TENANT_READ_UNAVAILABLE'};}
 finally{try{reader?.close()}catch{}}
 // Reserve the attempt in durable owner settings before doing any writes.
 setMarker(OWNER_TW_DEMO_TRAINING_MARKER,{status:'ATTEMPTED',at:now(),clientSuffix:'3900'});
 const childEnv={...workerEnvironment(client,39991),TW_DEMO_TRAINING_MODE:'APPROVE',
  TW_DEMO_VERIFIED_SENDER_JID:num(s)+'@s.whatsapp.net',
  TW_DEMO_OWNED_SESSION_ID:sessionId};
 let result;
 if(runChild)result=await runChild(childEnv);
 else result=await new Promise((resolve)=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('./tw-demo-training-child.mjs',import.meta.url)),'--run'],
   {env:childEnv,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let out='',error='';
  child.stdout.on('data',x=>{out+=String(x).slice(0,4000)});
  child.stderr.on('data',x=>{error+=String(x).slice(0,500)});
  const kill=setTimeout(()=>child.kill('SIGKILL'),25000);
  child.on('close',code=>{
   clearTimeout(kill);
   const line=out.split('\n').find(x=>x.startsWith('TW_DEMO_TRAINING_RESULT='));
   try{
    const body=line?JSON.parse(line.slice('TW_DEMO_TRAINING_RESULT='.length)):null;
    resolve(code===0&&body?body:{status:'CHILD_APPROVAL_FAILED',reason:error.includes('TW_DEMO_TRAINING_ERROR=')?error.slice(0,145):'CHECK_CHILD_LOGS'});
   }catch{resolve({status:'CHILD_RESULT_INVALID'})}
  });
  child.on('error',()=>{clearTimeout(kill);resolve({status:'CHILD_START_FAILED'})});
 });
 return {...result,verifiedTargetSuffix:'3900',sourceSuffix:'7336',
  otherTenantsModified:0,liveMessagesSentByTraining:0};
}
