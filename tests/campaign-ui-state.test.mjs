import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignStatus,campaignPreview} from '../dashboard/public/campaign-ui-state.mjs';
import {buildConsecomSteps} from '../dashboard/consecom-flow.mjs';
const steps=buildConsecomSteps({audioId:'existing-audio',videoId:'existing-video'});
const wf={id:'abc',name:'Campanha ativa',enabled:true,steps};
test('active campaign card is read-only and describes real operation state',()=>{
 const paused=campaignStatus({workflow:wf,activeId:'abc',settings:{paused:true},connection:{status:'CONNECTED'}});
 assert.equal(paused.active,true);assert.equal(paused.running,false);assert.equal(paused.canActivate,false);
 assert.match(paused.label,/pausada/);
 const running=campaignStatus({workflow:wf,activeId:'abc',settings:{paused:false,auto_initial:true},connection:{status:'CONNECTED'}});
 assert.equal(running.running,true);
 const disconnected=campaignStatus({workflow:wf,activeId:'abc',settings:{paused:false,auto_initial:true},connection:{status:'DISCONNECTED'}});
 assert.equal(disconnected.running,false);
});
test('saved campaign not selected is available for activation, incomplete drafts are not',()=>{
 const inactive=campaignStatus({workflow:wf,activeId:'another-id'});
 assert.equal(inactive.canActivate,true);
 const blank=campaignStatus({workflow:{...wf,id:'draft',steps:buildConsecomSteps({})},activeId:'abc'});
 assert.equal(blank.canActivate,false);
 assert.equal(blank.state,'draft');
});
test('cards display actual timing and video captions',()=>{
 const p=campaignPreview(steps);
 assert.equal(p.waitBeforeAudio,45);
 assert.equal(p.waitBeforeVideo,10);
 assert.equal(p.caption,'O que achou? Gostaria de ter um assim também?');
 assert.equal(p.handover,true);
 assert.equal(p.hasAudio,true);
 assert.equal(p.hasVideo,true);
});
