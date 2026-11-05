// Prospector: five focused views. Deliberately no legacy campaign modules.
const q=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const stamp=d=>d?new Date(d).toLocaleString("pt-BR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
const tabs={clients:"Clientes",overview:"Visão geral",conversations:"Conversas",prospects:"Prospecção",connections:"Conexões",training:"Treinamento da IA",credits:"Créditos",settings:"Configurações"};
let platformContext={role:"client",name:"Meu espaço"},clientList=[],creditState=null,creditRequests=[],clientSearch="",clientStatusFilter="all",trainingState=null,trainingChats=[],trainingSelection=new Set(),trainingMode="selected",trainingAllConfirmed=false,trainingBusy=false,clientAccess="";
let workspaceInitialized=false;
let preferredPackage='';
try{preferredPackage=sessionStorage.getItem('prospector-preferred-package')||'';}catch{}
let offerType='portfolio';
const icons={overview:"▦",conversations:"◉",prospects:"⌕",connections:"◫",settings:"⚙"};
let view=Object.keys(tabs).includes(location.hash.split("/")[1])?location.hash.split("/")[1]:"overview";
let salesResults=null,state=null,wa=null,ai=null,voiceMetrics=null,remoteChats=[],selectedThread=null,messages=[],groqSalesProfile=null,interactiveState=null,prospects=null,approachQueue=null,kanban=null,mapsJob=null,mapsResearch=null,mapsTimer=null,mapsPolling=false,prospectFilter="uncontacted",selectedLeadIds=new Set(),approachPreview=null,niche="",city="",busy=false,notice="",qrResult=null,chatFilter="",lastRefresh=0,searchSource="osm",prospectError="",prospectLoading=false,handoffPending=false,consentPolicy=null,consentPolicyBusy=false;
const prospectDay=()=>new Date().toLocaleDateString("en-CA",{timeZone:"America/Sao_Paulo"});
function newProspectSession(){
 const token=crypto.randomUUID();
 try{if(typeof sessionStorage!=="undefined"){sessionStorage.setItem("prospect-session",token);sessionStorage.setItem("prospect-session-day",prospectDay());}}catch{}
 return token;
}
function savedProspectSession(){
 try{
  const session=typeof sessionStorage!=="undefined"?sessionStorage.getItem("prospect-session"):"";
  const day=typeof sessionStorage!=="undefined"?sessionStorage.getItem("prospect-session-day"):"";
  if(day===prospectDay()&&/^[a-f0-9-]{36}$/i.test(session||""))return session;
 }catch{}
 return newProspectSession();
}
let prospectSession=savedProspectSession();
const root=q("#app");
let prospectPrefs={mode:'all',niche:'',city:'',options:{cities:[],segments:[]}};
let calendarMonth=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}).slice(0,7);
let calendarData=null,calendarDetail=null,calendarBusy=false;
let waQrOpen=false,waQrConnectedAt=0;
let trainingStep=1,trainingReconfiguring=false,trainingRecording=false,dictation=null,franciscaOpen=false;
let waAccounts=[],connectionSession='';
const waSessionQuery=()=>connectionSession?'?sessionId='+encodeURIComponent(connectionSession):'';
let waRefreshing=null,qrOpening=false;
function whatsappNotice(){return '';}
function n(msg){notice=String(msg||"");const el=q("#notice");if(el){el.textContent=notice;el.classList.toggle("hidden",!notice);el.setAttribute("role",notice?"status":"none")}}
async function api(path,opts={}){
 const r=await fetch(path,{credentials:"same-origin",cache:"no-store",...opts,headers:{"Accept":"application/json",...(opts.body?{"Content-Type":"application/json"}:{}),...(opts.headers||{})}});
 let data=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(data.error||data.message||"Servidor indisponível (HTTP "+r.status+")");
 return data;
}
const post=(path,data)=>api(path,{method:"POST",body:JSON.stringify(data||{})});
function confirmInApp({title,description,confirmLabel='Confirmar',fields='',danger=false}={}){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');
  dialog.className='prospector-dialog'+(danger?' danger':'');
  dialog.setAttribute('aria-labelledby','prospector-dialog-title');
  dialog.setAttribute('aria-describedby','prospector-dialog-description');
  dialog.innerHTML='<form method="dialog" class="prospector-dialog-form"><span class="kicker">PROSPECTOR / CONFIRMAÇÃO</span><h2 id="prospector-dialog-title">'+esc(title)+'</h2><p id="prospector-dialog-description">'+esc(description)+'</p>'+fields+'<div class="prospector-dialog-actions"><button class="secondary" type="submit" value="cancel">Cancelar</button><button class="'+(danger?'danger-button':'primary')+'" type="submit" value="confirm">'+esc(confirmLabel)+'</button></div></form>';
  document.body.append(dialog);
  dialog.addEventListener('close',()=>{
   const value=dialog.returnValue==='confirm'?Object.fromEntries(new FormData(dialog.querySelector('form'))):null;
   dialog.remove();resolve(value);
  },{once:true});
  dialog.showModal();
 });
}

function nav(viewName){if(platformContext.role==="master"&&!["overview","clients","credits","settings"].includes(viewName))viewName="overview";if(viewName==="clients"&&platformContext.role!=="master")viewName="overview";if(!tabs[viewName])viewName="overview";view=viewName;location.hash="/"+view;render();if(platformContext.role==="master"){if(view==="clients"||view==="overview")loadClients();return;}if(view==="connections"){if(!qrOpening)refreshWa();}if(view==="prospects")loadProspectExperience();if(view==="conversations")loadChats();if(view==="overview")loadKanban();if(view==="clients")loadClients();if(view==="training")loadTraining();if(view==="credits")loadCredits();if(view==="settings"){refreshAI();refreshVoiceMetrics();refreshConsentPolicy();}}

function glyph(key){
 if(globalThis.ProspectorIcons)return globalThis.ProspectorIcons.svg(key);
 const paths={
 overview:'<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
 prospects:'<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5M8 11h6M11 8v6"/>',
 conversations:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.5A9 9 0 1 1 21 11.5Z"/><path d="M8 11.5h9M8 14.5h5"/>',
 connections:'<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 8h.01M12 8h4M8 12h8M8 16h8"/>',
 clients:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',training:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',credits:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18M15 14h3"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.2 1.7-2 2-1.7-1.2a8 8 0 0 1-2 .8l-.4 2.1h-2.8l-.4-2.1a8 8 0 0 1-2-.8L7.7 18.8l-2-2L6.9 15a8 8 0 0 1-.8-2l-2.1-.4V9.8l2.1-.4a8 8 0 0 1 .8-2L5.7 5.7l2-2 1.7 1.2a8 8 0 0 1 2-.8l.4-2.1h2.8l.4 2.1a8 8 0 0 1 2 .8l1.7-1.2 2 2-1.2 1.7a8 8 0 0 1 .8 2l2.1.4v2.8l-2.1.4a8 8 0 0 1-.9 2Z"/>',
 refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.8 9a7 7 0 0 1 12-2L20 12M4 12l2.2 5a7 7 0 0 0 12-2"/>',
 arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
 search:'<circle cx="10.7" cy="10.7" r="6.7"/><path d="m15.7 15.7 5 5"/>',
 menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
 close:'<path d="M5 5l14 14M19 5 5 19"/>',
 check:'<path d="m5 12 4 4L19 6"/>'
 };
 return '<svg class="icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[key]||paths.check)+'</svg>';
}
function workspaceTabs(){return '<nav class="workspace-tabs" aria-label="Seções do painel">'+Object.entries(tabs).filter(([key])=>platformContext.role==='master'?['overview','clients','credits','settings'].includes(key):key!=='clients').map(([key,label])=>'<button data-tab="'+key+'" class="'+(view===key?'active':'')+'" '+(view===key?'aria-current="page"':'')+'>'+esc(label)+'</button>').join('')+'</nav>';}
function shell(){
 const active=tabs[view]||tabs.overview,connected=!!wa?.connected;
 root.innerHTML='<div class="shell"><div class="scrim" data-action="close-menu"></div><aside id="side" class="side" aria-label="Menu principal"><div class="brand"><span class="brand-mark">p<span>.</span></span><div><strong>prospector<span class="accent">.</span></strong><small>BY CONSECOM BRASIL</small></div><button class="side-close" data-action="close-menu" aria-label="Fechar menu">'+glyph('close')+'</button></div><div class="side-label">WORKSPACE</div><nav aria-label="Navegação principal">'+Object.entries(tabs).filter(([key])=>platformContext.role==="master"?["overview","clients","credits","settings"].includes(key):key!=="clients").map(([key,label])=>'<button type="button" class="nav '+(view===key?'active':'')+'" data-tab="'+key+'" title="'+esc(label)+'" aria-label="'+esc(label)+'" '+(view===key?'aria-current="page"':'')+'>'+glyph(key)+'<span>'+label+'</span>'+(view===key?'<span class="nav-indicator"></span>':'')+'</button>').join('')+'</nav><div class="side-spacer"></div><div class="side-panel"><span class="side-panel-label">STATUS DA OPERAÇÃO</span><div class="side-status"><span class="pulse '+(connected?'ok':'')+'"></span><div><strong>'+(platformContext.role==='master'?'Painel master':connected?'WhatsApp conectado':'WhatsApp pendente')+'</strong><small>'+(platformContext.role==='master'?'Gestão de clientes e acessos':connected?'Sessão sincronizada':'Confira em Conexões')+'</small></div></div><p>'+(platformContext.role==='master'?'Abra uma conta de cliente para acessar sua operação.':'Acompanhe conexões, conversas e oportunidades.')+'</p></div><div class="side-footer"><span class="brand-min">C.</span><div><strong>'+esc(platformContext.name)+'</strong><small>'+(platformContext.role==='master'?'Painel master':'Espaço do cliente')+'</small></div></div></aside><div class="body"><header class="top"><div class="top-left"><button class="hamburger icon-button" data-action="menu" aria-label="Abrir menu">'+glyph('menu')+'</button><div class="top-title"><span class="eyebrow">WORKSPACE / '+esc(active.toUpperCase())+'</span><h1>'+esc(active)+'</h1></div></div>'+workspaceTabs()+'<div class="top-right"><span class="status-chip '+(connected?'online':'')+'"><span class="pulse '+(connected?'ok':'')+'"></span><span>'+(platformContext.role==='master'?'Administração':connected?'WhatsApp online':'WhatsApp offline')+'</span></span>'+(platformContext.role!=='master'&&!connected?'<button type="button" class="wa-header-connect" data-action="reconnect-qr">Conectar</button>':'')+'<button class="icon-button refresh-button" data-action="refresh" title="Atualizar dados" aria-label="Atualizar dados">'+glyph('refresh')+'</button><button class="account-logout" type="button" data-action="logout-client" aria-label="Sair da conta">Sair</button><span class="useravatar" aria-hidden="true">'+esc((platformContext.name||'P').trim().charAt(0).toUpperCase()||'P')+'</span></div></header><div class="main-wrap">'+(platformContext.canReturnToMaster?'<div class="workspace-return">Você está no espaço de '+esc(platformContext.name)+'. <a href="/master">Voltar ao painel master</a></div>':'')+whatsappNotice()+'<div id="notice" class="notice '+(notice?'':'hidden')+'" role="status">'+esc(notice)+'</div><main class="content" id="view" aria-label="'+esc(active)+'"></main><footer class="main-footer"><span>PROSPECTOR / CONSECOM BRASIL</span><span>Ambiente privado · Dados sob sua gestão</span></footer></div></div></div>';
}


