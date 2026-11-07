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
test('first connected WhatsApp attempts a self-only group without adding unrelated numbers',async()=>{
 const calls=[];
 const result=await reconcilePrivateGroup({getSessions:pool(connected),at:date('12:00:00'),request:async(url,options)=>{
  calls.push({url,options});
  return {status:true,data:{group:{id:jid}}};
 }});
 assert.equal(result.state,'CREATED');
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'/api/groups/prospector-first/create');
 assert.deepEqual(calls[0].options.data,{subject:'Meu Prospector',participants:[owner+'@s.whatsapp.net']});
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
  return {status:true,data:[group([owner])]};
 };
 const result=await reconcilePrivateGroup({getSessions:both,request,at:date('12:01:00')});
 assert.equal(result.state,'MEMBERSHIP_PENDING');
 assert.equal(countCreate,1);
 assert.equal(countInvite,1);
 const confirmed=await reconcilePrivateGroup({getSessions:both,request:async(url,options)=>{
  if(options)throw Error('No duplicate membership request');
  return {status:true,data:[group([owner,second])]};
 },at:date('12:02:00')});
 assert.equal(confirmed.state,'READY');
 assert.equal(confirmed.members,2);
 assert.equal(countCreate,1);
 assert.equal(countInvite,1);
});
test('when self-only creation is rejected, waits for another *owned* connected number',async()=>{
 let create=0;
 const request=async(url,options)=>{
  if(options?.method==='POST'){
   create++;
   if(create===1)throw Error('WA-AKG HTTP 500: Failed to create group');
   assert.deepEqual(options.data.participants,[second+'@s.whatsapp.net']);
   return {status:true,data:{group:{id:jid}}};
  }
  return {status:true,data:[]};
 };
 const first=await reconcilePrivateGroup({getSessions:pool(connected),request,at:date('12:00:00')});
 assert.equal(first.state,'WAITING_SECOND');
 const soon=await reconcilePrivateGroup({getSessions:pool(connected),request,at:date('12:01:00')});
 assert.equal(soon.state,'WAITING_SECOND');
 const later=await reconcilePrivateGroup({getSessions:pool(connected),request,at:date('12:04:00')});
 assert.equal(later.state,'WAITING_SECOND');
 assert.equal(create,1);
 const joined=await reconcilePrivateGroup({getSessions:pool([...connected,session('prospector-second',second)]),request,at:date('12:05:00')});
 assert.equal(joined.state,'CREATED');
 assert.equal(create,2);
});
test('uncertain create may recover only a matching group containing owned numbers',async()=>{
 let create=0;
 const request=async(url,options)=>{
  if(options?.method==='POST'){create++;throw Error('WA-AKG timeout');}
  return {status:true,data:create?[group([owner])]:[]};
 };
 assert.equal((await reconcilePrivateGroup({getSessions:pool(connected),request,at:date('12:00:00')})).state,'WAITING_SECOND');
 const recovered=await reconcilePrivateGroup({getSessions:pool(connected),request,at:date('12:04:00')});
 assert.equal(recovered.state,'RECOVERED');
 assert.equal(create,1);
 assert.equal(privateGroupState().group_jid,jid);
});
test('does not adopt unrelated same-name groups or add unknown people',async()=>{
 let create=0;
 const request=async(url,options)=>{
  if(options?.method==='POST'){create++;throw Error('WA-AKG error');}
  return {status:true,data:[group([owner,'5515999994444'])]};
 };
 await reconcilePrivateGroup({getSessions:pool(connected),request,at:date('12:00:00')});
 const next=await reconcilePrivateGroup({getSessions:pool(connected),request,at:date('12:04:00')});
 assert.equal(next.state,'WAITING_SECOND');
 assert.equal(privateGroupState().group_jid,null);
 assert.equal(create,1);
});
test('an existing group with an unknown member is blocked from further updates',async()=>{
 const request=async(url,opts)=>{
  if(opts?.method==='POST')return {status:true,data:{group:{id:jid}}};
  return {status:true,data:[group([owner,'5515999994444'])]};
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
  return {status:true,data:[group([owner])]};
 };
 await reconcilePrivateGroup({getSessions:pool(connected),request,at:date('12:00:00')});
 const disconnected=await reconcilePrivateGroup({getSessions:pool([session('prospector-second',second)]),request,at:date('12:01:00')});
 assert.equal(disconnected.state,'WAITING_OWNER_WHATSAPP');
 assert.equal(create,1);
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
