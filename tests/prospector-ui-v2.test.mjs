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
  else if(route==='/api/whatsapp/status')data={ok:true,connected:false,status:'DISCONNECTED'};
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
 const source=app.replace(/await reload\(\);\s*await refreshWa\(\);\s*$/,'');
 assert.notEqual(source,app,'expected app boot sequence was not found');
 vm.runInContext(source,context,{filename:'simple-app.js',timeout:2500});
 return {context,root,viewEl,notice,field,city,composer,fetches,listeners,sendForm,sendButton,getPendingSubmit:()=>pendingSubmit};
}

test('Prospecção starts with no hidden city/niche filter and displays existing leads',async()=>{
 const h=createHarness();
 await vm.runInContext('reload()',h.context);
 assert.match(h.viewEl.innerHTML,/Oficina Real de Itu/);
 assert.match(h.viewEl.innerHTML,/Empresas não abordadas/);
 assert.match(h.viewEl.innerHTML,/Pesquisar empresas/);
 assert.ok(h.fetches.some(f=>f.route.startsWith('/api/prospecting?niche=&city=&status=uncontacted&session=')),'default must show only unapproached leads');
 assert.ok(!h.fetches.some(f=>f.method==='POST'),'opening the tab must not trigger provider calls or messaging');
 assert.match(h.root.innerHTML,/data-tab="prospects"/);
 assert.match(h.root.innerHTML,/data-tab="connections"/);
});
test('clicking Abordar is the approval and does not require a second browser confirmation',async()=>{
 const h=createHarness({previewReady:1});await vm.runInContext('reload()',h.context);
 vm.runInContext("selectedLeadIds.add('11111111-1111-4111-8111-111111111111');confirm=()=>{throw Error('Redundant confirmation')}",h.context);
 await h.listeners.click({target:{closest:()=>({dataset:{action:'approach-selected'}})}});
 assert.ok(h.fetches.some(f=>f.route==='/api/prospecting/queue'&&f.method==='POST'));
});

test('Main search explicitly uses OSM when Google Maps is not configured',async()=>{
 const h=createHarness();
 await vm.runInContext('reload()',h.context);
 h.field.value='oficinas mecânicas';h.city.value='Sorocaba';
 const submit=h.listeners.submit;
 assert.equal(typeof submit,'function');
 await submit({target:{id:'search-form'},preventDefault(){}});
 assert.ok(h.fetches.some(f=>f.route==='/api/prospecting/search'&&f.method==='POST'));
 assert.ok(!h.fetches.some(f=>f.route==='/api/maps/search'));
 assert.ok(!h.fetches.some(f=>f.route.includes('/api/whatsapp/reply')));
});