function cards(values){
 return '<div class="stats">'+values.map((x,i)=>'<div class="metric"><div class="metric-top"><span class="metric-label">'+esc(x[0])+'</span><span class="metric-index">0'+(i+1)+'</span></div><div class="metric-value">'+esc(x[1])+'</div><div class="metric-help">'+esc(x[2]||'')+'</div></div>').join('')+'</div>';
}
function clientsView(){
 const active=clientList.filter(c=>c.status==='active').length;
 const filterText=clientSearch.trim().toLocaleLowerCase('pt-BR');
 const filteredClients=clientList.filter(c=>(clientStatusFilter==='all'||c.status===clientStatusFilter)&&(!filterText||(c.name+' '+c.email).toLocaleLowerCase('pt-BR').includes(filterText)));
 return '<div class="workspace-head"><div><span class="kicker">PAINEL MASTER</span><h2>Seus clientes, em um só lugar.</h2><p>Cadastre gestores, acompanhe saldos e controle o acesso de cada operação.</p></div><span class="tag green">Administração</span></div>'+cards([['Clientes',clientList.length,'Contas cadastradas'],['Ativos',active,'Com acesso liberado'],['Créditos disponíveis',clientList.reduce((n,c)=>n+c.available,0),'Total nas contas']])+ '<div class="client-searchbar"><label>Pesquisar gestor ou agência<input id="client-search" type="search" autocomplete="off" placeholder="Nome ou e-mail" value="'+esc(clientSearch)+'"></label><label>Filtrar por status<select id="client-status-filter"><option value="all" '+(clientStatusFilter==='all'?'selected':'')+'>Todas as contas</option><option value="active" '+(clientStatusFilter==='active'?'selected':'')+'>Ativas</option><option value="suspended" '+(clientStatusFilter==='suspended'?'selected':'')+'>Suspensas</option></select></label><span class="client-search-count">'+filteredClients.length+' resultado'+(filteredClients.length===1?'':'s')+'</span></div><div class="management-grid"><section class="panel"><div class="heading"><div><h3>Carteira de clientes</h3><p>Cada conta tem seus próprios dados, números e treinamento.</p></div><button class="secondary compact" data-action="refresh-clients">Atualizar</button></div>'+ (filteredClients.length?filteredClients.map(c=>'<article class="client-card"><div class="client-identity"><span class="account-icon">'+esc(c.name[0])+'</span><div><h4>'+esc(c.name)+'</h4><small>'+esc(c.email)+'</small></div><span class="tag '+(c.status==='active'?'green':'')+'">'+(c.status==='active'?'Ativo':'Suspenso')+'</span></div><div class="client-balance"><strong>'+esc(c.unlimited?'Ilimitado':c.available)+'</strong> '+(c.unlimited?'Plano interno exclusivo':'créditos disponíveis')+(c.reserved?' · '+esc(c.reserved)+' em conferência':'')+'</div><div class="actions"><button class="secondary compact" data-action="client-open" data-client="'+esc(c.id)+'">Abrir painel</button>'+(!c.unlimited?'<button class="secondary compact" data-action="client-credit" data-client="'+esc(c.id)+'">Adicionar créditos</button>':'')+'<button class="secondary compact" data-action="client-access" data-client="'+esc(c.id)+'">Novo link de acesso</button><button class="text-button" '+(c.unlimited?'hidden':'')+' data-action="client-status" data-client="'+esc(c.id)+'" data-status="'+(c.status==='active'?'suspended':'active')+'">'+(c.status==='active'?'Suspender':'Reativar')+'</button>'+(c.status==='suspended'&&c.reserved?'<button class="text-button" data-action="client-release" data-client="'+esc(c.id)+'">Conferir e liberar reservas</button>':'')+'</div></article>').join(''):'<div class="empty"><h3>'+(clientList.length?'Nenhum cliente com estes filtros':'Seu primeiro cliente começa aqui')+'</h3><p>Cadastre o gestor ao lado e envie o link privado de acesso.</p></div>')+'</section><section class="panel management-aside"><span class="kicker">NOVA CONTA</span><h3>Adicionar cliente</h3><form id="client-create" class="stack-form"><label>Nome da empresa ou gestor<input name="name" required maxlength="100" autocomplete="organization" placeholder="Ex.: Agência Horizonte"></label><label>E-mail<input name="email" type="email" required maxlength="200" autocomplete="email" placeholder="gestor@empresa.com.br"></label><button class="primary" '+(busy?'disabled':'')+'>Criar conta</button></form><p class="footnote">O cliente começa com saldo zero. Libere créditos após confirmar o pagamento.</p>'+(clientAccess?'<div class="access-result"><strong>Link privado gerado</strong><p>Copie e envie somente ao responsável pela conta.</p><input readonly aria-label="Link de acesso do cliente" value="'+esc(clientAccess)+'"><button class="secondary compact" data-action="copy-access">Copiar link</button></div>':'')+'</section></div>';
}
function masterDashboard(){
 const active=clientList.filter(c=>c.status==='active'),primary=clientList.find(c=>c.unlimited),pendingRequests=creditRequests.filter(r=>r.status==='PENDING').length;
 return '<div class="workspace-head"><div><span class="kicker">CENTRAL DE ADMINISTRAÇÃO</span><h2>Uma visão clara do seu negócio.</h2><p>Gerencie clientes, acessos e créditos. Cada operação acontece no painel do respectivo cliente.</p></div><button class="primary" data-tab="clients">Gerenciar clientes '+glyph('arrow')+'</button></div>'+cards([['Clientes ativos',active.length,'Contas com acesso liberado'],['Saldo dos clientes',clientList.filter(c=>!c.unlimited).reduce((n,c)=>n+c.available,0),'Créditos disponíveis nas contas'],['Pedidos de recarga',pendingRequests,'Aguardando confirmação de pagamento']])+'<div class="master-home-grid"><section class="panel master-owner"><span class="kicker">SUA CONTA DE CLIENTE</span><h2>O espaço da sua operação.</h2><p>Seus contatos, conversas, WhatsApps e treinamento ficam no painel do cliente Consecom, separados desta administração.</p>'+(primary?'<div class="master-owner-row"><span class="account-icon">C</span><div><strong>'+esc(primary.name)+'</strong><small>'+esc(primary.email)+'</small></div><span class="tag green">Ilimitado</span></div><button class="primary" data-action="client-open" data-client="'+esc(primary.id)+'">Abrir minha operação '+glyph('arrow')+'</button>':'<p class="footnote">A conta interna será configurada na implantação.</p>')+'</section><section class="panel"><span class="kicker">GESTÃO DO DIA A DIA</span><h3>O que você precisa fazer?</h3><button class="master-shortcut" data-tab="clients"><span><strong>Cadastrar e acompanhar clientes</strong><small>Crie contas, controle acessos e abra os painéis.</small></span>'+glyph('arrow')+'</button><button class="master-shortcut" data-tab="credits"><span><strong>Gerenciar créditos</strong><small>Libere recargas depois da confirmação do pagamento.</small></span>'+glyph('arrow')+'</button><a class="master-shortcut" href="/conheca" target="_blank" rel="noopener"><span><strong>Ver a página do Prospector</strong><small>Compartilhe a apresentação e o cadastro.</small></span>'+glyph('arrow')+'</a></section></div>';
}
function masterSettings(){return '<section class="panel"><span class="kicker">ADMINISTRAÇÃO</span><h2>Cada acesso no seu lugar.</h2><div class="setting-line"><div><strong>Painel master</strong><small>Administra clientes, acessos e recargas.</small></div><span class="tag green">Administrador</span></div><div class="setting-line"><div><strong>Painéis dos clientes</strong><small>Contêm conexões, prospecção, conversas e treinamento.</small></div><button class="secondary" data-tab="clients">Abrir carteira</button></div><p class="footnote">A conta interna Consecom é a única com plano ilimitado. Novos cadastros começam com saldo zero.</p></section>';}

