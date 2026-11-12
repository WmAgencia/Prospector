import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-private-group-'));
process.env.PROSPECTOR_DATA_DIR=directory;
process.env.PROSPECTOR_TENANT_ID='tenant-private-group-test';
delete process.env.PROSPECTOR_DEMO_MODE;
const db=await import('../dashboard/db.mjs');
const {reconcilePrivateGroup,privateGroupState,PROSPECTOR_GROUP_NAME}=await import('../dashboard/prospector-private-group.mjs');
const owner='5515999990000',second='5515999991111',third='5515999992222';
const jid='120363023333333333@g.us';
const session=(id,number)=>({sessionId:id,number,connected:true});
const pool=items=>async()=>({items});
const connected=[session('prospector-first',owner)];
function group(numbers,extra={}){
 return {jid,subject:PROSPECTOR_GROUP_NAME,participants:numbers.map(number=>({id:number+'@s.whatsapp.net'})),...extra};
}
const date=value=>new Date('2026-11-07T'+value+'Z');
test.beforeEach(()=>{
 db.run('DELETE FROM prospector_group_invite_attempt');
 db.run('DELETE FROM prospector_owner_group');
});
test('waits for an authenticated WA-AKG WhatsApp, not merely tenant registration',async()=>{
 let called=0;
 const result=await reconcilePrivateGroup({getSessions:pool([]),request:async()=>{called++;},at:date('12:00:00')});
 assert.equal(result.state,'WAITING_WHATSAPP');
 assert.equal(called,0);
 assert.equal(privateGroupState(),null);
});
test('first connected WhatsApp creates a group with zero invited members',async()=>{
 const calls=[];
 const result=await reconcilePrivateGroup({getSessions:pool(connected),at:date('12:00:00'),request:async(url,options)=>{
  calls.push({url,options});
  return {status:true,data:{group:{id:jid}}};
 }});
 assert.equal(result.state,'CREATED');
 const create=calls.filter(x=>x.options?.method==='POST');
 assert.equal(create.length,1);
 assert.equal(create[0].url,'/api/groups/prospector-first/create');
 assert.deepEqual(create[0].options.data,{subject:'Meu Prospector',participants:[]});
 assert.equal(privateGroupState().group_jid,jid);
});
test('second number joins the SAME group, without creating a second group',async()=>{
 let countCreate=0,countInvite=0;
 const ownerPool=pool(connected);
 const initial=async(url)=>{
  if(url.endsWith('/create')){countCreate++;return {status:true,data:{group:{id:jid}}};}
  return {status:true,data:[]};
 };
 assert.equal((await reconcilePrivateGroup({getSessions:ownerPool,request:initial,at:date('12:00:00')})).state,'CREATED');
 const both=pool([...connected,session('prospector-second',second)]);
 const request=async(url,options)=>{
  if(url.endsWith('/create')){countCreate++;throw Error('A second group must not be created');}
  if(options?.method==='PUT'){
   countInvite++;
   assert.equal(url,'/api/groups/prospector-first/'+encodeURIComponent(jid)+'/members');
   assert.deepEqual(options.data,{action:'add',participants:[second+'@s.whatsapp.net']});
   return {success:true,result:[{status:'200'}]};
  }
  return url.endsWith(encodeURIComponent(jid))?group([owner]):{status:true,data:[group([owner])]};
 };
 const result=await reconcilePrivateGroup({getSessions:both,request,at:date('12:01:00')});
 assert.equal(result.state,'MEMBERSHIP_PENDING');
 assert.equal(countCreate,1);
 assert.equal(countInvite,1);
 const confirmed=await reconcilePrivateGroup({getSessions:both,request:async(url,options)=>{
  if(options)throw Error('No duplicate membership request');
  return url.endsWith(encodeURIComponent(jid))?group([owner,second]):{status:true,data:[group([owner,second])]};
 },at:date('12:02:00')});
 assert.equal(confirmed.state,'READY');
 assert.equal(confirmed.members,2);
 assert.equal(countCreate,1);
 assert.equal(countInvite,1);
});
test('both WhatsApps online at first run: create empty, then add second using owner',async()=>{
 const both=pool([...connected,session('prospector-second',second)]);
 const calls=[];
 const api=async(url,opts)=>{
  calls.push({url,opts});
  if(opts?.method==='POST')return {status:true,data:{group:{id:jid}}};
  if(opts?.method==='PUT')return {success:true,result:[{status:'200'}]};
  return opts?.method?group([owner]):url.endsWith(encodeURIComponent(jid))?group([owner]):{status:true,data:[]};
 };
 const created=await reconcilePrivateGroup({getSessions:both,request:api,at:date('12:00:00')});
 assert.equal(created.state,'CREATED');
 assert.deepEqual(calls.find(x=>x.opts?.method==='POST').opts.data.participants,[]);
 const synced=await reconcilePrivateGroup({getSessions:both,request:api,at:date('12:01:00')});
 assert.equal(synced.state,'MEMBERSHIP_PENDING');
 assert.deepEqual(calls.find(x=>x.opts?.method==='PUT').opts.data.participants,[second+'@s.whatsapp.net']);
 assert.equal(calls.filter(x=>x.opts?.method==='POST').length,1);
});
test('imports a verified known live group even when the provider list is stale',async()=>{
 const priorInternal=process.env.PROSPECTOR_TENANT_INTERNAL;
 const priorImport=process.env.PROSPECTOR_GROUP_IMPORT_JID;
 process.env.PROSPECTOR_TENANT_INTERNAL='true';
 process.env.PROSPECTOR_GROUP_IMPORT_JID=jid;
 let createCalls=0,readCalls=0;
 try{
  const response=await reconcilePrivateGroup({
   getSessions:pool([...connected,session('prospector-second',second)]),
   request:async(url,options)=>{
    if(options?.method==='POST'){createCalls++;throw Error('Must not create second group');}
    readCalls++;
    if(url.endsWith(encodeURIComponent(jid)))return group([owner,second]);
    return {status:true,data:[]};
   },at:date('12:00:00')
  });
  assert.equal(response.state,'RECOVERED');
  assert.equal(response.members,2);
  assert.equal(privateGroupState().group_jid,jid);
  assert.equal(createCalls,0);
  assert.equal(readCalls,1);
 }finally{
  if(priorInternal===undefined)delete process.env.PROSPECTOR_TENANT_INTERNAL;
  else process.env.PROSPECTOR_TENANT_INTERNAL=priorInternal;
  if(priorImport===undefined)delete process.env.PROSPECTOR_GROUP_IMPORT_JID;
  else process.env.PROSPECTOR_GROUP_IMPORT_JID=priorImport;
 }
});
test('recognizes one already existing and verified group without creating a duplicate',async()=>{
 const both=pool([...connected,session('prospector-second',second)]);
 let creates=0;
 const request=async(url,opts)=>{
  if(opts?.method==='POST'){creates++;throw Error('duplicate group creation');}
  return url.endsWith(encodeURIComponent(jid))?group([owner,second]):{status:true,data:[group([owner,second])]};
 };
 const result=await reconcilePrivateGroup({getSessions:both,request,at:date('12:00:00')});
 assert.equal(result.state,'RECOVERED');
 assert.equal(privateGroupState().group_jid,jid);
 assert.equal(result.members,2);
 const confirmed=await reconcilePrivateGroup({getSessions:both,request,at:date('12:01:00')});
 assert.equal(confirmed.state,'READY');
 assert.equal(creates,0);
});
test('temporary gateway rejection is retried with zero invited members after cooldown',async()=>{
 let create=0;
 const request=async(url,options)=>{
  if(options?.method==='POST'){
   create++;
   assert.deepEqual(options.data.participants,[]);
   if(create===1)throw Error('WA-AKG HTTP 500: temporary error');
   return {status:true,data:{group:{id:jid}}};
  }
  return {status:true,data:[]};
 };
 const first=await reconcilePrivateGroup({getSessions:pool(connected),request,at:date('12:00:00')});
 assert.equal(first.state,'CREATION_RETRY');
 const soon=await reconcilePrivateGroup({getSessions:pool(connected),request,at:date('12:01:00')});
 assert.equal(soon.state,'CREATION_RETRY');
 const later=await reconcilePrivateGroup({getSessions:pool(connected),request,at:date('12:04:00')});
 assert.equal(later.state,'CREATED');
 assert.equal(create,2);
});
test('uncertain create may recover only a matching group containing owned numbers',async()=>{
 let create=0;
 const request=async(url,options)=>{
  if(options?.method==='POST'){create++;throw Error('WA-AKG timeout');}
  return {status:true,data:create?[group([owner])]:[]};
 };
 assert.equal((await reconcilePrivateGroup({getSessions:pool(connected),request,at:date('12:00:00')})).state,'CREATION_RETRY');
 const recovered=await reconcilePrivateGroup({getSessions:pool(connected),request,at:date('12:04:00')});
 assert.equal(recovered.state,'RECOVERED');
 assert.equal(create,1);
 assert.equal(privateGroupState().group_jid,jid);
});
test('does not adopt unrelated same-name groups or add unknown people',async()=>{
 let create=0;
 const request=async(url,options)=>{
  if(options?.method==='POST'){create++;throw Error('WA-AKG error');}
  return url.endsWith(encodeURIComponent(jid))?group([owner,'5515999994444']):{status:true,data:[group([owner,'5515999994444'])]};
 };
 await reconcilePrivateGroup({getSessions:pool(connected),request,at:date('12:00:00')});
 const next=await reconcilePrivateGroup({getSessions:pool(connected),request,at:date('12:04:00')});
 assert.equal(next.state,'GROUP_MATCH_AMBIGUOUS');
 assert.equal(privateGroupState(),null);
 assert.equal(create,0);
});
test('an existing group with an unknown member is blocked from further updates',async()=>{
 let created=false;
 const request=async(url,opts)=>{
  if(opts?.method==='POST'){created=true;return {status:true,data:{group:{id:jid}}};}
  return created?(url.endsWith(encodeURIComponent(jid))?group([owner,'5515999994444']):{status:true,data:[group([owner,'5515999994444'])]}):{status:true,data:[]};
 };
 await reconcilePrivateGroup({getSessions:pool(connected),request,at:date('12:00:00')});
 const result=await reconcilePrivateGroup({
  getSessions:pool([...connected,session('prospector-second',second)]),
  request:async(url,options)=>{
   if(options)throw Error('No unauthorized group edit');
   return request(url);
  },at:date('12:04:00')
 });
 assert.equal(result.state,'UNEXPECTED_GROUP_MEMBER');
});
test('disconnect/reconnect of owner does not lead to another group creation',async()=>{
 let create=0;
 const request=async(url,opts)=>{
  if(opts?.method==='POST'){create++;return {status:true,data:{group:{id:jid}}};}
  return create?(url.endsWith(encodeURIComponent(jid))?group([owner]):{status:true,data:[group([owner])]}):{status:true,data:[]};
 };
 await reconcilePrivateGroup({getSessions:pool(connected),request,at:date('12:00:00')});
 const disconnected=await reconcilePrivateGroup({getSessions:pool([session('prospector-second',second)]),request,at:date('12:01:00')});
 assert.equal(disconnected.state,'WAITING_OWNER_WHATSAPP');
 assert.equal(create,1);
});
test('Consecom master recovers known real group even when group list is empty',async()=>{
 const oldTenant=process.env.PROSPECTOR_TENANT_ID;
 const oldImport=process.env.PROSPECTOR_GROUP_IMPORT_JID;
 const oldInternal=process.env.PROSPECTOR_TENANT_INTERNAL;
 delete process.env.PROSPECTOR_TENANT_ID;delete process.env.PROSPECTOR_TENANT_INTERNAL;
 process.env.PROSPECTOR_GROUP_IMPORT_JID=jid;
 let creates=0,reads=0;
 try{
  const r=await reconcilePrivateGroup({
   getSessions:pool([...connected,session('prospector-second',second)]),
   request:async(url,opts)=>{
    if(opts?.method==='POST'){creates++;throw Error('Must not create duplicate');}
    reads++;return url.endsWith(encodeURIComponent(jid))?group([owner,second]):{status:true,data:[]};
   },at:date('12:00:00')
  });
  assert.equal(r.state,'RECOVERED');
  assert.equal(r.members,2);
  assert.equal(privateGroupState().group_jid,jid);
  assert.equal(creates,0);
  assert.equal(reads,1);
 }finally{
  if(oldTenant===undefined)delete process.env.PROSPECTOR_TENANT_ID;else process.env.PROSPECTOR_TENANT_ID=oldTenant;
  if(oldImport===undefined)delete process.env.PROSPECTOR_GROUP_IMPORT_JID;else process.env.PROSPECTOR_GROUP_IMPORT_JID=oldImport;
  if(oldInternal===undefined)delete process.env.PROSPECTOR_TENANT_INTERNAL;else process.env.PROSPECTOR_TENANT_INTERNAL=oldInternal;
 }
});
test('each tenant must have an authenticated scope; master/demo do not create groups',async()=>{
 const previous=process.env.PROSPECTOR_TENANT_ID;
 delete process.env.PROSPECTOR_TENANT_ID;
 let calls=0;
 try{
  const x=await reconcilePrivateGroup({getSessions:async()=>{calls++;return {items:connected};},at:date('12:00:00')});
  assert.equal(x.state,'DISABLED');assert.equal(calls,0);
 }finally{process.env.PROSPECTOR_TENANT_ID=previous;}
});
test.after(()=>{db.db.close();fs.rmSync(directory,{recursive:true,force:true});});