test('Navigation preserves safety and accommodates mobile, form focus and reduced motion',()=>{
 const h=createHarness();
 assert.match(css,/@media\(max-width:700px\)/);
 assert.match(css,/@media\(max-width:940px\)/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/focus-visible/);
 assert.match(app,/document\.hidden\|\|busy\|\|q\("input:focus,textarea:focus,select:focus"\)/);
 assert.match(app,/confirm\("Importar as empresas desta pesquisa/);
 assert.match(app,/prospectFilter="uncontacted"/);
 assert.match(h.root.innerHTML,/^$/);
});

test('Every workspace section renders without a runtime exception',async()=>{
 const h=createHarness();
 await vm.runInContext('reload()',h.context);
 const expected={
  overview:'Kanban de oportunidades',
  conversations:'Suas conversas',
  prospects:'Empresas não abordadas',
  connections:'INTEGRAÇÃO WHATSAPP',
  settings:'PREFERÊNCIAS'
 };
 for(const [name,content] of Object.entries(expected)){
  vm.runInContext('view='+JSON.stringify(name)+';render()',h.context);
  assert.match(h.viewEl.innerHTML,new RegExp(content),'failed to render '+name);
 }
});

test('Selectable leads show Maps and Instagram; explicit selection only creates previews',async()=>{
 const h=createHarness();
 await vm.runInContext('reload()',h.context);
 assert.match(h.viewEl.innerHTML,/data-select-lead=/);
 assert.match(h.viewEl.innerHTML,/Maps ↗/);
 assert.match(h.viewEl.innerHTML,/Instagram ↗/);
 assert.match(h.viewEl.innerHTML,/WhatsApp manual ↗/);
 assert.ok(h.viewEl.innerHTML.includes('https://wa.me/5515999999999?text='));
 const hit={dataset:{action:'toggle-all'},closest:()=>null};
 await h.listeners.click({target:{closest:()=>hit}});
 assert.match(h.viewEl.innerHTML,/1 selecionada/);
 assert.match(h.viewEl.innerHTML,/Desmarcar todas/);
 await h.listeners.click({target:{closest:()=>hit}});
 assert.match(h.viewEl.innerHTML,/0 selecionadas/);
 assert.match(h.viewEl.innerHTML,/Selecionar todas/);
 assert.ok(!h.fetches.some(x=>x.method==='POST'),'selection must not call outbound API');
});

test('Conversations have exactly one human/AI handoff in header and one simple input/send form',async()=>{
 const h=createHarness();
 await vm.runInContext('reload()',h.context);
 vm.runInContext("view='conversations';remoteChats=[{id:'wa:5515999992222@s.whatsapp.net',name:'Contato teste',phone:'5515999992222',contactRole:'INBOUND_NEW',handoff:{manualTakeover:false,canTakeover:true,canDeliverToAi:true,reason:'READY'}}];selectedThread='wa:5515999992222@s.whatsapp.net';messages=[{direction:'in',body:'Tudo bem?'}];render()",h.context);
 assert.match(h.viewEl.innerHTML,/data-action="toggle-chat-handoff"/);
 assert.match(h.viewEl.innerHTML,/Assumir conversa/);
 assert.match(h.viewEl.innerHTML,/id="chat-text"/);
 assert.match(h.viewEl.innerHTML,/id="send-form"/);
 assert.match(h.viewEl.innerHTML,/type="submit">Enviar/);
 assert.doesNotMatch(h.viewEl.innerHTML,/data-action="suggest-groq"|data-action="show-options"|data-action="voice-preview"|data-action="voice-send"/);
 assert.doesNotMatch(h.viewEl.innerHTML,/under-chat|Groq · Perfil comercial|Revisar mensagem interativa|WhatsApp offline/);
 assert.match(css,/\.chat-panel \.composer\{display:flex;flex-wrap:nowrap/);
});
test('Header action toggles human and IA ownership with a server-side request',async()=>{
 const h=createHarness();
 await vm.runInContext('reload()',h.context);
 vm.runInContext("view='conversations';remoteChats=[{id:'wa:5515999992222@s.whatsapp.net',name:'Cliente Teste',phone:'5515999992222',handoff:{manualTakeover:false,canTakeover:true,canDeliverToAi:true,reason:'READY'}}];selectedThread='wa:5515999992222@s.whatsapp.net';render()",h.context);
 const hit={dataset:{action:'toggle-chat-handoff'}};
 await h.listeners.click({target:{closest:()=>hit}});
 assert.match(h.viewEl.innerHTML,/Entregar para IA/);
 assert.ok(h.fetches.some(x=>x.route==='/api/whatsapp/handoff'&&x.method==='POST'&&x.body.manual===true));
 await h.listeners.click({target:{closest:()=>hit}});
 assert.match(h.viewEl.innerHTML,/Assumir conversa/);
 assert.ok(h.fetches.some(x=>x.route==='/api/whatsapp/handoff'&&x.method==='POST'&&x.body.manual===false));
});
test('Pressing Enter in the composer sends a message exactly once',async()=>{
 const h=createHarness();
 await vm.runInContext('reload()',h.context);
 vm.runInContext("view='conversations';remoteChats=[{id:'wa:5515999992222@s.whatsapp.net',name:'Contato Teste',phone:'5515999992222',handoff:{manualTakeover:false,canTakeover:true,canDeliverToAi:true,reason:'READY'}}];selectedThread='wa:5515999992222@s.whatsapp.net';render()",h.context);
 h.composer.value='Mensagem com Enter';
 let prevented=0;
 h.listeners.keydown({target:{id:'chat-text'},key:'Enter',isComposing:false,preventDefault(){prevented++;}});
 await h.getPendingSubmit();
 assert.equal(prevented,1);
 const sends=h.fetches.filter(x=>x.route==='/api/whatsapp/reply-remote'&&x.method==='POST');
 assert.equal(sends.length,1);
 assert.equal(sends[0].body.text,'Mensagem com Enter');
 assert.equal(h.composer.value,'');
 assert.ok(h.fetches.some(x=>x.route.startsWith('/api/whatsapp/handoff?')&&x.method==='GET'));
});
test('Owner chat is displayed without promising an unsupported handoff to customer AI',async()=>{
 const h=createHarness();
 await vm.runInContext('reload()',h.context);
 vm.runInContext("view='conversations';remoteChats=[{id:'wa:5515981817336@s.whatsapp.net',name:'Proprietário',phone:'5515981817336',handoff:{manualTakeover:false,canTakeover:false,canDeliverToAi:false,reason:'OWNER_PRIVATE'}}];selectedThread='wa:5515981817336@s.whatsapp.net';render()",h.context);
 assert.match(h.viewEl.innerHTML,/data-action="toggle-chat-handoff" disabled/);
 assert.match(h.viewEl.innerHTML,/Assumir conversa/);
 assert.match(h.viewEl.innerHTML,/O proprietário utiliza um canal especial/);
});
test('Home shows compact four-column Kanban with verified hot leads and operator conversation actions',async()=>{
 const h=createHarness();
 await vm.runInContext("view='overview';reload()",h.context);
 assert.match(h.viewEl.innerHTML,/Kanban de oportunidades/);
 for(const title of ['Abordando','Sem interesse','Interessados','Conversando'])assert.match(h.viewEl.innerHTML,new RegExp(title));
 assert.match(h.viewEl.innerHTML,/Oficina Interessada/);
 assert.match(h.viewEl.innerHTML,/Enviar mensagem/);
 assert.match(css,/\.body:has\(\.kanban-dashboard\).*height:100dvh/);
 assert.match(css,/\.kanban-column-items\{[^}]*overflow-y:auto/);
 assert.ok(!h.fetches.some(x=>x.method==='POST'),'Board is read-only, never sends WhatsApp');
});

test('Configured Google Maps is the main search, imports completed results and never sends messages',async()=>{
 const h=createHarness({mapsConfigured:true});await vm.runInContext('reload()',h.context);
 vm.runInContext("selectedLeadIds.add('previous-city-selection')",h.context);
 h.field.value='oficinas';h.city.value='Sorocaba';
 await h.listeners.submit({target:{id:'search-form'},preventDefault(){}});
 assert.equal(vm.runInContext('selectedLeadIds.size',h.context),0,'a new city search must not retain old selected recipients');
 assert.ok(h.fetches.some(f=>f.route==='/api/maps/search'&&f.method==='POST'));
 assert.ok(h.fetches.some(f=>f.route==='/api/maps/import'&&f.method==='POST'));
 assert.ok(!h.fetches.some(f=>f.route==='/api/prospecting/search'));
 assert.ok(!h.fetches.some(f=>f.route.includes('/api/whatsapp/reply')));
 assert.match(h.viewEl.innerHTML,/Google Maps: IMPORTED/);
});
