import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../dashboard/public/simple-app.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../dashboard/public/simple-app.css',import.meta.url),'utf8');

function createHarness({mapsConfigured=false,previewReady=0}={}){
 const fetches=[];
 const listeners={};
 let pendingSubmit=null;
 const sendButton={disabled:false};
 const sendForm={requestSubmit(){pendingSubmit=listeners.submit({target:{id:'send-form'},preventDefault(){}});return pendingSubmit;}};
 const root={innerHTML:''},viewEl={innerHTML:''};
 const notice={textContent:'',classList:{toggle(){}},setAttribute(){}};
 const field={value:'',focus(){},selectionStart:0,setSelectionRange(){}};
 const city={value:'',focus(){}};
 const composer={value:'',focus(){}};
 const waLabel={value:'Comercial extra'};
 const document={
  hidden:false,
  addEventListener(name,cb){listeners[name]=cb;},
  querySelector(sel){
   if(sel==='#app')return root;
   if(sel==='#view')return viewEl;
   if(sel==='#notice')return notice;
   if(sel==='#niche')return field;
   if(sel==='#city')return city;
   if(sel==='#chat-text')return composer;
   if(sel==='#new-wa-label')return waLabel;
   if(sel==='#send-form')return sendForm;
   if(sel==='#send-form button[type="submit"]')return sendButton;
   return null;
  }
 };
 const leads=[{id:'11111111-1111-4111-8111-111111111111',business:'Oficina Real de Itu',city:'Itu',segment:'Oficina',source:'osm',stage:'DISCOVERED',phone:'5515999999999'}];
 const state={leads,threads:[],settings:{paused:true,discovery_auto_enabled:false},stats:{found:1}};
 const base={total:1,uncontacted:1,contacted:0,returned:1,results:[{...leads[0],contacted:false,selectable:true,maps_url:'https://www.google.com/maps/search/?api=1&query=Oficina',instagram_url:'https://www.instagram.com/oficina.teste/',manual_contact_url:'https://wa.me/5515999999999?text=Ol%C3%A1'}],partial:false};
 const fetch=async (url,opts={})=>{
  const route=String(url);fetches.push({route,method:opts.method||'GET',body:opts.body?JSON.parse(opts.body):null});
  let data={};
  if(route==='/api/state')data=state;
  else if(route==='/api/kanban')data={counts:{approaching:1,no_interest:1,interested:1,conversing:1},columns:{
    approaching:[{id:'test1',business:'Oficina Em Abordagem',phone:'5515999888877',city:'Sorocaba',noResponse:true}],
    no_interest:[{id:'test2',business:'Oficina Sem Interesse',phone:'5515999888876',city:'Sorocaba',blocked:false,nextEligibleAt:'2027-02-01T00:00:00Z'}],
    interested:[{id:'test3',business:'Oficina Interessada',phone:'5515999888875',city:'Sorocaba'}],
    conversing:[{id:'test4',business:'Oficina Em Conversa',phone:'5515999888874',city:'Sorocaba'}]}};
  else if(route.startsWith('/api/prospecting?'))data=base;
  else if(route==='/api/maps/status')data={configured:mapsConfigured,jobs:[]};
  else if(route==='/api/prospecting/queue'&&opts.method!=='POST')data={active:false,waiting:0,intervalSeconds:90};
  else if(route==='/api/whatsapp/sessions'&&opts.method==='POST')data={sessionId:'pool-extra',label:'Comercial extra'};
  else if(route==='/api/whatsapp/connect')data={ok:true,sessionId:'pool-extra'};
  else if(route==='/api/whatsapp/sessions')data={items:[{session_id:'pool-main',label:'Principal',connected:true,status:'CONNECTED'},{session_id:'pool-extra',label:'Comercial extra',connected:false,status:'SCAN_QR'}]};
  else if(route==='/api/whatsapp/status')data={ok:true,connected:false,status:'DISCONNECTED'};
  else if(route.startsWith('/api/whatsapp/status?'))data={ok:true,connected:false,status:'SCAN_QR',hasSession:true};
  else if(route.startsWith('/api/whatsapp/qr?'))data={connected:false,status:'SCAN_QR',qr:'data:image/png;base64,AAAA'};
  else if(route==='/api/prospecting/search')data={ok:true,source:'OpenStreetMap',added:2};
  else if(route==='/api/ai/draft')data={ok:true,draft:'Claro! Posso explicar melhor?',profile:{profileLabel:'Quer entender os detalhes',nextAction:'Explicar de modo simples',confidence:'moderate'},requiresApproval:true,autoSend:false};
  else if(route.startsWith('/api/whatsapp/interactive-preview'))data={ok:true,mode:'introduction',title:'Consecom Brasil',body:'Gostaria de conhecer nossa proposta?',buttons:[{displayText:'Quero saber mais'},{displayText:'Ver um exemplo'},{displayText:'Falar com alguém'}]};
  else if(route==='/api/prospecting/approach-preview')data={ok:true,selected:1,ready:previewReady,items:[]};
  else if(route==='/api/prospecting/queue'&&opts.method==='POST')data={ok:true,queued:1,excluded:0};
  else if(route.startsWith('/api/maps/job?'))data={id:'sample-id',status:'COMPLETED'};
  else if(route==='/api/maps/import')data={added:3};
  else if(route==='/api/maps/search')data={id:'sample-id',status:'PENDING',niche:'oficinas mecânicas',city:'Sorocaba'};
  else if(route==='/api/ai/status')data={configured:false};
  else if(route==='/api/whatsapp/handoff'&&opts.method==='POST')data={ok:true,chatId:JSON.parse(opts.body).chatId,manualTakeover:JSON.parse(opts.body).manual,canTakeover:true,canDeliverToAi:true,reason:'READY'};
  else if(route.startsWith('/api/whatsapp/handoff?'))data={chatId:'wa:5515999992222@s.whatsapp.net',manualTakeover:true,canTakeover:true,canDeliverToAi:true,reason:'READY'};
  else if(route==='/api/whatsapp/reply-remote')data={ok:true,delivery:'ACCEPTED'};
  else if(route.startsWith('/api/whatsapp/chat-messages?'))data=[{direction:'in',body:'Olá, como funciona?',at:'2026-10-30T12:00:00.000Z'}];
  else if(route==='/api/threads/thread-test/messages')data=[];
  else if(route==='/api/threads/thread-test/read')data={ok:true};
  else return {ok:false,status:404,json:async()=>({error:'unknown route '+route})};
  return {ok:true,status:200,json:async()=>data};
 };
 const context=vm.createContext({
  document,window:{addEventListener(){}},location:{hash:'#/prospects'},
  fetch,URL,URLSearchParams,console,confirm:()=>false,
  setInterval:()=>1,clearInterval(){},Date,crypto:{randomUUID:()=> 'mock'},
 });
 // Runtime starts after the top-level await only in the actual browser.
 const source=app.slice(0,app.lastIndexOf('\nawait reload();'));
 assert.notEqual(source,app,'expected app boot sequence was not found');
 vm.runInContext(source,context,{filename:'simple-app.js',timeout:2500});
 return {context,root,viewEl,notice,field,city,composer,fetches,listeners,sendForm,sendButton,getPendingSubmit:()=>pendingSubmit};
}