const moneyFromCents=cents=>'R$ '+(Number(cents||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
function masterCreditRequests(){
 const pending=creditRequests.filter(x=>x.status==='PENDING'),recent=creditRequests.slice(0,12);
 return '<section class="panel master-orders"><div class="heading"><div><span class="kicker">SOLICITAÇÕES DE RECARGA</span><h3>Pedidos aguardando pagamento</h3><p>Créditos só são liberados após sua confirmação de recebimento.</p></div><span class="tag '+(pending.length?'':'green')+'">'+pending.length+' pendente'+(pending.length===1?'':'s')+'</span></div>'+
 (recent.length?'<div class="orders-list">'+recent.map(x=>'<article class="order-row"><div class="order-identity"><strong>'+esc(x.client_name)+'</strong><small>'+esc(x.client_email)+' · '+stamp(x.created_at)+'</small></div><div class="order-amount"><strong>'+Number(x.credits).toLocaleString('pt-BR')+' créditos</strong><small>'+moneyFromCents(x.price_cents)+'</small></div><span class="tag '+(x.status==='APPROVED'?'green':'')+'">'+(x.status==='PENDING'?'Aguardando':x.status==='APPROVED'?'Confirmado':'Recusado')+'</span>'+(x.status==='PENDING'?'<div class="order-actions"><button class="primary compact" data-action="credit-request-approve" data-request="'+esc(x.id)+'">Confirmar pagamento</button><button class="text-button" data-action="credit-request-decline" data-request="'+esc(x.id)+'">Recusar</button></div>':'')+'</article>').join('')+'</div>':'<div class="empty"><h4>Nenhum pedido ainda</h4><p>Quando um gestor solicitar créditos, o pedido aparecerá aqui para sua conferência.</p></div>')+'</section>';
}
function creditsView(){
 if(platformContext.role==='master')return '<div class="workspace-head"><div><span class="kicker">ADMINISTRAÇÃO FINANCEIRA</span><h2>Créditos e recargas</h2><p>Gerencie os pedidos antes de liberar saldo nas contas.</p></div><button class="secondary" data-tab="clients">Ver carteira de clientes</button></div>'+masterCreditRequests();
 if(platformContext.unlimited)return '<section class="panel unlimited-plan"><span class="kicker">CONTA INTERNA CONSECOM</span><h2>Sua operação, sem limite de créditos.</h2><p>O plano ilimitado interno não altera os limites diários de mensagens, as políticas do canal ou as permissões de contato.</p><span class="tag green">Plano interno ativo</span><div class="actions"><button class="primary" data-tab="prospects">Abrir prospecção</button></div></section>';
 const c=creditState||{},packs=Array.isArray(c.packages)?c.packages:[],requests=Array.isArray(c.requests)?c.requests:[];
 return '<div class="workspace-head"><div><span class="kicker">CRÉDITOS SOB DEMANDA</span><h2>Escolha seu ritmo. A IA faz o restante.</h2><p>Sem mensalidade obrigatória. Uma nova abordagem aceita pelo canal consome um crédito; a continuidade da mesma conversa não consome novos créditos de abordagem.</p></div></div>'+
 '<div class="credit-summary-grid"><section class="panel credit-balance"><span>Seu saldo disponível</span><strong>'+esc(c.available??platformContext.available??0)+'</strong><p>créditos de abordagem</p><button class="secondary compact" data-action="refresh-credits">Atualizar saldo</button></section><section class="panel credit-explain"><span class="kicker">COMO FUNCIONA</span><h3>Créditos sem vencimento</h3><p>Escolha um pacote e envie um pedido de recarga. A Consecom libera os créditos depois que o pagamento for confirmado.</p><p><strong>Importante:</strong> comprar um pacote maior não aumenta o teto de até 250 novas abordagens por dia nem garante entregas.</p></section></div>'+
 '<div class="heading credit-package-title"><div><h3>Pacotes disponíveis</h3><p>Escolha o que combina com sua operação.</p></div></div>'+
 (preferredPackage&&packs.some(p=>p.id===preferredPackage)?'<div class="credit-preference"><div><strong>Seu pacote escolhido na landing: '+esc(packs.find(p=>p.id===preferredPackage).name)+'</strong><p>Você já criou seu acesso. Se quiser, envie o pedido para a Consecom liberar os créditos após o pagamento.</p></div><button class="primary" data-action="request-credit-package" data-package="'+esc(preferredPackage)+'">Solicitar pacote selecionado</button></div>':'')+
 '<div class="credit-packages-grid">'+packs.map(p=>'<article class="credit-packet '+(p.id==='padrao'?'featured':'')+'"><div class="credit-packet-top"><span>'+esc(p.name)+'</span>'+(p.id==='padrao'?'<span class="tag green">Mais indicado</span>':'')+'</div><strong class="credit-packet-volume">'+Number(p.credits).toLocaleString('pt-BR')+'</strong><small>abordagens</small><div class="credit-packet-price">'+moneyFromCents(p.priceCents)+'</div><p>'+'R$ '+(p.priceCents/100/p.credits).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:5})+' por abordagem</p><button class="primary" data-action="request-credit-package" data-package="'+esc(p.id)+'">Solicitar '+esc(p.name)+'</button></article>').join('')+'</div>'+
 '<section class="panel"><div class="heading"><div><h3>Meus pedidos de recarga</h3><p>Um pedido não é uma cobrança automática.</p></div><button class="secondary compact" data-action="refresh-credits">Atualizar</button></div>'+(requests.length?'<div class="orders-list">'+requests.slice(0,15).map(x=>'<div class="order-row"><div class="order-identity"><strong>'+Number(x.credits).toLocaleString('pt-BR')+' créditos · '+moneyFromCents(x.price_cents)+'</strong><small>'+stamp(x.created_at)+'</small></div><span class="tag '+(x.status==='APPROVED'?'green':'')+'">'+(x.status==='PENDING'?'Aguardando confirmação':x.status==='APPROVED'?'Créditos liberados':'Não aprovado')+'</span></div>').join('')+'</div>':'<div class="empty"><p>Você ainda não solicitou uma recarga.</p></div>')+'</section>'+
 '<section class="panel"><h3>Histórico de créditos</h3>'+(c.items?.length?'<div class="table-wrap"><table class="result-table"><thead><tr><th>Data</th><th>Descrição</th><th>Créditos</th></tr></thead><tbody>'+c.items.map(x=>'<tr><td>'+stamp(x.created_at)+'</td><td>'+esc(x.reason)+'</td><td class="'+(x.amount>0?'credit-positive':'')+'">'+(x.amount>0?'+':'')+esc(x.amount)+'</td></tr>').join('')+'</tbody></table></div>':'<div class="empty"><p>O extrato aparecerá depois da primeira recarga ou abordagem.</p></div>')+'</section>';
}
function trainingManualPanel(t){
 return '<section class="panel training-manual training-chat-panel"><div class="heading"><div><span class="kicker">ENSINE DO SEU JEITO</span><h3>O que seu atendimento precisa saber?</h3><p>Converse naturalmente sobre sua empresa, os clientes, os serviços, dúvidas comuns e quando encaminhar para uma pessoa.</p></div></div><div class="training-hints"><span>Conte o que sua empresa faz</span><span>Para quem você vende</span><span>Como apresenta seus serviços</span><span>Como prefere atender</span></div>'+
 '<div class="training-messages" role="log" aria-label="Conversa de treinamento">'+(t.chat?.length?t.chat.map(m=>'<div class="training-message '+(m.role==='user'?'sent':'received')+'"><small>'+(m.role==='user'?'Você':'Assistente de treinamento')+'</small><p>'+esc(m.body)+'</p></div>').join(''):'<div class="training-welcome"><strong>Fale como se estivesse explicando a sua empresa para uma pessoa.</strong><p>Ex.: “Nós atendemos oficinas da região, criamos sites e campanhas. Antes de falar preço, quero que você descubra o que a empresa precisa.”</p></div>')+'</div><form id="training-chat" class="training-composer"><label class="sr-only" for="training-input">Orientações de treinamento</label><textarea id="training-input" name="text" rows="4" maxlength="3000" required placeholder="Digite ou toque no microfone para contar sobre sua empresa…"></textarea><div class="training-composer-actions"><button type="button" class="secondary training-mic" data-action="training-dictate" aria-label="'+(trainingRecording?'Parar ditado':'Usar microfone para ditar orientação')+'">'+glyph('conversations')+' '+(trainingRecording?'Parar microfone':'Falar naturalmente')+'</button><button class="primary" '+(trainingBusy?'disabled':'')+'>'+(trainingBusy?'Preparando…':'Enviar orientação')+'</button></div></form><p class="footnote">O ditado por voz depende da disponibilidade de reconhecimento de fala no seu navegador. O conteúdo transcrito só é usado no treinamento depois que você escolher enviá-lo.</p></section>';
}
function trainingReviewPanel(t){
 const draft=t.draft,profile=t.profile;
 return '<section class="panel profile-review"><div class="heading"><div><span class="kicker">REVISÃO DO GESTOR</span><h3>'+(draft?'Revise o que foi aprendido':'Perfil do atendimento')+'</h3><p>'+(draft?'Edite as sugestões e aprove. Nada entra em uso sem sua confirmação.':profile?'Orientações que a IA deve seguir nas próximas conversas.':'Aqui aparecerão as orientações após o primeiro treinamento.')+'</p></div>'+(profile?'<span class="tag green">Ativo</span>':'')+'</div>'+
 (draft?'<form id="training-approve" class="stack-form"><input type="hidden" name="id" value="'+esc(draft.id)+'"><label>Regras e padrões aprendidos<textarea name="text" rows="12" maxlength="9000" required>'+esc(draft.text)+'</textarea></label><button class="primary" '+(trainingBusy?'disabled':'')+'>Aprovar perfil de atendimento</button></form>':profile?'<pre class="profile-text">'+esc(profile.text)+'</pre><button class="secondary" data-action="training-edit-profile">Editar perfil</button>':'<div class="empty"><p>O resumo será apresentado para sua aprovação após o treinamento.</p></div>')+'</section>';
}
function trainingView(){
 const t=trainingState||{},profile=t.profile,draft=t.draft,running=t.runs?.find(x=>x.status==='RUNNING');
 if(profile&&!trainingReconfiguring){
  return '<div class="workspace-head"><div><span class="kicker">INTELIGÊNCIA DO SEU NEGÓCIO</span><h2>Contexto configurado.</h2><p>A Francisca conhece as orientações que você aprovou. Ensine novas informações a qualquer momento.</p></div><span class="tag green">Perfil ativo</span></div><div class="training-configured-grid">'+trainingManualPanel(t)+trainingReviewPanel(t)+'</div><div class="training-more"><button type="button" class="secondary" data-action="training-reconfigure">Refazer configuração por etapas</button><button type="button" class="secondary" data-action="training-chats">Carregar novas conversas</button></div>';
 }
 const stages=['Sua empresa','Ensine conversando','Análise de conversas','Aprovar perfil'];
 const progress='<div class="training-wizard-progress" aria-label="Etapas do treinamento">'+stages.map((name,i)=>'<div class="training-wizard-stage '+(trainingStep===i+1?'current':trainingStep>i+1?'complete':'')+'"><span>'+(trainingStep>i+1?'✓':i+1)+'</span><strong>'+name+'</strong></div>').join('')+'</div>';
 let current='';
 if(trainingStep===1){
  current='<section class="panel"><span class="kicker">ETAPA 1 DE 4</span><h3>Primeiro, conte sobre seu negócio.</h3><p>Essas informações ajudam a IA a entender como você trabalha e para quem vende.</p><form id="training-business" class="stack-form"><label>Nome da empresa<input name="name" required maxlength="100" value="'+esc(t.business?.name||'')+'"></label><label>WhatsApp pessoal para avisos de interessados<input type="tel" name="notificationPhone" autocomplete="tel" placeholder="(11) 99999-9999" value="'+esc(t.business?.notificationPhone||'')+'"><small>Para receber avisos quando uma oportunidade precisar de você.</small></label><label>Serviços, público e informações aprovadas<textarea name="description" rows="5" maxlength="4000" placeholder="O que a empresa oferece, quem são seus clientes e quais informações podemos comunicar.">'+esc(t.business?.description||'')+'</textarea></label><button type="submit" class="primary">Salvar e continuar ↗</button></form></section>';
 }else if(trainingStep===2){
  current='<div class="training-wizard-content">'+trainingManualPanel(t)+'</div><div class="training-wizard-navigation"><button class="secondary" data-action="training-prev">Voltar</button><button class="primary" data-action="training-next">Próxima etapa: conversas ↗</button></div>';
 }else if(trainingStep===3){
  current='<section class="panel training-analysis-stage"><span class="kicker">ETAPA 3 DE 4</span><h3>Extraia contexto das conversas comerciais.</h3><p>Aprenda com respostas e objeções reais, usando somente conversas que você tem autorização para analisar. Nenhuma mensagem será enviada a contatos.</p>'+
 (!wa?.connected?'<div class="training-connection-warning"><strong>Conecte seus WhatsApps para importar o histórico.</strong><p>O Prospector precisa de pelo menos um número conectado para consultar as conversas.</p><button class="secondary" data-tab="connections">Conectar meus WhatsApps</button></div>':'')+
 '<div class="heading"><div><strong>Escolha os exemplos</strong><p>Selecione as conversas ou use todas as disponíveis, desde que sejam comerciais e autorizadas.</p></div><button class="secondary compact" data-action="training-chats">Atualizar conversas</button></div><div class="mode-options"><label><input type="radio" name="training-mode" value="selected" '+(trainingMode==='selected'?'checked':'')+'> Selecionar conversas</label><label><input type="radio" name="training-mode" value="all" '+(trainingMode==='all'?'checked':'')+'> Todas as disponíveis</label></div>'+
 (trainingMode==='all'?'<label class="training-all-confirm"><input id="training-all-confirm" type="checkbox" '+(trainingAllConfirmed?'checked':'')+'> Confirmo que tenho autorização para analisar os históricos comerciais disponibilizados. Não devo incluir conversas pessoais.</label>':'<div class="training-chat-list">'+(trainingChats.length?trainingChats.map(c=>'<label><input type="checkbox" data-training-chat="'+esc(c.key)+'" '+(trainingSelection.has(c.key)?'checked':'')+'><span><strong>'+esc(c.name)+'</strong><small>'+esc(c.channel)+'</small></span></label>').join(''):'<p>Conecte o WhatsApp e clique em Atualizar conversas.</p>')+'</div>')+
 '<div class="training-wizard-navigation"><button class="secondary" data-action="training-prev">Voltar</button><button class="primary" data-action="training-analyze" '+(trainingBusy||running?'disabled':'')+'>'+(running?'Analisando…':'Analisar e gerar relatório')+'</button></div>'+
 (t.runs?.length?'<div class="training-history"><h4>Últimas análises</h4>'+t.runs.slice(0,3).map(r=>'<p><strong>'+esc(({RUNNING:'Em andamento',REVIEW:'Pronta para revisão',FAILED:'Não concluída'})[r.status]||r.status)+'</strong> · '+stamp(r.created_at)+(r.details?.error?'<br>'+esc(r.details.error):'')+'</p>').join('')+'</div>':'')+'</section>';
 }else{
  current='<div class="training-wizard-content">'+trainingReviewPanel(t)+'</div><div class="training-wizard-navigation"><button class="secondary" data-action="training-prev">Voltar</button>'+(draft?'':'<button class="primary" data-action="training-next">Continuar treinamento</button>')+'</div>';
 }
 return '<div class="workspace-head"><div><span class="kicker">CONFIGURAÇÃO GUIADA</span><h2>Treine a IA em quatro etapas.</h2><p>Explique seu negócio, ensine com suas palavras e aprove o contexto que será usado nas conversas.</p></div><span class="tag">Etapa '+trainingStep+' de 4</span></div>'+progress+current;
}
function startTrainingDictation(){
 const Engine=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(trainingRecording){dictation?.stop();return;}
 const input=q('#training-input');
 if(!Engine){n('Este navegador não oferece ditado por voz. Use o campo de texto ou atualize seu navegador.');return;}
 if(!input){n('Abra a etapa de conversa para ditar.');return;}
 const recognition=new Engine();
 recognition.lang='pt-BR';recognition.interimResults=false;recognition.continuous=true;
 dictation=recognition;trainingRecording=true;
 const button=q('[data-action="training-dictate"]');
 if(button){button.textContent='Parar microfone';button.setAttribute('aria-label','Parar ditado');}
 recognition.onresult=event=>{
  const parts=[];
  for(let i=event.resultIndex;i<event.results.length;i++)if(event.results[i].isFinal)parts.push(event.results[i][0].transcript.trim());
  if(parts.length){input.value=(input.value.trim()+' '+parts.join(' ')).trim();input.focus();}
 };
 recognition.onerror=event=>{
  if(event.error!=='no-speech'&&event.error!=='aborted')n('Não foi possível reconhecer a voz: '+event.error);
 };
 recognition.onend=()=>{
  trainingRecording=false;dictation=null;
  const mic=q('[data-action="training-dictate"]');
  if(mic){mic.textContent='Falar naturalmente';mic.setAttribute('aria-label','Usar microfone para ditar orientação');}
 };
 try{recognition.start();n('Ditado iniciado. Fale naturalmente; revise o texto antes de enviar.');}
 catch(e){trainingRecording=false;dictation=null;n('Não foi possível acessar o microfone: '+e.message);}
}
async function loadClients(){try{const [clients,requests]=await Promise.all([api('/api/platform/clients'),api('/api/platform/credit-requests')]);clientList=clients.items||[];creditRequests=requests.items||[];if(platformContext.role==='master')render();}catch(e){n(e.message);}}
async function loadProspectExperience(){
 try{
  const [settings,calendar,queue]=await Promise.all([
   api('/api/prospecting/preferences'),api('/api/prospecting/calendar?month='+encodeURIComponent(calendarMonth)),
   api('/api/prospecting/queue').catch(()=>null)
  ]);
  prospectPrefs=settings;calendarData=calendar;approachQueue=queue;
  if(view==='prospects')render();
 }catch(e){n(e.message);}
}
async function loadProspectCalendar(){
 if(calendarBusy)return;
 calendarBusy=true;
 try{
  calendarData=await api('/api/prospecting/calendar?month='+encodeURIComponent(calendarMonth));
  calendarDetail=null;
  if(view==='prospects')render();
 }finally{calendarBusy=false;}
}
async function openCalendarDetail(day,kind='approached'){
 calendarDetail={day,kind,items:[]};
 if(view==='prospects')render();
 const result=await api('/api/prospecting/calendar?month='+encodeURIComponent(calendarMonth)+'&day='+encodeURIComponent(day)+'&kind='+encodeURIComponent(kind));
 if(calendarDetail?.day===day&&calendarDetail?.kind===kind){calendarDetail=result.detail;render();}
}
async function loadCredits(){if(platformContext.role==='master')return;try{creditState=await api('/api/platform/credits');if(view==='credits')render();}catch(e){n(e.message);}}
async function loadTraining(){try{trainingState=await api('/api/training');if(view==='training'&&!q('textarea:focus,input:focus'))render();}catch(e){n(e.message);}}
async function platformAction(action,el){
 if(action==='client-open'){await post('/api/platform/clients/'+el.dataset.client+'/open',{});location.assign('/');return true;}
 if(action==='logout-client'){await post('/api/platform/logout',{});location.assign('/conheca');return true;}
 if(action==='client-release'){
  const answer=await confirmInApp({title:'Liberar créditos reservados?',description:'Libere somente se você verificou manualmente que as abordagens reservadas NÃO foram aceitas pelo canal. Uma entrega incerta pode ter ocorrido.',danger:true,confirmLabel:'Confirmo que não houve entrega'});
  if(!answer)return true;await post('/api/platform/clients/'+el.dataset.client+'/release-reservations',{confirmedNotSent:true});await loadClients();n('Reservas liberadas após conferência.');return true;
 }
 if(action==='refresh-clients'){await loadClients();return true;}
 if(action==='request-credit-package'){
  const pack=creditState?.packages?.find(p=>p.id===el.dataset.package);
  if(!pack)throw Error('Pacote não encontrado. Atualize seus créditos.');
  const answer=await confirmInApp({title:'Solicitar '+pack.credits.toLocaleString('pt-BR')+' créditos',description:'Pacote '+pack.name+' no valor de '+moneyFromCents(pack.priceCents)+'. Esta solicitação NÃO realiza cobrança. O Master confirmará o pagamento antes de liberar o saldo.',confirmLabel:'Enviar pedido de recarga'});
  if(!answer)return true;
  await post('/api/platform/credit-requests',{packageId:pack.id,requestKey:crypto.randomUUID()});
  preferredPackage='';try{sessionStorage.removeItem('prospector-preferred-package');}catch{}
  await loadCredits();n('Solicitação registrada! Aguarde a confirmação da Consecom.');return true;
 }
 if(action==='credit-request-approve'||action==='credit-request-decline'){
  const req=creditRequests.find(r=>r.id===el.dataset.request);
  if(!req)throw Error('Pedido não encontrado');
  const approved=action==='credit-request-approve';
  const answer=await confirmInApp({
   title:approved?'Pagamento recebido?':'Recusar pedido?',
   description:approved?'Confirme SOMENTE após comprovar o recebimento de '+moneyFromCents(req.price_cents)+' da conta '+req.client_name+'. Isso liberará '+req.credits+' créditos imediatamente.':'O pedido de '+req.client_name+' será marcado como não aprovado. Nenhum crédito será alterado.',
   danger:!approved,confirmLabel:approved?'Confirmar pagamento e liberar':'Recusar pedido',
   fields:approved?'<label class="dialog-check"><input type="checkbox" name="paymentChecked" required> Verifiquei o recebimento do pagamento fora do Prospector.</label>':''
  });
  if(!answer)return true;
  await post('/api/platform/credit-requests/'+req.id+'/'+(approved?'approve':'decline'),{confirmedPayment:approved});
  await loadClients();n(approved?'Pagamento confirmado e créditos liberados.':'Pedido recusado sem alterar créditos.');return true;
 }
 if(action==='refresh-credits'){await loadCredits();return true;}
 if(action==='copy-access'){await navigator.clipboard.writeText(clientAccess);n('Link copiado.');return true;}
 if(action==='client-credit'){
  const client=clientList.find(c=>c.id===el.dataset.client);
  if(!client)throw Error('Cliente não encontrado');
  const answer=await confirmInApp({
   title:'Adicionar créditos a '+client.name,
   description:'Saldo disponível: '+(client.available??0)+' créditos. Confira o pagamento antes de liberar uma recarga. A alteração será registrada no extrato.',
   confirmLabel:'Confirmar ajuste',
   fields:'<div class="dialog-fields"><label>Créditos a adicionar<input type="number" min="1" max="10000000" step="1" name="amount" value="250" required></label><label>Motivo da operação<input name="reason" maxlength="140" value="Recarga confirmada pelo Master" required></label></div>'
  });
  if(!answer)return true;
  const amount=Number(answer.amount);if(!Number.isSafeInteger(amount)||amount<1||amount>10000000)throw Error('Quantidade de créditos inválida');
  await post('/api/platform/clients/'+el.dataset.client+'/credits',{amount,reason:String(answer.reason||'Recarga confirmada').slice(0,140),reference:crypto.randomUUID()});
  await loadClients();n(amount+' créditos adicionados a '+client.name+'.');return true;
 }
 if(action==='client-access'){
  const answer=await confirmInApp({title:'Renovar acesso deste cliente?',description:'O link anterior perderá a validade e os acessos anteriores serão encerrados. Envie o novo link apenas ao responsável.',danger:true,confirmLabel:'Gerar novo link'});
  if(!answer)return true;const r=await post('/api/platform/clients/'+el.dataset.client+'/access',{});clientAccess=location.origin+r.accessPath;render();return true;
 }
 if(action==='client-status'){
  const client=clientList.find(c=>c.id===el.dataset.client);
  const suspend=el.dataset.status==='suspended';
  const answer=await confirmInApp({title:suspend?'Suspender acesso?':'Reativar acesso?',description:suspend?'O gestor '+(client?.name||'selecionado')+' deixará de acessar o painel e seu processo de atendimento será interrompido.':'O cliente voltará a acessar seu ambiente privado.',danger:suspend,confirmLabel:suspend?'Suspender conta':'Reativar conta'});
  if(!answer)return true;await post('/api/platform/clients/'+el.dataset.client+'/status',{status:el.dataset.status});await loadClients();n('Acesso atualizado.');return true;
 }
 if(action==='training-reconfigure'){trainingReconfiguring=true;trainingStep=1;render();return true;}
 if(action==='training-next'){trainingStep=trainingStep===4?2:Math.min(4,trainingStep+1);render();return true;}
 if(action==='training-prev'){trainingStep=Math.max(1,trainingStep-1);render();return true;}
 if(action==='training-dictate'){startTrainingDictation();return true;}
 if(action==='training-chats'){
  if(trainingState?.profile){trainingReconfiguring=true;trainingStep=3;}
  const r=await api('/api/training/chats');trainingChats=r.items||[];render();
  if(r.failures?.length)n('Não foi possível ler '+r.failures.length+' canal(is). Os demais estão disponíveis.');
  return true;
 }
 if(action==='training-edit-profile'){trainingState=await post('/api/training/edit',{});render();return true;}
 if(action==='training-analyze'){
  if(trainingBusy)return true;
  if(trainingMode==='all'&&!trainingAllConfirmed){n('Confirme que o histórico usado é comercial e autorizado antes de analisar tudo.');return true;}
  trainingBusy=true;render();
  try{await post('/api/training/analyze',{mode:trainingMode,keys:[...trainingSelection],confirmedAll:trainingMode==='all'&&trainingAllConfirmed});trainingStep=4;await loadTraining();n('Análise iniciada. O relatório aparecerá para revisão.');}finally{trainingBusy=false;render();}return true;
 }
 return false;
}
async function platformSubmit(ev){
 const id=ev.target.id;
 if(id==='client-hours-form'){
  ev.preventDefault();
  const d=Object.fromEntries(new FormData(ev.target));
  try{
   await post('/api/settings',{client_outreach_hours:{start:d.start,end:d.end}});
   if(state?.settings)state.settings.client_outreach_hours={start:d.start,end:d.end};
   n('Horário das abordagens atualizado.');render();
  }catch(e){n(e.message);}return true;
 }
 if(id==='account-profile'){
  ev.preventDefault();
  const d=Object.fromEntries(new FormData(ev.target));
  try{
   const result=await post('/api/platform/account',d);
   platformContext.email=result.email;
   n(result.message||'Conta atualizada com segurança.');
   render();
  }catch(e){n(e.message);}return true;
 }
 if(!['client-create','training-business','training-chat','training-approve'].includes(id))return false;
 ev.preventDefault();if(trainingBusy||busy)return true;
 const input=Object.fromEntries(new FormData(ev.target));trainingBusy=true;busy=id==='client-create';
 const button=ev.target.querySelector('button');if(button)button.disabled=true;
 try{
  if(id==='client-create'){const r=await post('/api/platform/clients',input);clientAccess=location.origin+r.accessPath;await loadClients();n('Cliente criado. Copie o link privado para compartilhar.');}
  else{trainingState=await post('/api/training/'+({ 'training-business':'business','training-chat':'chat','training-approve':'approve'})[id],input);if(id==='training-business')trainingStep=2;if(id==='training-approve'){trainingStep=4;trainingReconfiguring=false;}n(id==='training-approve'?'Perfil aprovado e ativo.':'Informações de treinamento salvas.');}
 }catch(e){n(e.message);}finally{trainingBusy=false;busy=false;render();}return true;
}
function pipelineGraphic(k){
 const stages=[['approaching','Em abordagem'],['interested','Interessados'],['conversing','Em atendimento']],values=stages.map(([key])=>Math.max(0,Number(k.counts?.[key])||0)),max=Math.max(1,...values);
 return '<section class="pipeline-graphic" aria-label="Resumo visual do funil"><div><span class="kicker">MOVIMENTO DA OPERAÇÃO</span><h3>Da conversa à oportunidade.</h3></div><div class="pipeline-bars">'+stages.map(([key,label],i)=>'<div><span>'+label+'</span><div class="pipeline-track"><i style="width:'+Math.round(values[i]/max*100)+'%"></i></div><strong>'+values[i]+'</strong></div>').join('')+'</div></section>';
}
function overview(){
 if(platformContext.role==="master")return masterDashboard();
 const k=kanban||{columns:{approaching:[],no_interest:[],interested:[],conversing:[]},counts:{}};
 const definition=[
  ['approaching','Abordando','Mensagens enviadas, aguardando retorno'],
  ['no_interest','Sem interesse','Recusas e contatos não convertidos'],
  ['interested','Interessados','Interesse confirmado e aviso privado'],
  ['conversing','Conversando','Atendimento assumido por você']
 ];
 const total=Object.values(k.counts||{}).reduce((x,y)=>x+Number(y||0),0);
 const startupChecks=[
  {label:'Conectar WhatsApp',done:!!wa?.connected,tab:'connections'},
  {label:'Treinar sua IA',done:!!(state?.settings?.training_active||trainingState?.profile),tab:'training'},
  {label:'Ter créditos disponíveis',done:platformContext.unlimited===true||Number(platformContext.available||0)>0,tab:'credits'}
 ];
 const setupReady=startupChecks.every(x=>x.done);
 const startupPanel=setupReady?'':'<section class="setup-progress" aria-label="Prepare sua operação"><div><span class="kicker">COMECE POR AQUI</span><strong>Prepare seu espaço para prospectar</strong><p>Conexão, treinamento e saldo precisam estar prontos antes de iniciar uma operação.</p></div><div class="setup-items">'+startupChecks.map(x=>'<button type="button" data-tab="'+x.tab+'" class="setup-item '+(x.done?'done':'')+'"><span aria-hidden="true">'+(x.done?'✓':'○')+'</span>'+x.label+'</button>').join('')+'</div></section>';
 const stat=(label,value,description)=>'<div class="kanban-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(description)+'</small></div>';
 const item=(lead,col)=>{
  const due=lead.blocked?'Não contatar':lead.nextEligibleAt?(lead.eligibleAgain?'Recontato liberado':'Retorna '+new Date(lead.nextEligibleAt).toLocaleDateString('pt-BR')):'';
  const note=col==='approaching'?(lead.noResponse?'Aguardando resposta':'Abordagem iniciada'):col==='no_interest'?(due||'Sem interesse'):col==='interested'?'Interesse confirmado':'Em atendimento';
  return '<div class="kanban-lead"><div class="kanban-lead-top"><span class="kanban-lead-avatar">'+esc((lead.business||'?')[0])+'</span><div><strong title="'+esc(lead.business)+'">'+esc(lead.business)+'</strong><small>'+esc(lead.city||lead.phone||'Empresa')+'</small></div></div><p>'+esc(note)+'</p>'+
  (lead.phone?'<button class="kanban-message" type="button" data-kanban-chat="'+esc(lead.phone)+'">'+(col==='interested'?'Enviar mensagem ↗':'Abrir conversa ↗')+'</button>':'')+'</div>';
 };
 return '<div class="kanban-dashboard" id="overview-board">'+
  '<div class="kanban-overview-head"><div><span class="kicker">PIPELINE COMERCIAL</span><h2>Visão da operação</h2><p>Todos os contatos e oportunidades em uma única tela.</p></div><button class="secondary compact" data-action="refresh-kanban">'+glyph('refresh')+' Atualizar</button></div>'+
  '<div class="kanban-metrics">'+stat('Empresas acompanhadas',total,'Com atividade registrada')+stat('Abordando',k.counts?.approaching||0,'Em contato')+stat('Interessados',k.counts?.interested||0,'Prioridade comercial')+stat('Conversando',k.counts?.conversing||0,'Atendimento humano')+'</div>'+
  startupPanel+
  pipelineGraphic(k)+'<div class="kanban-board-title"><h3>Kanban de oportunidades</h3><small>Acompanhe cada etapa e abra a conversa pelo cartão.</small></div>'+
  '<div class="kanban-columns" aria-label="Kanban comercial">'+definition.map(([key,label,description])=>
   '<section class="kanban-column kanban-'+key+'"><header><div class="kanban-column-head"><strong>'+esc(label)+'</strong><span>'+esc(k.counts?.[key]||0)+'</span></div><small>'+esc(description)+'</small></header><div class="kanban-column-items">'+
   ((k.columns?.[key]||[]).length?k.columns[key].map(x=>item(x,key)).join(''):'<div class="kanban-empty">Nenhuma empresa nesta etapa.</div>')+'</div></section>').join('')+
  '</div>'+
  '<section class="panel" style="margin-top:20px"><div class="heading"><div><h3>Desfechos comerciais</h3><p>Referência média por site: R$ '+esc(salesResults?.priceReferenceBrl||550)+' · Proposta final depende do escopo.</p></div></div>'+
   (salesResults?.items?.length?salesResults.items.slice(0,8).map(x=>
    '<div class="kanban-lead" style="margin-bottom:8px"><div class="kanban-lead-top"><div><strong>'+esc(x.business)+'</strong><small>'+esc(({INTERESTED:'Interessado',NO_INTEREST:'Sem interesse',OPT_OUT:'Não contatar',HUMAN_REVIEW:'Revisão humana',CLOSED_WON:'Venda confirmada'})[x.status]||x.status)+'</small></div></div><p>'+esc(x.summary)+'</p>'+
    (x.phone?'<a class="kanban-message" target="_blank" rel="noopener noreferrer" href="https://wa.me/'+encodeURIComponent(x.phone)+'">Abrir conversa ↗</a>':'')+'</div>').join(''):'<p>Nenhum desfecho comercial confirmado ainda.</p>')+
  '</section></div>';
}

