import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';

const dir=fs.mkdtempSync(os.tmpdir()+'/prospector-buttons-');
process.env.PROSPECTOR_DATA_DIR=dir;
const db=await import('../dashboard/db.mjs');
const {interactivePreview,withinInboundWindow,sendApprovedInteractive}=await import('../dashboard/waakg-interactive.mjs');

const jid='5515999992222@s.whatsapp.net';
const recent=()=>[{direction:'in',body:'Pode me explicar melhor?',at:new Date().toISOString()}];
const stub=(messages=recent(),transport=async()=>({status:true}))=>({
 getStatus:async()=>({connected:true,sessionId:'consecom-principal'}),
 getMessages:async()=>messages,
 transmit:transport
});
test('Approved quick replies have 3 distinct bounded buttons and no transmission',()=>{
 const p=interactivePreview({mode:'introduction'});
 assert.equal(p.buttons.length,3);
 assert.equal(new Set(p.buttons.map(x=>x.id)).size,3);
 assert.ok(p.buttons.every(b=>b.type==='quick_reply'&&b.displayText.length<=20));
 assert.equal(p.autoSent,false);
 assert.throws(()=>interactivePreview({mode:'unauthorized'}),/inválido/);
 assert.equal(db.one('SELECT COUNT(*) AS n FROM waakg_interactive_outbox').n,0);
});
test('Timestamp parser respects the active 24-hour service window',()=>{
 const current=Date.parse('2026-10-29T15:00:00Z');
 assert.equal(withinInboundWindow('2026-10-29T14:59:00Z',current),true);
 assert.equal(withinInboundWindow('2026-10-28T14:58:00Z',current),false);
 assert.equal(withinInboundWindow(Math.floor(current/1000)-120,current),true);
 assert.equal(withinInboundWindow(null,current),false);
});
test('Interactive send rejects absent explicit approval, outbound only and opt-out',async()=>{
 const id='11111111-1111-4111-8111-111111111111';
 assert.equal((await sendApprovedInteractive({jid,requestId:id,approve:false},stub())).status,400);
 assert.equal((await sendApprovedInteractive({jid,requestId:id,approve:true},stub([{direction:'out',body:'Olá!',at:new Date().toISOString()}]))).status,403);
 assert.equal((await sendApprovedInteractive({jid,requestId:id,approve:true},stub([{direction:'in',body:'Não quero mais mensagens',at:new Date().toISOString()}]))).status,403);
 assert.equal((await sendApprovedInteractive({jid,requestId:id,approve:true},stub([{direction:'in',body:'Oi',at:'2020-01-01T00:00:00Z'}]))).status,403);
 assert.equal(db.one('SELECT COUNT(*) AS n FROM waakg_interactive_outbox').n,0);
});
test('Operator-approved message uses WA-AKG interactive endpoint and cannot be duplicated',async()=>{
 const id='22222222-2222-4222-8222-222222222222';
 let path=null,data=null,calls=0;
 const deps=stub(recent(),async(p,args)=>{calls++;path=p;data=args.data;return {status:true}});
 const success=await sendApprovedInteractive({jid,requestId:id,approve:true,mode:'introduction'},deps);
 assert.equal(success.status,200);
 assert.equal(success.body.delivery,'UNVERIFIED');
 assert.equal(calls,1);
 assert.match(path,/\/interactive$/);
 assert.equal(data.buttons.length,3);
 assert.equal(data.body,interactivePreview().body);
 assert.equal(db.one('SELECT state FROM waakg_interactive_outbox WHERE id=?',id).state,'ACCEPTED');
 const again=await sendApprovedInteractive({jid,requestId:id,approve:true},deps);
 assert.equal(again.status,409);
 assert.equal(calls,1);
 assert.equal(db.one('SELECT COUNT(*) AS n FROM messages').n,1);
});
test('Timeout creates UNKNOWN state to prevent double sends',async()=>{
 const id='33333333-3333-4333-8333-333333333333';
 const deps=stub(recent(),async()=>{throw Error('timeout');});
 const first=await sendApprovedInteractive({jid,requestId:id,approve:true},deps);
 assert.equal(first.status,502);
 assert.equal(db.one('SELECT state FROM waakg_interactive_outbox WHERE id=?',id).state,'UNKNOWN');
 const next=await sendApprovedInteractive({jid,requestId:id,approve:true},deps);
 assert.equal(next.status,409);
});
test.after(()=>{db.db.close();fs.rmSync(dir,{recursive:true,force:true});});
