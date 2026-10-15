import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
const handlers={};const inner={innerHTML:''};
globalThis.location={hash:'#/workflows'};
globalThis.crypto=webcrypto;
globalThis.document={getElementById:id=>id==='campaign-app'?inner:null,addEventListener:(name,fn)=>{handlers['document:'+name]=fn;}};
globalThis.window={addEventListener:(name,fn)=>{handlers['window:'+name]=fn;}};
const workflow={
 id:'live-123',name:'Consecom · Oferta de site R$350',enabled:true,segments:[],
 steps:[
 {type:'message',text:'{{greeting}} Olá, pode receber nossa apresentação?'},
 {type:'wait_reply'},
 {type:'delay',seconds:45},
 {type:'audio',media_id:'audio-stored',description:'Apresentação do Wesley'},
 {type:'delay',seconds:10},
 {type:'video',media_id:'video-stored',caption:'O que achou? Gostaria de ter um assim também?'},
 {type:'wait_reply'},
 {type:'decision',context:'website_interest',yes_action:'handover',no_action:'end',no_text:'Obrigado pelo retorno'},
 {type:'end'}
 ]
};
const state={workflows:[workflow],settings:{paused:true,auto_initial:true,autonomous_campaign_id:workflow.id},media:[],connection:{status:'CONNECTED'},bridge:{state:'READY'}};
globalThis.fetch=async()=>({ok:true,json:async()=>state});
await import('../dashboard/public/campaign-ui.mjs');
test('campaign manager draws a compact selected-campaign card without editable active fields',async()=>{
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(inner.innerHTML,/Suas campanhas, em um só lugar/);
 assert.match(inner.innerHTML,/Consecom · Oferta de site R\$350/);
 assert.match(inner.innerHTML,/Selecionada · operação pausada/);
 assert.match(inner.innerHTML,/Ver etapas da campanha/);
 assert.match(inner.innerHTML,/Criar uma cópia editável/);
 assert.ok(!inner.innerHTML.includes('data-cm-field="message"'));
});
test('the operator can see alternative saved campaigns on the left',()=>{
 const alt={...workflow,id:'alternate',name:'Outra campanha',enabled:false};
 const updated={...state,workflows:[workflow,alt]};
 handlers['window:prospector:draw']({detail:{page:'workflows',state:updated}});
 assert.match(inner.innerHTML,/Outra campanha/);
 assert.match(inner.innerHTML,/data-cm="select"/);
 assert.match(inner.innerHTML,/data-cm="new"/);
});
test('the manager does not render over unrelated pages',()=>{
 location.hash='#/overview';
 const old=inner.innerHTML;
 handlers['window:prospector:draw']({detail:{page:'overview',state}});
 assert.equal(inner.innerHTML,old);
});