function handoffFor(chosen){
 const status=chosen?.handoff||{};
 return {manualTakeover:status.manualTakeover===true||(!chosen?.handoff&&chosen?.manual_takeover===1),
  canTakeover:status.canTakeover===true,canDeliverToAi:status.canDeliverToAi===true,
  reason:status.reason||'UNKNOWN'};
}
function chatHandoffButton(chosen){
 const status=handoffFor(chosen);
 const deliver=status.manualTakeover;
 const enabled=status.canTakeover&&(!deliver||status.canDeliverToAi)&&!handoffPending;
 const label=deliver?'Entregar para IA':'Assumir conversa';
 const tooltip=enabled?label:status.reason==='OWNER_PRIVATE'?'O proprietário utiliza um canal especial; a IA comercial não pode assumir':
  deliver?'A IA não está habilitada para este contato':'A transferência não está disponível para esta conversa';
 return '<button type="button" class="chat-handoff '+(deliver?'ai-mode':'human-mode')+'" data-action="toggle-chat-handoff" '+(enabled?'':'disabled')+
  ' title="'+esc(tooltip)+'" aria-label="'+esc(label)+'" aria-pressed="'+(status.manualTakeover?'true':'false')+'">'+
  (handoffPending?'Alterando...':label)+'</button>';
}
function conversations(){
 const local=state?.threads||[];const ids=new Set(remoteChats.map(t=>t.phone));const threads=[...remoteChats,...local.filter(t=>!ids.has(t.phone))].filter(t=>!chatFilter||[t.name,t.business,t.phone].some(v=>String(v||"").toLowerCase().includes(chatFilter.toLowerCase())));
 if((!selectedThread||!threads.some(t=>t.id===selectedThread))&&threads.length)selectedThread=threads[0].id;
 const chosen=threads.find(t=>t.id===selectedThread)||null;
 const bubble=messages.map(m=>'<div class="bubble-wrap '+(m.direction==="out"?"out":"in")+'"><div class="bubble">'+esc(m.body||"[Mídia]")+'<small>'+stamp(m.at)+' · '+esc(m.direction==="out"?"Enviada":"Recebida")+'</small></div></div>').join("");
 return '<section class="chats"><div class="chat-list"><div class="chats-title"><div><h3>Mensagens</h3><p>'+threads.length+' conversas</p></div><span class="small-pill">WhatsApp</span></div><input id="chat-search" class="field" placeholder="Buscar conversa..." value="'+esc(chatFilter)+'">'+(threads.length?threads.map(t=>'<button data-thread="'+esc(t.id)+'" class="chat-person '+(selectedThread===t.id?"selected":"")+'"><span class="avatar">'+esc((t.name||t.business||"?")[0])+'</span><span class="info"><strong>'+esc(t.name||t.business||t.phone)+'</strong><small>'+esc(t.phone||"")+'</small>'+(t.contactRole?'<small class="contact-role-tag">'+esc(({OWNER:'Proprietário',EXISTING_CLIENT:'Cliente existente',PROSPECT_APPROACHED:'Abordado',INBOUND_NEW:'Novo contato',UNVERIFIED:'Não verificado'})[t.contactRole]||'Não verificado')+'</small>':'')+'</span><time>'+stamp(t.last_message_at)+'</time></button>').join(""):'<div class="empty">Suas conversas aparecerão aqui quando chegarem mensagens.</div>')+'</div><div class="chat-panel">'+(chosen?'<div class="chat-heading"><span class="avatar">'+esc((chosen.name||chosen.business)[0])+'</span><div><strong>'+esc(chosen.name||chosen.business)+'</strong><small>'+esc(chosen.phone||"")+'</small>'+(chosen.contactRole?'<small class="contact-role-tag">'+esc(({OWNER:'Proprietário',EXISTING_CLIENT:'Cliente existente',PROSPECT_APPROACHED:'Abordado pelo Prospector',INBOUND_NEW:'Novo contato',UNVERIFIED:'Não verificado'})[chosen.contactRole]||'Não verificado')+'</small>':'')+'</div>'+chatHandoffButton(chosen)+'</div><div class="message-feed" id="messages">'+(bubble||'<p class="empty">Carregando mensagens...</p>')+'</div>'+'<form class="composer" id="send-form"><input id="chat-text" autocomplete="off" maxlength="1500" placeholder="Escreva uma mensagem..." aria-label="Mensagem"><button class="primary" type="submit">Enviar ↗</button></form>':'<div class="chat-blank"><div class="big-icon">◉</div><h3>Suas conversas, organizadas.</h3><p>Conecte o WhatsApp e receba mensagens para começar.</p><button class="primary" data-tab="connections">Conectar WhatsApp</button></div>')+'</div></section>';
}

