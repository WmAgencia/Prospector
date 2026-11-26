import test from 'node:test';
import assert from 'node:assert/strict';
import {assignVariant,selectProject,newExecution,reduceExecution} from '../dashboard/flow-engine.mjs';
const variants=['a','b','c','d'].map(id=>({id,weight:1,text:id}));
const def={steps:[{id:'first',kind:'text',variants},{id:'reply',kind:'reply'},{id:'permission',kind:'condition',condition:'permission'},{id:'wait',kind:'delay',seconds:10},{id:'video',kind:'video',variants:[{id:'v',weight:1}]},{id:'human',kind:'handoff'}]};
test('balanced alternatives, exact niche selection and conflict refusal',()=>{
 const counts={},sequence=[];
 for(let i=0;i<8;i++){const v=assignVariant(variants,counts);counts[v.id]=(counts[v.id]||0)+1;sequence.push(v.id);}
 assert.deepEqual(sequence,['a','b','c','d','a','b','c','d']);
 const weighted=[{id:'a',weight:3},{id:'b',weight:1}],distribution={};
 for(let i=0;i<40;i++){const v=assignVariant(weighted,distribution);distribution[v.id]=(distribution[v.id]||0)+1;}
 assert.deepEqual(distribution,{a:30,b:10});
 const p={id:'events',niche:'Eventos',enabled:true,publishedVersion:1};
 assert.equal(selectProject([p],' eventos ').id,'events');
 assert.equal(selectProject([p,{...p,id:'other'}],'Eventos'),null);
 assert.equal(selectProject([{...p,protected:true}],'Eventos'),null);
});
test('no advance without exact proof, explicit permission and completed wait',()=>{
 let e=newExecution(def);
 const apply=(event,at=0)=>{e=reduceExecution(def,e,event,{at});return e;};
 apply({type:'start'});
 assert.equal(e.assignments.first,'a');
 apply({type:'start'});assert.equal(e.history.length,1);
 apply({type:'accepted',providerId:'original'});
 apply({type:'proof',providerId:'different',status:'READ'});assert.equal(e.cursor,0);
 apply({type:'proof',providerId:'original',status:'SENT'});assert.equal(e.cursor,1);
 apply({type:'start'});
 apply({type:'inbound',id:'menu',automatic:true});assert.equal(e.cursor,1);
 apply({type:'inbound',id:'human-reply'});assert.equal(e.cursor,2);
 apply({type:'start'});
 apply({type:'inbound',id:'human-reply',intent:'permission'});assert.equal(e.cursor,2);
 apply({type:'inbound',id:'question',intent:'reply'});assert.equal(e.cursor,2);
 apply({type:'inbound',id:'yes',intent:'permission'},1000);assert.equal(e.cursor,3);
 apply({type:'start'},1000);apply({type:'tick'},10999);assert.equal(e.cursor,3);
 apply({type:'tick'},11000);assert.equal(e.cursor,4);
 apply({type:'start'},11000);apply({type:'accepted',providerId:'video-original'},11000);
 apply({type:'proof',providerId:'video-original',status:'DELIVERED'},11000);assert.equal(e.cursor,5);
 apply({type:'start'},11000);assert.equal(e.state,'HUMAN');
});
test('unknown receipt is never retried and optout terminates execution',()=>{
 let e=reduceExecution(def,newExecution(def),{type:'start'});
 e=reduceExecution(def,e,{type:'accepted'});assert.equal(e.state,'REVIEW');
 assert.equal(reduceExecution(def,e,{type:'start'}).state,'REVIEW');
 e=reduceExecution(def,newExecution(def),{type:'optout'});assert.equal(e.state,'CANCELLED');
});