test('Prospecting shows configured automatic scope and a month of real calendar slots',async()=>{
 const h=createHarness();
 await vm.runInContext('reload()',h.context);
 vm.runInContext("scopeInfo={selection:{mode:'all',enabled:false},options:{cities:['Sorocaba'],segments:[{id:'oficina',label:'Oficinas'}],coverage:'Cobertura limitada'}};prospectCalendar={days:[{date:'2026-11-05',approachedCount:2,closedCount:1,conversionRate:50,approached:[{business:'Oficina A',city:'Sorocaba'}],closed:[{business:'Oficina B',city:'Sorocaba'}]}],totals:{approached:2,closed:1}};calendarMonth='2026-11';render();",h.context);
 assert.match(h.viewEl.innerHTML,/scope-form/);
 assert.match(h.viewEl.innerHTML,/calendar-days-grid/);
 assert.match(h.viewEl.innerHTML,/scope-toggle-niche/);
 assert.match(h.viewEl.innerHTML,/scope-toggle-city/);
 assert.match(h.viewEl.innerHTML,/Brasil inteiro/);
 assert.match(h.viewEl.innerHTML,/data-kind="approached"/);
 assert.match(h.viewEl.innerHTML,/data-kind="closed"/);
 assert.doesNotMatch(h.viewEl.innerHTML,/Empresas não abordadas|Pesquisar empresas/);
 assert.ok(!h.fetches.some(x=>x.method==='POST'),'opening the page must not trigger searches or WhatsApp sends');
});
test('Monthly calendar opens company list for approached or closed categories',async()=>{
 const h=createHarness();await vm.runInContext('reload()',h.context);
 vm.runInContext("prospectCalendar={days:[{date:'2026-11-05',approachedCount:1,closedCount:1,conversionRate:100,approached:[{business:'Empresa Abordada',city:'Sorocaba'}],closed:[{business:'Empresa Fechada',city:'Itu'}]}],totals:{approached:1,closed:1}};calendarMonth='2026-11';view='prospects';render();",h.context);
 await h.listeners.click({target:{closest:()=>({dataset:{action:'calendar-day',date:'2026-11-05',kind:'approached'}})}});
 assert.match(h.viewEl.innerHTML,/Empresa Abordada/);
 await h.listeners.click({target:{closest:()=>({dataset:{action:'calendar-day',date:'2026-11-05',kind:'closed'}})}});
 assert.match(h.viewEl.innerHTML,/Empresa Fechada/);
});
test('Named WhatsApp channels use QR modal instead of wide connection panel',async()=>{
 const h=createHarness();await vm.runInContext('reload()',h.context);
 vm.runInContext("view='connections';waAccounts=[{session_id:'pool-extra',label:'Comercial extra',connected:false,status:'SCAN_QR',numberSuffix:''}];connectionSession='pool-extra';waModalOpen=true;qrResult={qr:'data:image/png;base64,AAAA'};wa={connected:false,status:'SCAN_QR'};render()",h.context);
 assert.match(h.viewEl.innerHTML,/Seus WhatsApps/);
 assert.match(h.viewEl.innerHTML,/Comercial extra/);
 assert.match(h.viewEl.innerHTML,/wa-modal-backdrop/);
 assert.match(h.viewEl.innerHTML,/qr-image/);
 assert.doesNotMatch(h.viewEl.innerHTML,/INTEGRAÇÃO WHATSAPP/);
});
test('WhatsApp-like chat keeps exactly one handoff and composer',async()=>{
 const h=createHarness();await vm.runInContext('reload()',h.context);
 vm.runInContext("view='conversations';remoteChats=[{id:'wa:5515999992222@s.whatsapp.net',name:'Contato Teste',phone:'5515999992222',handoff:{manualTakeover:false,canTakeover:true,canDeliverToAi:true,reason:'READY'}}];selectedThread='wa:5515999992222@s.whatsapp.net';render()",h.context);
 assert.match(h.viewEl.innerHTML,/data-action="toggle-chat-handoff"/);
 assert.match(h.viewEl.innerHTML,/Assumir conversa/);
 assert.match(h.viewEl.innerHTML,/id="send-form"/);
 assert.match(h.viewEl.innerHTML,/id="chat-text"/);
 assert.doesNotMatch(h.viewEl.innerHTML,/data-action="suggest-groq"|data-action="show-options"/);
});
test('Human / IA toggle still makes authorized server handoff requests',async()=>{
 const h=createHarness();await vm.runInContext('reload()',h.context);
 vm.runInContext("view='conversations';remoteChats=[{id:'wa:5515999992222@s.whatsapp.net',name:'Contato',phone:'5515999992222',handoff:{manualTakeover:false,canTakeover:true,canDeliverToAi:true}}];selectedThread='wa:5515999992222@s.whatsapp.net';render()",h.context);
 const target={dataset:{action:'toggle-chat-handoff'}};
 await h.listeners.click({target:{closest:()=>target}});
 assert.ok(h.fetches.some(f=>f.route==='/api/whatsapp/handoff'&&f.method==='POST'&&f.body.manual===true));
});
test('Owner chat cannot be assigned to customer AI',async()=>{
 const h=createHarness();await vm.runInContext('reload()',h.context);
 vm.runInContext("view='conversations';remoteChats=[{id:'wa:5515981817336@s.whatsapp.net',name:'Proprietário',phone:'5515981817336',handoff:{manualTakeover:false,canTakeover:false,canDeliverToAi:false,reason:'OWNER_PRIVATE'}}];selectedThread='wa:5515981817336@s.whatsapp.net';render()",h.context);
 assert.match(h.viewEl.innerHTML,/data-action="toggle-chat-handoff" disabled/);
 assert.match(h.viewEl.innerHTML,/O proprietário utiliza um canal especial/);
});
test('Kanban remains read-only and shows four existing pipeline columns',async()=>{
 const h=createHarness();await vm.runInContext("view='overview';reload()",h.context);
 for(const title of ['Abordando','Sem interesse','Interessados','Conversando'])assert.match(h.viewEl.innerHTML,new RegExp(title));
 assert.match(h.viewEl.innerHTML,/Oficina Interessada/);
 assert.ok(!h.fetches.some(x=>x.method==='POST'));
});
test('Chat composer sends Enter once through the existing WhatsApp endpoint',async()=>{
 const h=createHarness();await vm.runInContext('reload()',h.context);
 vm.runInContext("view='conversations';remoteChats=[{id:'wa:5515999992222@s.whatsapp.net',name:'Contato',phone:'5515999992222',handoff:{manualTakeover:false,canTakeover:true,canDeliverToAi:true}}];selectedThread='wa:5515999992222@s.whatsapp.net';render()",h.context);
 h.composer.value='Mensagem com Enter';
 let prevented=0;
 h.listeners.keydown({target:{id:'chat-text'},key:'Enter',isComposing:false,preventDefault(){prevented++;}});
 await h.getPendingSubmit();
 assert.equal(prevented,1);
 const sends=h.fetches.filter(x=>x.route==='/api/whatsapp/reply-remote'&&x.method==='POST');
 assert.equal(sends.length,1);
 assert.equal(sends[0].body.text,'Mensagem com Enter');
});
