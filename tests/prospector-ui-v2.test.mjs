import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../dashboard/public/simple-app.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../dashboard/public/simple-app.css',import.meta.url),'utf8');

function createHarness(){
 const fetches=[];
 const listeners={};
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
   return null;
  }
 };
 const leads=[{id:'11111111-1111-4111-8111-111111111111',business:'Oficina Real de Itu',city:'Itu',segment:'Oficina',source:'osm',stage:'DISCOVERED',phone:'5515999999999'}];
 const state={leads,threads:[],settings:{paused:true,discovery_auto_enabled:false},stats:{found:1}};
 const base={total:1,uncontacted:1,contacted:0,returned:1,results:[{...leads[0],contacted:false,selectable:true,maps_url:'https://www.google.com/maps/search/?api=1&query=Oficina',instagram_url:'https://www.instagram.com/oficina.teste/'}],partial:false};
 const fetch=async (url,opts={})=>{
  const route=String(url);fetches.push({route,method:opts.method||'GET'});
  let data={};
  if(route==='/api/state')data=state;
  else if(route==='/api/kanban')data={counts:{approaching:1,no_interest:1,interested:1,conversing:1},columns:{
    approaching:[{id:'test1',business:'Oficina Em Abordagem',phone:'5515999888877',city:'Sorocaba',noResponse:true}],
    no_interest:[{id:'test2',business:'Oficina Sem Interesse',phone:'5515999888876',city:'Sorocaba',blocked:false,nextEligibleAt:'2027-02-01T00:00:00Z'}],
    interested:[{id:'test3',business:'Oficina Interessada',phone:'5515999888875',city:'Sorocaba'}],
    conversing:[{id:'test4',business:'Oficina Em Conversa',phone:'5515999888874',city:'Sorocaba'}]}};
  else if(route.startsWith('/api/prospecting?'))data=base;
  else if(route==='/api/maps/status')data={jobs:[]};
  else if(route==='/api/prospecting/queue')data={active:false,waiting:0,intervalSeconds:90};
  else if(route==='/api/whatsapp/status')data={ok:true,connected:false,status:'DISCONNECTED'};
  else if(route==='/api/prospecting/search')data={ok:true,source:'OpenStreetMap',added:2};
  else if(route==='/api/ai/draft')data={ok:true,draft:'Claro! Posso explicar melhor?',profile:{profileLabel:'Quer entender os detalhes',nextAction:'Explicar de modo simples',confidence:'moderate'},requiresApproval:true,autoSend:false};
  else if(route.startsWith('/api/whatsapp/interactive-preview'))data={ok:true,mode:'introduction',title:'Consecom Brasil',body:'Gostaria de conhecer nossa proposta?',buttons:[{displayText:'Quero saber mais'},{displayText:'Ver um exemplo'},{displayText:'Falar com alguém'}]};
  else if(route==='/api/prospecting/approach-preview')data={ok:true,selected:1,greeting:'boa tarde',message:'Olá, boa tarde, como vai?',ready:0,items:[{id:leads[0].id,business:leads[0].business,phoneSuffix:'9999',status:'NEEDS_PERMISSION',authorized:false}]};
  else if(route==='/api/maps/search')data={id:'sample-id',status:'PENDING',niche:'oficinas mecânicas',city:'Sorocaba'};
  else if(route==='/api/ai/status')data={configured:false};
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
 return {context,root,viewEl,notice,field,city,composer,fetches,listeners};
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

test('Main search calls the on-demand OSM API; Gosom stays optional',async()=>{
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
 const hit={dataset:{action:'toggle-all'},closest:()=>null};
 await h.listeners.click({target:{closest:()=>hit}});
 assert.match(h.viewEl.innerHTML,/1 selecionada/);
 assert.match(h.viewEl.innerHTML,/Desmarcar todas/);
 await h.listeners.click({target:{closest:()=>hit}});
 assert.match(h.viewEl.innerHTML,/0 selecionadas/);
 assert.match(h.viewEl.innerHTML,/Selecionar todas/);
 assert.ok(!h.fetches.some(x=>x.method==='POST'),'selection must not call outbound API');
});

test('Groq draft button proposes a response without sending',async()=>{
 const h=createHarness();
 await vm.runInContext('reload()',h.context);
 vm.runInContext("selectedThread='thread-test';messages=[{direction:'in',body:'Como funciona?'}];render()",h.context);
 assert.match(app,/data-action="suggest-groq"/);
 await h.listeners.click({target:{closest:()=>({dataset:{action:'suggest-groq'}})}});
 assert.equal(h.composer.value,'Claro! Posso explicar melhor?');
 assert.ok(h.fetches.some(x=>x.route==='/api/ai/draft'&&x.method==='POST'));
 assert.equal(h.fetches.filter(x=>x.route.includes('/api/whatsapp/reply')).length,0);
});

test('WhatsApp interactive options open a preview and do not send without confirmation',async()=>{
 const h=createHarness();
 await vm.runInContext('reload()',h.context);
 vm.runInContext("view='conversations';remoteChats=[{id:'wa:5515999992222@s.whatsapp.net',name:'Contato teste',phone:'5515999992222'}];selectedThread='wa:5515999992222@s.whatsapp.net';messages=[{direction:'in',body:'Pode me explicar?'}];render()",h.context);
 assert.match(h.viewEl.innerHTML,/data-action="show-options"/);
 await h.listeners.click({target:{closest:()=>({dataset:{action:'show-options'}})}});
 assert.match(h.viewEl.innerHTML,/Quero saber mais/);
 assert.match(h.viewEl.innerHTML,/Ver um exemplo/);
 assert.match(h.viewEl.innerHTML,/Falar com alguém/);
 await h.listeners.click({target:{closest:()=>({dataset:{action:'send-options'}})}});
 assert.ok(!h.fetches.some(x=>x.route==='/api/whatsapp/interactive-send'),'Confirmation rejected: never send');
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