const formatDay=d=>new Date(d+'T12:00:00Z').toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric',timeZone:'UTC'});
function monthTitle(month){
 const [y,m]=month.split('-').map(Number);
 return new Date(Date.UTC(y,m-1,1)).toLocaleDateString('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'});
}
function changeMonth(delta){
 const [y,m]=calendarMonth.split('-').map(Number),date=new Date(Date.UTC(y,m-1+delta,1));
 calendarMonth=date.toISOString().slice(0,7);calendarDetail=null;
}
function prospectingCalendarView(){
 const data=calendarData||{days:[],totals:{approached:0,closed:0,conversionRate:null}},[y,m]=calendarMonth.split('-').map(Number);
 const start=new Date(Date.UTC(y,m-1,1)).getUTCDay(),count=new Date(Date.UTC(y,m,0)).getUTCDate();
 const map=new Map(data.days.map(d=>[d.day,d]));
 const cells=Array.from({length:start},()=>'<div class="prospect-calendar-blank" aria-hidden="true"></div>');
 for(let d=1;d<=count;d++){
  const key=calendarMonth+'-'+String(d).padStart(2,'0'),x=map.get(key)||{approached:0,closed:0,conversionRate:null};
  cells.push('<button class="prospect-day '+(calendarDetail?.day===key?'selected':'')+'" type="button" data-action="calendar-day" data-day="'+key+'" aria-label="'+formatDay(key)+': '+x.approached+' abordagens, '+x.closed+' vendas confirmadas"><span class="prospect-day-number">'+d+'</span><span class="prospect-day-stat"><b>'+x.approached+'</b> abordadas</span><span class="prospect-day-stat"><b>'+x.closed+'</b> fechadas</span><span class="prospect-day-rate">'+(x.conversionRate==null?'—':x.conversionRate.toLocaleString('pt-BR')+'%')+'</span></button>');
 }
 const totals=data.totals;
 return '<section class="panel prospect-calendar"><div class="heading"><div><span class="kicker">DESEMPENHO COMERCIAL</span><h2>Calendário de prospecção</h2><p>Veja abordagens aceitas pelo canal, fechamentos confirmados e acompanhamento diário.</p></div><div class="month-actions"><button class="secondary compact" data-action="calendar-prev" aria-label="Mês anterior">‹</button><strong>'+esc(monthTitle(calendarMonth))+'</strong><button class="secondary compact" data-action="calendar-next" aria-label="Próximo mês">›</button></div></div>'+
 '<div class="calendar-summary"><div><small>Abordadas no mês</small><strong>'+Number(totals.approached)+'</strong></div><div><small>Vendas confirmadas</small><strong>'+Number(totals.closed)+'</strong></div><div><small>Índice do mês</small><strong>'+(totals.conversionRate==null?'—':Number(totals.conversionRate).toLocaleString('pt-BR')+'%')+'</strong></div></div>'+
 '<div class="prospect-cal-scroll"><div class="prospect-calendar-weekdays">'+['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(t=>'<span>'+t+'</span>').join('')+'</div><div class="prospect-calendar-grid">'+cells.join('')+'</div></div>'+
 '<p class="footnote">Índice = fechamentos confirmados no período ÷ abordagens no mesmo período. É um indicador de atividade, não a conversão de uma mesma turma de empresas.</p>'+
 (calendarDetail?'<div class="calendar-details"><div class="heading"><div><h3>'+formatDay(calendarDetail.day)+'</h3><p>Consulte as empresas registradas nesta data.</p></div><button class="secondary compact" data-action="calendar-close">Fechar</button></div><div class="calendar-detail-tabs"><button type="button" class="secondary compact '+(calendarDetail.kind==='approached'?'active':'')+'" data-action="calendar-kind" data-kind="approached">Abordadas</button><button type="button" class="secondary compact '+(calendarDetail.kind==='closed'?'active':'')+'" data-action="calendar-kind" data-kind="closed">Fechadas</button></div>'+(calendarDetail.items?.length?'<div class="calendar-company-list">'+calendarDetail.items.map(item=>'<div><span><strong>'+esc(item.business)+'</strong><small>'+esc(item.city||'Local não informado')+' · '+stamp(item.at)+'</small></span><span class="tag '+(calendarDetail.kind==='closed'?'green':'')+'">'+(calendarDetail.kind==='closed'?'Venda confirmada':'Abordagem aceita')+'</span></div>').join('')+'</div>':'<div class="empty"><p>Nenhuma empresa registrada nesta categoria neste dia.</p></div>')+'</div>':'')+'</section>';
}
function prospecting(){
 const automatic=approachQueue?.automaticEnabled===true;
 return '<div class="prospect-simple prospect-smart-view"><section class="panel prospect-auto-panel"><div class="heading"><div><span class="kicker">PROSPECÇÃO INTELIGENTE</span><h2>Escolha onde a IA deve pesquisar.</h2><p>O Prospector pesquisa empresas a partir das 5h. Você escolhe a área de atuação e o sistema prepara as oportunidades.</p></div><span class="tag '+(automatic?'green':'')+'">'+(automatic?'Abordagem automática configurada':'Pesquisa e qualificação')+'</span></div>'+
 '<form id="prospect-preference-form" class="prospect-preference-form"><div class="prospect-modes">'+
 [['all','Todos os nichos','Pesquisar categorias e cidades disponíveis'],['niche_all_cities','Um nicho, várias cidades','Selecionar um segmento em todas as cidades disponíveis'],['niche_city','Nicho e cidade','Focar a busca em uma região específica']].map(([val,title,subtitle])=>'<label class="prospect-mode '+(prospectPrefs.mode===val?'active':'')+'"><input type="radio" name="mode" value="'+val+'" '+(prospectPrefs.mode===val?'checked':'')+'><span><strong>'+title+'</strong><small>'+subtitle+'</small></span></label>').join('')+
 '</div>'+(prospectPrefs.mode!=='all'?'<div class="prospect-preference-fields"><label>Nicho de atuação<input name="niche" list="prospect-niches" placeholder="Ex.: oficina, restaurante, dentista" required maxlength="85" value="'+esc(prospectPrefs.niche||'')+'"></label><datalist id="prospect-niches">'+(prospectPrefs.options?.segments||[]).map(t=>'<option value="'+esc(t.id)+'">'+esc(t.label)+'</option>').join('')+'</datalist>'+(prospectPrefs.mode==='niche_city'?'<label>Cidade<input name="city" list="prospect-cities" required maxlength="85" placeholder="Ex.: Sorocaba" value="'+esc(prospectPrefs.city||'')+'"></label><datalist id="prospect-cities">'+(prospectPrefs.options?.cities||[]).map(t=>'<option value="'+esc(t)+'"></option>').join('')+'</datalist>':'')+'</div>':'')+
 '<div class="prospect-preference-actions"><p>A configuração orienta a pesquisa automática. Ela não autoriza disparos para números encontrados publicamente.</p><button class="primary" type="submit">Salvar minha pesquisa</button></div></form>'+
 (approachQueue?.dailyBudget?'<div class="prospect-usage"><span>Abordagens registradas hoje</span><strong>'+approachQueue.dailyBudget.counted+' de '+approachQueue.dailyBudget.limit+'</strong></div>':'')+
 '<p class="footnote">A cobertura depende das categorias, localidades e limites das fontes disponíveis. Nem todos os nichos e cidades estão disponíveis na pesquisa atual.</p></section>'+prospectingCalendarView()+'</div>';
}
function whatsappAccountsPanel(){
 const connected=waAccounts.filter(x=>x.connected);
 const rows=waAccounts.map((item,i)=>'<article class="wa-list-row"><span class="wa-list-icon">'+glyph('connections')+'</span><div class="wa-list-info"><strong>'+esc(item.label||'WhatsApp '+(i+1))+'</strong><small>'+esc(item.phone||item.number||'Número em conexão')+'</small></div><span class="wa-list-state '+(item.connected?'online':'')+'"><span class="pulse '+(item.connected?'ok':'')+'"></span> '+(item.connected?'Conectado':'Desconectado')+'</span><button type="button" class="secondary compact" data-action="select-wa" data-session="'+esc(item.session_id)+'">'+(item.connected?'Gerenciar':'Conectar')+'</button></article>').join('');
 return '<section class="panel wa-list-panel"><div class="heading"><div><span class="kicker">CANAIS DE ATENDIMENTO</span><h2>Seus WhatsApps</h2><p>'+connected.length+' número(s) conectado(s). Nomeie os seus canais e conecte quantos precisar.</p></div><span class="tag '+(connected.length?'green':'')+'">'+connected.length+' conectados</span></div><div class="wa-list">'+(rows||'<div class="empty"><h4>Nenhum número cadastrado</h4><p>Crie seu primeiro canal para conectar o WhatsApp.</p></div>')+'</div><div class="wa-list-add"><label for="new-wa-label">Nome do novo canal</label><div><input id="new-wa-label" maxlength="70" placeholder="Ex.: Comercial, Atendimento, Vendas"><button class="primary" type="button" data-action="add-wa" '+(busy?'disabled':'')+'>+ Conectar mais um WhatsApp</button></div></div><p class="footnote">Cada conexão tem um QR Code individual. O número é associado exclusivamente a este espaço de trabalho.</p></section>';
}
function whatsappConnectModal(){
 if(!waQrOpen)return '';
 const item=waAccounts.find(x=>x.session_id===connectionSession);
 const connected=wa?.connected===true,qr=qrResult?.qr;
 return '<div class="qr-modal-backdrop" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="qr-title" class="qr-connect-modal"><button class="qr-modal-close" type="button" data-action="close-qr" aria-label="Fechar QR Code">×</button><span class="kicker">WHATSAPP / CONEXÃO SEGURA</span><h2 id="qr-title">'+esc(item?.label||'Conectar WhatsApp')+'</h2><p>Abra o WhatsApp no celular, escolha Aparelhos conectados e toque em Conectar aparelho.</p><div class="qr-connect-visual">'+(connected?'<div class="qr-success"><span>✓</span><strong>WhatsApp conectado!</strong><small>Fechando automaticamente...</small></div>':qr?'<img class="qr-image" src="'+esc(qr)+'" alt="Código QR para conectar este WhatsApp"><small>Escaneie este QR Code pelo seu celular.</small>':'<div class="qr-wait"><span class="qr-spinner" aria-hidden="true"></span><strong>Aguardando QR Code</strong><small>'+esc(qrResult?.message||'Preparando uma sessão segura para o aparelho.')+'</small></div>')+'</div><div class="qr-modal-footer"><span class="tag '+(connected?'green':'')+'">'+(connected?'Conectado':wa?.status==='SCAN_QR'?'Aguardando leitura':'Conectando...')+'</span>'+(connected?'<button class="secondary compact" data-action="disconnect">Desconectar este número</button>':'<button class="secondary compact" data-action="refresh-qr">Atualizar código</button>')+'</div>'+(connected?'':'<p class="footnote">O código muda periodicamente. Você pode fechar esta janela sem perder outros WhatsApps conectados.</p>')+'</section></div>';
}
function connections(){
 return '<div class="connections-simplified">'+whatsappAccountsPanel()+whatsappConnectModal()+'</div>';
}
function settings(){
 if(platformContext.role==='master')return masterSettings();
 const hours=state?.settings?.client_outreach_hours||{start:'08:00',end:'17:30'};
 const options=[];
 for(let minute=480;minute<=1050;minute+=15){
  const t=String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
  options.push(t);
 }
 return '<div class="workspace-head"><div><span class="kicker">PREFERÊNCIAS DA CONTA</span><h2>Configurações</h2><p>Somente o essencial para personalizar sua rotina e proteger seu acesso.</p></div></div>'+
 '<div class="client-settings-grid"><section class="panel settings-hours"><span class="kicker">HORÁRIO DE ABORDAGENS</span><h3>Quando a operação pode iniciar conversas?</h3><p>A pesquisa de empresas pode começar às 5h. As primeiras abordagens seguem a janela comercial definida abaixo.</p><form id="client-hours-form" class="settings-simple-form"><div class="hours-pair"><label>Início das abordagens<select name="start">'+options.filter(t=>t<='17:00').map(t=>'<option value="'+t+'" '+((hours.start||'08:00')===t?'selected':'')+'>'+t+'</option>').join('')+'</select></label><label>Final das abordagens<select name="end">'+options.filter(t=>t>='08:30').map(t=>'<option value="'+t+'" '+((hours.end||'17:30')===t?'selected':'')+'>'+t+'</option>').join('')+'</select></label></div><button class="primary">Salvar horário</button></form><p class="footnote">Horário de Brasília · A escolha pode restringir a janela de 08:00 a 17:30, nunca ampliá-la. Respostas a mensagens recebidas não seguem esta janela de primeiras abordagens.</p></section>'+
 '<section class="panel settings-account"><span class="kicker">SEGURANÇA DA SUA CONTA</span><h3>E-mail e senha</h3><p>Para alterar seus dados, confirme a senha atual. Outras sessões serão encerradas.</p><form id="account-profile" class="settings-simple-form"><label>Novo e-mail<input type="email" name="newEmail" required maxlength="200" autocomplete="email" value="'+esc(platformContext.email||'')+'"></label><label>Senha atual<input type="password" name="currentPassword" required maxlength="128" autocomplete="current-password"></label><label>Nova senha <small>(opcional)</small><input type="password" name="newPassword" minlength="10" maxlength="128" autocomplete="new-password" placeholder="Deixe vazio para manter a senha"></label><button class="primary">Atualizar minha conta</button></form></section></div>'+
 '<section class="panel settings-utilities"><div><span class="kicker">ACESSOS RÁPIDOS</span><h3>Gerencie sua operação</h3><p>As conexões, a inteligência e os créditos ficam em suas próprias áreas, sem opções técnicas desnecessárias.</p></div><div class="actions"><button class="secondary" data-tab="connections">WhatsApps conectados</button><button class="secondary" data-tab="training">Treinamento da IA</button><button class="secondary" data-tab="credits">Meus créditos</button></div></section>';
}
function render(){
 shell();
 const el=q("#view");
 el.innerHTML={clients:clientsView,overview,conversations,prospects:prospecting,connections,training:trainingView,credits:creditsView,settings}[view]();
 if(view==="conversations"&&selectedThread)loadMessages(selectedThread);
 if(view==="connections"&&!wa)refreshWa(false);
}
async function refreshWa(redraw=true){
 if(platformContext.role==="master")return;
 if(waRefreshing)return waRefreshing;
 waRefreshing=(async()=>{
  try{
   if(view==='connections'){
    const pool=await api('/api/whatsapp/sessions').catch(()=>({items:[]}));
    waAccounts=Array.isArray(pool.items)?pool.items:[];
    if(!connectionSession&&waAccounts.length)connectionSession=waAccounts[0].session_id;
   }
   const w=await api("/api/whatsapp/status"+(view==='connections'?waSessionQuery():''));
   const wasConnected=!!wa?.connected;
   const changed=!wa||wa.connected!==w.connected||wa.status!==w.status||wa.ok!==w.ok||wa.transportStale!==w.transportStale;
   const oldQr=qrResult?.qr||null;wa=w;
   if(w.connected){
    qrResult=null;
    if(waQrOpen&&!waQrConnectedAt){
     waQrConnectedAt=Date.now();
     setTimeout(()=>{
      if(waQrOpen&&wa?.connected&&Date.now()-waQrConnectedAt>=2000){
       waQrOpen=false;waQrConnectedAt=0;render();n('WhatsApp conectado com sucesso.');
      }
     },2300);
    }
   }else waQrConnectedAt=0;
   if(!w.connected&&view==="connections"&&w.hasSession&&["SCAN_QR","CONNECTING","INITIALIZING"].includes(w.status)){
    qrResult=await api("/api/whatsapp/qr"+waSessionQuery()).catch(e=>({qr:null,message:e.message}));
   }else if(view==="connections")qrResult=null;
   if(redraw&&(changed||(view==="connections"&&oldQr!==(qrResult?.qr||null))))render();
   if(view==="conversations"&&w.connected&&(!wasConnected||!remoteChats.length))await loadChats();
  }catch(e){
   const changed=wa?.ok!==false||wa?.message!==e.message;
   wa={ok:false,status:"ERROR",message:e.message,connected:false};
   qrResult=null;
   if(redraw&&changed)render();
  }
 })().finally(()=>{waRefreshing=null});
 return waRefreshing;
}
async function openWhatsappQr(){
 if(qrOpening)return;
 qrOpening=true;waQrOpen=true;waQrConnectedAt=0;
 if(view!=='connections')nav('connections');else render();
 q('.qr-modal-close')?.focus();
 try{
  await post('/api/whatsapp/connect',{sessionId:connectionSession||undefined});
  await refreshWa();
 }catch(error){qrResult={qr:null,message:error.message};n('Falha ao conectar: '+error.message);}
 finally{qrOpening=false;render();}
}
async function refreshAI(){try{ai=await api("/api/ai/status");if(view==="settings")render();}catch{}}
async function refreshConsentPolicy(){
 try{consentPolicy=await api('/api/outreach/consent-policy');if(view==='settings')render();}
 catch(e){consentPolicy={enforced:true,canDisable:false,policyStatus:'UNKNOWN',message:'Não foi possível verificar a política. A proteção permanece ativa.',policyUrl:'https://whatsappbusiness.com/policy/'};if(view==='settings')render();}
}
async function refreshVoiceMetrics(){try{voiceMetrics=await api('/api/ai/voice-metrics');if(view==='settings')render();}catch{voiceMetrics=null;}}
async function loadChats(){
 if(!wa?.connected){remoteChats=[];if(view==="conversations")render();return;}
 try{const r=await api("/api/whatsapp/chats");remoteChats=Array.isArray(r.items)?r.items:[];if(view==="conversations")render();}
 catch(e){n("Não foi possível sincronizar o histórico do WhatsApp: "+e.message);}
}
function parseMapsCSV(source){
 const text=String(source||"").replace(/^\uFEFF/,"");
 const headerLine=text.split(/\r?\n/,1)[0]||"";
 const delimiter=(headerLine.match(/;/g)||[]).length>=(headerLine.match(/,/g)||[]).length?";":",";
 let rows=[],row=[],field="",quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(ch==='"'){
   if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;
  }else if(ch===delimiter&&!quoted){row.push(field);field="";}
  else if((ch==='\n'||ch==='\r')&&!quoted){
   if(ch==='\r'&&text[i+1]==='\n')i++;
   row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field="";
  }else field+=ch;
  if(rows.length>10000)throw Error('Limite de 10 mil registros por arquivo');
 }
 if(quoted)throw Error('CSV contém aspas não fechadas');
 row.push(field);if(row.some(x=>x.trim()))rows.push(row);
 if(rows.length<2)throw Error('O arquivo não contém linhas de dados');
 const headers=rows.shift().map(x=>x.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase());
 const index=(name)=>headers.indexOf(name);
 if(index('nome')<0)throw Error('Coluna Nome não encontrada');
 const value=(row,name)=>index(name)>=0?String(row[index(name)]||"").trim():"";
 const safeUrl=(str,scope)=>{try{const u=new URL(str);if(!['https:','http:'].includes(u.protocol))return "";if(scope==='maps'&&!(/(^|\.)google\.[a-z.]+$/i.test(u.hostname)||u.hostname==='maps.app.goo.gl'))return "";return u.href.slice(0,500);}catch{return ""}};
 const results=[];let skipped=0;
 for(const r of rows){
  const name=value(r,'nome').slice(0,120);
  const p=value(r,'telefonenormalizado')||value(r,'telefone');
  const digits=p.replace(/\D/g,'');
  const mapsUrl=safeUrl(value(r,'linkmaps'),'maps');
  if(!name||(!([10,11,12,13,14,15].includes(digits.length))&&!mapsUrl)){skipped++;continue;}
  const site=safeUrl(value(r,'site'),'website');
  const address=value(r,'endereco').slice(0,250);
  results.push({business:name,source:'maps_extension',maps_id:mapsUrl||undefined,phone:digits||undefined,website:site||undefined,website_status:'UNCERTAIN',city:value(r,'cidade').slice(0,80)||null,segment:value(r,'categoria').slice(0,120)||null,contact_permission:false,notes:['Endereço: '+address,'Termo: '+value(r,'termo'),'Google Maps: '+mapsUrl].filter(Boolean).join(' | ').slice(0,700),collected_at:value(r,'datacoleta')||null});
 }
 return {results,skipped,total:rows.length};
}


async function importMapsCSV(){
 const file=q("#maps-csv")?.files?.[0];
 if(!file)throw Error("Escolha um arquivo CSV primeiro");
 if(file.size>3*1024*1024)throw Error("Arquivo maior que 3 MB. Divida a exportação");
 const rows=parseMapsCSV(await file.text()).results;
 if(rows.length===0)throw Error("O arquivo não contém empresas válidas");
 if(!confirm("Importar "+rows.length+" empresas sem autorizar envios automáticos?"))return;
 let created=0,errors=[];
 for(let i=0;i<rows.length;i+=180){
  const r=await post("/api/import",{leads:rows.slice(i,i+180)});
  created+=r.created||0;errors.push(...(r.errors||[]));
 }
 n(created+" empresas novas importadas; "+(rows.length-created)+" duplicadas ou não aceitas.");
 await loadProspects();
}

async function updateMapsJob(){
 if(!mapsJob?.id||["IMPORTED","FAILED"].includes(mapsJob.status)||mapsPolling)return;
 const pollingId=mapsJob.id;
 mapsPolling=true;
 try{const updated=await api("/api/maps/job?id="+encodeURIComponent(pollingId));if(mapsJob?.id!==pollingId)return;mapsJob=updated;
 if(updated.status==='COMPLETED'){
  const out=await post('/api/maps/import',{id:updated.id});if(mapsJob?.id!==pollingId)return;mapsJob={...updated,status:'IMPORTED',added:out.added};
  n('Google Maps: '+Number(out.added||0)+' empresas novas salvas. Selecione e clique Abordar para aprovar contatos.');
  await loadProspects();
 }
 if(updated.status==="FAILED")n("O scraper não concluiu esta pesquisa.");if(view==="prospects")render();}catch(e){mapsJob={...mapsJob,error:e.message};n("Scraper: "+e.message);if(view==="prospects")render();}finally{mapsPolling=false;}
}
function startMapsPolling(){
 if(mapsTimer)clearInterval(mapsTimer);
 mapsTimer=setInterval(async()=>{if(!mapsJob||["IMPORTED","FAILED"].includes(mapsJob.status)){clearInterval(mapsTimer);mapsTimer=null;return;}await updateMapsJob();},12000);
}
async function loadProspects(){
 prospectLoading=true;
 try{
  const params=new URLSearchParams({niche,city,status:prospectFilter,session:prospectSession});
  const [base,queue,maps]=await Promise.all([api("/api/prospecting?"+params.toString()),api("/api/prospecting/queue").catch(()=>null),api("/api/maps/status").catch(()=>null)]);
  prospects=base;
  approachQueue=queue;
  mapsResearch=maps;
  if(view==="prospects")render();
 }catch(e){prospectError=e.message;if(view==="prospects")render();n(e.message);}finally{prospectLoading=false;}
}
async function loadMessages(id){
 try{
  const items=id.startsWith("wa:")?await api("/api/whatsapp/chat-messages?jid="+encodeURIComponent(id.slice(3))):await api("/api/threads/"+encodeURIComponent(id)+"/messages");
  if(selectedThread!==id||view!=="conversations")return;
  messages=Array.isArray(items)?items:[];
  const feed=q("#messages");if(!feed)return;
  feed.innerHTML=messages.length?messages.map(m=>'<div class="bubble-wrap '+(m.direction==="out"?"out":"in")+'"><div class="bubble">'+esc(m.body||"[Mídia]")+'<small>'+stamp(m.at)+'</small></div></div>').join(""):'<div class="empty">Nenhuma mensagem nesta conversa.</div>';
  feed.scrollTop=feed.scrollHeight;
  if(!id.startsWith("wa:"))await post("/api/threads/"+encodeURIComponent(id)+"/read",{}).catch(()=>{});
 }catch(e){const feed=q("#messages");if(feed)feed.textContent="Não foi possível carregar a conversa.";}
}
async function loadKanban(){try{kanban=await api('/api/kanban');salesResults=await api('/api/sales/outcomes').catch(()=>null);if(view==='overview')render();}catch(e){if(view==='overview')render();n('Não foi possível carregar o Kanban: '+e.message);}}
async function reload(){
 if(!workspaceInitialized){workspaceInitialized=true;try{platformContext=await api("/api/platform/context");}catch{}if(platformContext.role!=="master"&&view==="clients")view="overview";if(platformContext.role==="master"&&(!location.hash||!["overview","clients","credits","settings"].includes(view)))view="overview";}
 try{
  if(platformContext.role==="master"){await loadClients();lastRefresh=Date.now();render();return;}
  state=await api("/api/state");lastRefresh=Date.now();
  if(view==="clients")await loadClients();else if(view==="training")await loadTraining();else if(view==="credits"){render();await loadCredits();}else if(view==="prospects")await loadProspectExperience();else if(view==="conversations")await loadChats();else if(view==="overview")await loadKanban();else render();
 }catch(e){if(!state)root.innerHTML='<main class="load-error"><h2>Não foi possível abrir o Prospector</h2><p>'+esc(e.message)+'</p><button onclick="location.reload()">Tentar novamente</button></main>';else n(e.message);}
}
document.addEventListener("click",async ev=>{
 const el=ev.target.closest("[data-tab],[data-action],[data-thread],[data-filter],[data-kanban-chat]");if(!el)return;
 if(el.dataset.kanbanChat){
  const number=String(el.dataset.kanbanChat||'').replace(/\D/g,'');
  if(!/^55\d{10,11}$/.test(number)){n('Contato sem número válido');return;}
  if(wa?.connected){
   await loadChats();
   const matching=remoteChats.find(t=>t.phone===number);
   if(matching){selectedThread=matching.id;messages=[];nav('conversations');return;}
  }
  window.open('https://wa.me/'+number,'_blank','noopener,noreferrer');
  return;
 }
 if(el.dataset.tab){q("#side")?.classList.remove("mobile-open");q(".scrim")?.classList.remove("visible");nav(el.dataset.tab);return;}
 if(el.dataset.thread){selectedThread=el.dataset.thread;messages=[];render();return;}
 if(el.dataset.filter){prospectFilter=el.dataset.filter;selectedLeadIds.clear();approachPreview=null;await loadProspects();return;}
 const action=el.dataset.action;
 try{
  if(await platformAction(action,el))return;
  if(action==="toggle-chat-handoff"){
   const chatId=selectedThread;
   const chosen=[...remoteChats,...(state?.threads||[])].find(x=>x.id===chatId);
   const current=handoffFor(chosen);
   const manual=!current.manualTakeover;
   if(handoffPending||!current.canTakeover||(!manual&&!current.canDeliverToAi))return;
   handoffPending=true;render();
   try{
    const result=await post('/api/whatsapp/handoff',{chatId,manual});
    if(chatId!==selectedThread)return;
    const target=remoteChats.find(x=>x.id===chatId)||(state?.threads||[]).find(x=>x.id===chatId);
    if(target){target.handoff=result;target.manual_takeover=result.manualTakeover?1:0;}
    n(manual?'Você assumiu a conversa. A IA não responderá automaticamente.':'Conversa entregue à IA. Ela responderá às próximas mensagens elegíveis.');
   }catch(error){n(error.message);}
   finally{handoffPending=false;render();}
   return;
  }
  if(action==='calendar-prev'||action==='calendar-next'){
   changeMonth(action==='calendar-prev'?-1:1);await loadProspectCalendar();return;
  }
  if(action==='calendar-day'){await openCalendarDetail(el.dataset.day,'approached');return;}
  if(action==='calendar-kind'){
   if(calendarDetail)await openCalendarDetail(calendarDetail.day,el.dataset.kind);return;
  }
  if(action==='calendar-close'){calendarDetail=null;render();return;}
  if(action==="refresh-kanban"){await loadKanban();n('Kanban atualizado.');return;}
  if(action==="menu"){q("#side")?.classList.toggle("mobile-open");q(".scrim")?.classList.toggle("visible");return;}
  if(action==="close-menu"){q("#side")?.classList.remove("mobile-open");q(".scrim")?.classList.remove("visible");return;}
  if(action==="refresh"){await reload();n("Dados atualizados.");return;}
  if(action==="toggle-all"){
   const available=(prospects?.results||[]).filter(p=>p.selectable);
   if(available.length&&available.every(p=>selectedLeadIds.has(p.id)))selectedLeadIds.clear();
   else for(const p of available)selectedLeadIds.add(p.id);
   render();return;
  }
  if(action==="approach-selected"){
   if(!selectedLeadIds.size){n("Selecione ao menos uma empresa.");return;}
   const preview=await post("/api/prospecting/approach-preview",{leadIds:[...selectedLeadIds],operatorApproved:true});
   if(preview.ready===0){n((preview.manualReady||0)+" empresa(s) elegíveis. Nenhuma pode entrar nesta fila agora.");return;}
   const result=await post("/api/prospecting/queue",{leadIds:[...selectedLeadIds],approve:true,operatorApproved:true,offerType});
   selectedLeadIds.clear();
   await loadProspects();
   n("Fila automática: "+result.queued+" empresa(s) selecionada(s); "+result.excluded+" excluída(s) por elegibilidade.");
   return;
  }
  if(action==="cancel-approach-queue"){
   if(!confirm("Cancelar todas as mensagens ainda não enviadas da fila?"))return;
   await post("/api/prospecting/queue/cancel",{});
   await loadProspects();
   n("Fila cancelada. Mensagens em transporte podem ter sido aceitas.");return;
  }
  if(action==="reset-filters"){niche="";city="";prospectFilter="uncontacted";selectedLeadIds.clear();approachPreview=null;prospectError="";await loadProspects();return;}
  if(action==="filter-base"){niche=q("#niche")?.value.trim()||"";city=q("#city")?.value.trim()||"";prospectFilter="uncontacted";selectedLeadIds.clear();approachPreview=null;await loadProspects();return;}
  if(action==="search-again"){q("#search-form")?.requestSubmit();return;}
  if(action==="maps-search"){const a=q("#niche")?.value.trim()||niche,b=q("#city")?.value.trim()||city;if(!a||!b){n("Preencha nicho e cidade antes de pesquisar no Google Maps.");q("#niche")?.focus();return;}niche=a;city=b;busy=true;prospectError="";prospectSession=newProspectSession();render();try{mapsJob=await post("/api/maps/search",{niche,city});n("Pesquisa enviada ao Google Maps. O processamento pode levar alguns minutos.");startMapsPolling();}catch(e){prospectError=e.message;n("Google Maps: "+e.message);}finally{busy=false;if(view==="prospects"){await loadProspects();}}return;}
  if(action==="maps-import"){if(!mapsJob?.id)return;if(!confirm("Importar as empresas desta pesquisa para sua base, sem autorizar mensagens automáticas?"))return;const out=await post("/api/maps/import",{id:mapsJob.id});mapsJob={...mapsJob,status:"IMPORTED",added:out.added};n(out.added+" empresas novas importadas e deduplicadas.");await loadProspects();return;}
  if(action==="maps-poll"){await updateMapsJob();return;}
  if(action==="import-csv"){await importMapsCSV();return;}
  if(action==='close-qr'){waQrOpen=false;waQrConnectedAt=0;render();return;}
  if(action==='refresh-qr'){await refreshWa();return;}
  if(action==="reconnect-qr"||action==="connect"){await openWhatsappQr();return;}
  if(action==='select-wa'){
   connectionSession=String(el.dataset.session||'');qrResult=null;
   const chosen=waAccounts.find(x=>x.session_id===connectionSession);
   if(chosen?.connected){wa={...wa,connected:true,status:'CONNECTED'};waQrOpen=true;waQrConnectedAt=0;render();return;}
   await openWhatsappQr();return;
  }
  if(action==='add-wa'){
   if(busy)return;
   const name=q('#new-wa-label')?.value?.trim();
   const label=name||'WhatsApp '+(waAccounts.length+1);
   busy=true;render();
   try{
    const created=await post('/api/whatsapp/sessions',{name:label});
    connectionSession=created.sessionId;qrResult=null;
    waQrOpen=true;waQrConnectedAt=0;
    await refreshWa();
    await openWhatsappQr();
    n('Canal adicionado. Escaneie o QR Code.');
   }finally{busy=false;render();}
   return;
  }
  if(action==="disconnect"){
   if(!confirm("Desconectar este WhatsApp? Será necessário escanear um novo QR Code. Os outros números continuarão conectados."))return;
   busy=true;render();
   try{
    const out=await post("/api/whatsapp/disconnect",{sessionId:connectionSession||undefined});
    if(out.verified!==true||out.connected!==false)throw Error("O gateway não confirmou o encerramento da sessão.");
    qrResult=null;wa={ok:true,connected:false,status:"LOGGED_OUT",hasSession:true};
    await refreshWa();
    n("Este WhatsApp foi desconectado. Para reconectar, abra o QR Code.");
   }finally{busy=false;render();}
   return;
  }
 }catch(e){busy=false;n(e.message);render();}
});
document.addEventListener("keydown",ev=>{
 if(ev.target?.id==="chat-text"&&ev.key==="Enter"&&!ev.isComposing){ev.preventDefault();q("#send-form")?.requestSubmit();}
});
document.addEventListener("submit",async ev=>{
 ev.preventDefault();
 if(await platformSubmit(ev))return;

 if(ev.target.id==='prospect-preference-form'){
  const data=Object.fromEntries(new FormData(ev.target));
  try{
   const result=await post('/api/prospecting/preferences',{mode:data.mode,niche:data.niche||'',city:data.city||''});
   prospectPrefs={...prospectPrefs,...result};
   n('Preferência de pesquisa salva. A próxima busca automática seguirá essa configuração.');
  }catch(e){n(e.message);}
  render();return;
 }
 if(ev.target.id==="search-form"){
  ev.preventDefault();
  const a=q("#niche")?.value.trim(),b=q("#city")?.value.trim();
  if(!a||!b){n("Informe um nicho e uma cidade para pesquisar. Para navegar na base, use Filtrar base.");return;}
  niche=a;city=b;selectedLeadIds.clear();approachPreview=null;prospectFilter='uncontacted';busy=true;prospectError="";render();

  try{
   const maps=await api('/api/maps/status');
   if(maps.configured){
    searchSource='maps';mapsJob=await post('/api/maps/search',{niche,city});
    n('Google Maps: pesquisa em processamento. Os resultados serão salvos automaticamente; mensagens exigem selecionar e Abordar.');
    startMapsPolling();await updateMapsJob();return;
   }
   searchSource='osm';n('Google Maps não configurado. Consultando a fonte alternativa OpenStreetMap.');
   const result=await post("/api/prospecting/search",{niche,city});
   prospectFilter="uncontacted";selectedLeadIds.clear();approachPreview=null;
   n("Pesquisa concluída. "+Number(result.added||0)+" empresas novas adicionadas à base.");
  }catch(e){
   prospectError=e.message;n((searchSource==='maps'?"Google Maps: ":"OpenStreetMap: ")+e.message);
  }finally{
   busy=false;
   if(view==="prospects"){await loadProspects();if(prospectError)render();}
  }
  return;
 }

 if(ev.target.id==="send-form"){
  ev.preventDefault();const text=q("#chat-text")?.value.trim();if(!text||!selectedThread)return;
  const btn=q('#send-form button[type="submit"]');if(btn)btn.disabled=true;
  try{const endpoint=selectedThread.startsWith("wa:")?"/api/whatsapp/reply-remote":"/api/whatsapp/reply";const data=selectedThread.startsWith("wa:")?{jid:selectedThread.slice(3),text,requestId:crypto.randomUUID()}:{threadId:selectedThread,text,requestId:crypto.randomUUID()};await post(endpoint,data);
    if(selectedThread.startsWith('wa:')){
     const updated=await api('/api/whatsapp/handoff?chatId='+encodeURIComponent(selectedThread)).catch(()=>null);
     const chosen=remoteChats.find(x=>x.id===selectedThread);
     if(chosen&&updated)chosen.handoff=updated;
    }
    const field=q("#chat-text");if(field)field.value="";
    render();await loadMessages(selectedThread);n("Mensagem enviada.");}
  catch(e){n(e.message);}finally{if(btn)btn.disabled=false;}
 }
});
document.addEventListener("change",async e=>{
 if(e.target.dataset.trainingChat){if(e.target.checked)trainingSelection.add(e.target.dataset.trainingChat);else trainingSelection.delete(e.target.dataset.trainingChat);return;}
 if(e.target.name==='mode'&&e.target.closest('#prospect-preference-form')){
  // Preserve typed niche/city before changing only visible fields.
  prospectPrefs.niche=q('#prospect-preference-form [name=niche]')?.value||prospectPrefs.niche;
  prospectPrefs.city=q('#prospect-preference-form [name=city]')?.value||prospectPrefs.city;
  prospectPrefs.mode=e.target.value;render();return;
 }
 if(e.target.name==="training-mode"){trainingMode=e.target.value;trainingAllConfirmed=false;render();return;}
 if(e.target.id==='training-all-confirm'){trainingAllConfirmed=e.target.checked;return;}
 if(e.target.id==='client-status-filter'){clientStatusFilter=e.target.value;render();return;}
 const t=e.target;
 if(t.id==='approach-offer'){offerType=t.value;return;}
 if(t.dataset?.selectLead){
  const leadId=t.dataset.selectLead;
  if(t.checked)selectedLeadIds.add(leadId);else selectedLeadIds.delete(leadId);
  approachPreview=null;render();return;
 }
 if(t.id==='s-consent-guard'){
  if(!consentPolicy?.canDisable){t.checked=true;n('A Meta ainda exige autorização prévia; o controle não pode ser desligado.');return;}
  const desired=t.checked;consentPolicyBusy=true;t.disabled=true;
  try{consentPolicy=await post('/api/outreach/consent-policy',{enforced:desired});n(consentPolicy.message||'Proteção atualizada.');}
  catch(err){n(err.message);await refreshConsentPolicy();}
  finally{consentPolicyBusy=false;if(view==='settings')render();}
  return;
 }
 if(t.id==="s-paused"||t.id==="s-discovery"||t.id==="s-autonomous"){
  const key=t.id==="s-paused"?"paused":t.id==="s-autonomous"?"autonomous_outreach_enabled":"discovery_auto_enabled";
  try{await post("/api/settings",{[key]:t.checked});n("Configuração salva.");await reload();}
  catch(err){t.checked=!t.checked;n(err.message);}
 }
});
document.addEventListener("input",e=>{
 if(e.target.id==='client-search'){
  clientSearch=e.target.value;const cursor=e.target.selectionStart;render();
  const input=q('#client-search');if(input){input.focus();input.setSelectionRange(cursor,cursor);}return;
 }
 if(e.target.id==="chat-search"){
  chatFilter=e.target.value;const cursor=e.target.selectionStart;render();
  const input=q("#chat-search");if(input){input.focus();input.setSelectionRange(cursor,cursor);}
 }
});
window.addEventListener("hashchange",()=>{const tab=location.hash.split("/")[1];if(tabs[tab]&&tab!==view)nav(tab);});
setInterval(async()=>{
 if(document.hidden)return;
 // Always check gateway, even when an input is focused or another tab is open.
 await refreshWa();
 if(busy||q("input:focus,textarea:focus,select:focus"))return;
 if(trainingBusy)return;
 if(view==="training"){await loadTraining();return;}
 if(view==="conversations"&&Date.now()-lastRefresh>24000)await reload();
 else if(Date.now()-lastRefresh>45000&&state)await reload();
},7000);
// A QR popup needs more frequent status updates than the ordinary dashboard.
setInterval(()=>{if(waQrOpen&&!document.hidden&&!waRefreshing)refreshWa();},1600);
document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&waQrOpen){waQrOpen=false;waQrConnectedAt=0;render();}});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshWa()});
window.addEventListener("online",()=>refreshWa());
await reload();
await refreshWa();
