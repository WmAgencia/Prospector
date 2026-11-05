// Prospector: five focused views. Deliberately no legacy campaign modules.
const q=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const stamp=d=>d?new Date(d).toLocaleString("pt-BR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
const tabs={clients:"Clientes",overview:"Visão geral",conversations:"Conversas",prospects:"Prospecção",connections:"Conexões",training:"Treinamento da IA",credits:"Créditos",settings:"Configurações"};
let platformContext={role:"client",name:"Meu espaço"},clientList=[],creditState=null,creditRequests=[],clientSearch="",clientStatusFilter="all",trainingState=null,trainingChats=[],trainingSelection=new Set(),trainingMode="selected",trainingAllConfirmed=false,trainingBusy=false,clientAccess="";
let workspaceInitialized=false;
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
let waAccounts=[],connectionSession='';
const waSessionQuery=()=>connectionSession?'?sessionId='+encodeURIComponent(connectionSession):'';
let waRefreshing=null,qrOpening=false;
function whatsappNotice(){
 if(platformContext.role==="master")return "";
 if(!wa||wa.connected)return "";
 const unknown=wa.ok===false;
 const scanning=wa.status==="SCAN_QR";
 const title=unknown?"Não foi possível verificar o WhatsApp":scanning?"WhatsApp aguardando leitura do QR Code":"WhatsApp desconectado";
 const detail=unknown?"Confira a conexão com o gateway. Os envios automáticos não devem ser retomados antes da confirmação.":
  scanning?"Escaneie o QR Code para restabelecer a conexão.":
  "Reconecte o WhatsApp para voltar a receber e enviar mensagens.";
 return '<section class="wa-global-alert" role="alert" aria-label="Status do WhatsApp"><div class="wa-alert-mark" aria-hidden="true">!</div><div class="wa-alert-copy"><strong>'+esc(title)+'</strong><span>'+esc(detail)+'</span></div><button class="wa-alert-action" type="button" data-action="reconnect-qr">'+(scanning?"Abrir QR Code":"Reconectar / QR Code")+'</button></section>';
}
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

function nav(viewName){if(platformContext.role==="master"&&!["overview","clients","credits","settings"].includes(viewName))viewName="overview";if(viewName==="clients"&&platformContext.role!=="master")viewName="overview";if(!tabs[viewName])viewName="overview";view=viewName;location.hash="/"+view;render();if(platformContext.role==="master"){if(view==="clients"||view==="overview")loadClients();return;}if(view==="connections"){if(!qrOpening)refreshWa();}if(view==="prospects")loadProspects();if(view==="conversations")loadChats();if(view==="overview")loadKanban();if(view==="clients")loadClients();if(view==="training")loadTraining();if(view==="credits")loadCredits();if(view==="settings"){refreshAI();refreshVoiceMetrics();refreshConsentPolicy();}}

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
 root.innerHTML='<div class="shell"><div class="scrim" data-action="close-menu"></div><aside id="side" class="side" aria-label="Menu principal"><div class="brand"><span class="brand-mark">p<span>.</span></span><div><strong>prospector<span class="accent">.</span></strong><small>BY CONSECOM BRASIL</small></div><button class="side-close" data-action="close-menu" aria-label="Fechar menu">'+glyph('close')+'</button></div><div class="side-label">WORKSPACE</div><nav aria-label="Navegação principal">'+Object.entries(tabs).filter(([key])=>platformContext.role==="master"?["overview","clients","credits","settings"].includes(key):key!=="clients").map(([key,label])=>'<button type="button" class="nav '+(view===key?'active':'')+'" data-tab="'+key+'" title="'+esc(label)+'" aria-label="'+esc(label)+'" '+(view===key?'aria-current="page"':'')+'>'+glyph(key)+'<span>'+label+'</span>'+(view===key?'<span class="nav-indicator"></span>':'')+'</button>').join('')+'</nav><div class="side-spacer"></div><div class="side-panel"><span class="side-panel-label">STATUS DA OPERAÇÃO</span><div class="side-status"><span class="pulse '+(connected?'ok':'')+'"></span><div><strong>'+(platformContext.role==='master'?'Painel master':connected?'WhatsApp conectado':'WhatsApp pendente')+'</strong><small>'+(platformContext.role==='master'?'Gestão de clientes e acessos':connected?'Sessão sincronizada':'Confira em Conexões')+'</small></div></div><p>'+(platformContext.role==='master'?'Abra uma conta de cliente para acessar sua operação.':'Acompanhe conexões, conversas e oportunidades.')+'</p></div><div class="side-footer"><span class="brand-min">C.</span><div><strong>'+esc(platformContext.name)+'</strong><small>'+(platformContext.role==='master'?'Painel master':'Espaço do cliente')+'</small></div></div></aside><div class="body"><header class="top"><div class="top-left"><button class="hamburger icon-button" data-action="menu" aria-label="Abrir menu">'+glyph('menu')+'</button><div class="top-title"><span class="eyebrow">WORKSPACE / '+esc(active.toUpperCase())+'</span><h1>'+esc(active)+'</h1></div></div>'+workspaceTabs()+'<div class="top-right"><span class="status-chip '+(connected?'online':'')+'"><span class="pulse '+(connected?'ok':'')+'"></span><span>'+(platformContext.role==='master'?'Administração':connected?'WhatsApp online':'WhatsApp offline')+'</span></span><button class="icon-button refresh-button" data-action="refresh" title="Atualizar dados" aria-label="Atualizar dados">'+glyph('refresh')+'</button><button class="account-logout" type="button" data-action="logout-client" aria-label="Sair da conta">Sair</button><span class="useravatar" aria-hidden="true">'+esc((platformContext.name||'P').trim().charAt(0).toUpperCase()||'P')+'</span></div></header><div class="main-wrap">'+(platformContext.canReturnToMaster?'<div class="workspace-return">Você está no espaço de '+esc(platformContext.name)+'. <a href="/master">Voltar ao painel master</a></div>':'')+whatsappNotice()+'<div id="notice" class="notice '+(notice?'':'hidden')+'" role="status">'+esc(notice)+'</div><main class="content" id="view" aria-label="'+esc(active)+'"></main><footer class="main-footer"><span>PROSPECTOR / CONSECOM BRASIL</span><span>Ambiente privado · Dados sob sua gestão</span></footer></div></div></div>';
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
 '<div class="credit-packages-grid">'+packs.map(p=>'<article class="credit-packet '+(p.id==='padrao'?'featured':'')+'"><div class="credit-packet-top"><span>'+esc(p.name)+'</span>'+(p.id==='padrao'?'<span class="tag green">Mais indicado</span>':'')+'</div><strong class="credit-packet-volume">'+Number(p.credits).toLocaleString('pt-BR')+'</strong><small>abordagens</small><div class="credit-packet-price">'+moneyFromCents(p.priceCents)+'</div><p>'+moneyFromCents(p.priceCents/p.credits)+' por abordagem</p><button class="primary" data-action="request-credit-package" data-package="'+esc(p.id)+'">Solicitar '+esc(p.name)+'</button></article>').join('')+'</div>'+
 '<section class="panel"><div class="heading"><div><h3>Meus pedidos de recarga</h3><p>Um pedido não é uma cobrança automática.</p></div><button class="secondary compact" data-action="refresh-credits">Atualizar</button></div>'+(requests.length?'<div class="orders-list">'+requests.slice(0,15).map(x=>'<div class="order-row"><div class="order-identity"><strong>'+Number(x.credits).toLocaleString('pt-BR')+' créditos · '+moneyFromCents(x.price_cents)+'</strong><small>'+stamp(x.created_at)+'</small></div><span class="tag '+(x.status==='APPROVED'?'green':'')+'">'+(x.status==='PENDING'?'Aguardando confirmação':x.status==='APPROVED'?'Créditos liberados':'Não aprovado')+'</span></div>').join('')+'</div>':'<div class="empty"><p>Você ainda não solicitou uma recarga.</p></div>')+'</section>'+
 '<section class="panel"><h3>Histórico de créditos</h3>'+(c.items?.length?'<div class="table-wrap"><table class="result-table"><thead><tr><th>Data</th><th>Descrição</th><th>Créditos</th></tr></thead><tbody>'+c.items.map(x=>'<tr><td>'+stamp(x.created_at)+'</td><td>'+esc(x.reason)+'</td><td class="'+(x.amount>0?'credit-positive':'')+'">'+(x.amount>0?'+':'')+esc(x.amount)+'</td></tr>').join('')+'</tbody></table></div>':'<div class="empty"><p>O extrato aparecerá depois da primeira recarga ou abordagem.</p></div>')+'</section>';
}
function trainingView(){
 const t=trainingState||{},draft=t.draft,profile=t.profile,running=t.runs?.find(x=>x.status==='RUNNING');
 return '<div class="workspace-head"><div><span class="kicker">TREINAMENTO DA IA</span><h2>Seu jeito de atender. Com a sua revisão.</h2><p>Ensine sobre a empresa e transforme exemplos reais em um perfil de atendimento.</p></div><span class="tag '+(profile?'green':'')+'">'+(profile?'Perfil aprovado':'Aguardando treinamento')+'</span></div><div class="training-steps"><span>1. Conte sobre a empresa</span><span>2. Traga exemplos ou converse</span><span>3. Revise e ative</span></div><section class="panel"><h3>Sobre sua empresa</h3><form id="training-business" class="stack-form"><label>Nome da empresa<input name="name" required maxlength="100" value="'+esc(t.business?.name||'')+'"></label><label>WhatsApp pessoal para avisos de interessados<input name="notificationPhone" type="tel" autocomplete="tel" placeholder="(11) 99999-9999" value="'+esc(t.business?.notificationPhone||'')+'"><small>Use o número em que você quer receber os avisos para assumir o fechamento.</small></label><label>Serviços, público e informações aprovadas<textarea name="description" rows="3" maxlength="4000" placeholder="O que você vende, para quem atende e quando chamar uma pessoa.">'+esc(t.business?.description||'')+'</textarea></label><button class="secondary" '+(trainingBusy?'disabled':'')+'>Salvar informações</button></form></section><div class="training-grid"><section class="panel"><div class="heading"><div><span class="kicker">APRENDER COM O WHATSAPP</span><h3>Seus exemplos de conversa</h3></div><button class="secondary compact" data-action="training-chats">Carregar conversas</button></div><p>São analisados textos enviados pela empresa nos números conectados. Escolha conversas comerciais; dados de contato são removidos dos exemplos.</p><div class="mode-options"><label><input type="radio" name="training-mode" value="selected" '+(trainingMode==='selected'?'checked':'')+'> Selecionar conversas</label><label><input type="radio" name="training-mode" value="all" '+(trainingMode==='all'?'checked':'')+'> Todas as disponíveis</label></div>'+(trainingMode==='all'?'<p class="analysis-note">Esse modo inclui todas as conversas individuais disponíveis, inclusive pessoais. Use apenas se você tem autorização para utilizar todos os históricos comerciais.</p><label class="training-all-confirm"><input id="training-all-confirm" type="checkbox" '+(trainingAllConfirmed?'checked':'')+'> Confirmo que as conversas disponíveis são comerciais e estão autorizadas para esta análise.</label>':'<div class="training-chat-list">'+(trainingChats.length?trainingChats.map(c=>'<label><input type="checkbox" data-training-chat="'+esc(c.key)+'" '+(trainingSelection.has(c.key)?'checked':'')+'><span><strong>'+esc(c.name)+'</strong><small>'+esc(c.channel)+'</small></span></label>').join(''):'<p>Carregue as conversas para escolher os exemplos.</p>')+'</div>')+'<button class="primary" data-action="training-analyze" '+(trainingBusy||running?'disabled':'')+'>'+(running?'Analisando conversas…':'Analisar e gerar relatório')+'</button><p class="footnote">A análise usa o histórico que a integração disponibiliza, com exemplos distribuídos entre as conversas escolhidas. Nada é enviado aos contatos.</p>'+(t.runs?.length?'<div class="training-history"><h4>Últimas análises</h4>'+t.runs.slice(0,3).map(r=>'<p><strong>'+esc(({RUNNING:'Em andamento',REVIEW:'Pronta para revisão',FAILED:'Não concluída'})[r.status]||r.status)+'</strong> · '+stamp(r.created_at)+(r.details?.error?'<br>'+esc(r.details.error):'')+'</p>').join('')+'</div>':'')+'</section><section class="panel training-manual"><span class="kicker">TREINAR CONVERSANDO</span><h3>Ensine do seu jeito</h3><p>Conte como abordar, o que perguntar e quando encaminhar o cliente para você.</p><div class="training-messages" role="log" aria-label="Conversa de treinamento">'+(t.chat?.length?t.chat.map(m=>'<div class="training-message '+(m.role==='user'?'sent':'received')+'"><small>'+ (m.role==='user'?'Você':'Assistente de treinamento')+'</small><p>'+esc(m.body)+'</p></div>').join(''):'<div class="training-welcome"><strong>O que seu atendimento precisa saber?</strong><p>Exemplo: “Prefiro respostas curtas. Antes de apresentar a proposta, pergunte qual é a maior dificuldade do negócio.”</p></div>')+'</div><form id="training-chat" class="training-composer"><label class="sr-only" for="training-input">Orientação para o treinamento</label><textarea id="training-input" name="text" rows="3" maxlength="3000" required placeholder="Escreva uma orientação para sua IA…"></textarea><button class="primary" '+(trainingBusy?'disabled':'')+'>'+(trainingBusy?'Preparando…':'Enviar orientação')+'</button></form></section></div><section class="panel profile-review"><div class="heading"><div><span class="kicker">REVISÃO DO GESTOR</span><h3>'+(draft?'Revise o que foi aprendido':'Perfil de atendimento')+'</h3><p>'+(draft?'Edite o relatório abaixo. Só a versão aprovada será usada nas respostas.':'O perfil aprovado aparece aqui. Novos treinamentos geram uma sugestão para sua revisão.')+'</p></div>'+(profile?'<span class="tag green">Ativo desde '+stamp(profile.at)+'</span>':'')+'</div>'+(draft?'<form id="training-approve" class="stack-form"><input type="hidden" name="id" value="'+esc(draft.id)+'"><label>Regras e padrões aprendidos<textarea name="text" rows="12" maxlength="9000" required>'+esc(draft.text)+'</textarea></label><button class="primary" '+(trainingBusy?'disabled':'')+'>Aprovar e usar este perfil</button></form>':profile?'<pre class="profile-text">'+esc(profile.text)+'</pre><button class="secondary" data-action="training-edit-profile">Editar perfil aprovado</button>':'<div class="empty"><p>Analise conversas ou envie uma orientação para criar a primeira sugestão.</p></div>')+'</section>';
}
async function loadClients(){try{const [clients,requests]=await Promise.all([api('/api/platform/clients'),api('/api/platform/credit-requests')]);clientList=clients.items||[];creditRequests=requests.items||[];if(platformContext.role==='master')render();}catch(e){n(e.message);}}
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
 if(action==='training-chats'){const r=await api('/api/training/chats');trainingChats=r.items||[];render();if(r.failures?.length)n('Não foi possível ler '+r.failures.length+' canal(is). Os demais estão disponíveis.');return true;}
 if(action==='training-edit-profile'){trainingState=await post('/api/training/edit',{});render();return true;}
 if(action==='training-analyze'){
  if(trainingBusy)return true;
  if(trainingMode==='all'&&!trainingAllConfirmed){n('Confirme que o histórico usado é comercial e autorizado antes de analisar tudo.');return true;}
  trainingBusy=true;render();
  try{await post('/api/training/analyze',{mode:trainingMode,keys:[...trainingSelection],confirmedAll:trainingMode==='all'&&trainingAllConfirmed});await loadTraining();n('Análise iniciada. O relatório aparecerá para revisão.');}finally{trainingBusy=false;render();}return true;
 }
 return false;
}
async function platformSubmit(ev){
 const id=ev.target.id;if(!['client-create','training-business','training-chat','training-approve'].includes(id))return false;
 ev.preventDefault();if(trainingBusy||busy)return true;
 const input=Object.fromEntries(new FormData(ev.target));trainingBusy=true;busy=id==='client-create';
 const button=ev.target.querySelector('button');if(button)button.disabled=true;
 try{
  if(id==='client-create'){const r=await post('/api/platform/clients',input);clientAccess=location.origin+r.accessPath;await loadClients();n('Cliente criado. Copie o link privado para compartilhar.');}
  else{trainingState=await post('/api/training/'+({ 'training-business':'business','training-chat':'chat','training-approve':'approve'})[id],input);n(id==='training-approve'?'Perfil aprovado e ativo.':'Informações de treinamento salvas.');}
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

function prospecting(){
 const d=prospects||{results:[],total:0,uncontacted:0,returned:0};
 const records=d.results||[],available=records.filter(p=>p.selectable);
 const allSelected=available.length>0&&available.every(p=>selectedLeadIds.has(p.id));
 const count=records.length,waiting=approachQueue?.waiting||0,active=!!approachQueue?.active,automatic=approachQueue?.automaticEnabled===true;
 const intelligence=mapsResearch?.intelligence||null,stock=intelligence?.stock||null,plan=intelligence?.lastPlan||null;
 return '<div class="prospect-simple">'+
  '<section class="panel"><div class="heading"><div><h2>Pesquisa inteligente</h2><p>Busca empresas sozinha desde as 5h e repõe contatos para sua seleção.</p></div><span class="tag '+(intelligence?.enabled?'green':'')+'">'+(intelligence?.enabled?'Pesquisa automática ativa':'Verificando')+'</span></div>'+
  (approachQueue?.dailyBudget?'<p class="daily-budget-label"><strong>'+approachQueue.dailyBudget.counted+' / '+approachQueue.dailyBudget.limit+'</strong> novas abordagens hoje · todos os números da operação</p>':'')+'<p class="footnote">'+(stock?'Contatos elegíveis com telefone: <strong>'+Number(stock.ready||0)+'</strong> · Meta de estoque: '+Number(stock.target||60)+'. ':'')+
  (plan?'Última prioridade: <strong>'+esc(plan.niche||'')+' em '+esc(plan.city||'')+'</strong> ('+(plan.source==='groq'?'análise comercial':'prioridade local')+').':'A inteligência comercial escolhe os nichos conforme os resultados confirmados.')+
  '</p><p class="footnote">'+(automatic?'Abordagem automática ativada · 08h às 17h30 · intervalo aleatório de 90 a 180 segundos entre novos contatos · recontato somente após três meses.':'Abordagem automática desativada. Você ainda pode escolher empresas e abordar manualmente.')+'</p></section>'+
  '<section class="panel prospect-search-simple"><div class="heading"><div><h2>Pesquisar empresas</h2><p>Informe o ramo e a cidade para encontrar oportunidades.</p></div></div>'+
  '<form id="search-form" class="search-form"><label>Ramo de atividade<input id="niche" class="field" name="niche" value="'+esc(niche)+'" placeholder="Ex.: oficina mecânica" maxlength="85" autocomplete="off"></label><label>Cidade<input id="city" class="field" name="city" value="'+esc(city)+'" placeholder="Ex.: Sorocaba" maxlength="85" autocomplete="address-level2"></label><button type="submit" class="primary" '+(busy?'disabled':'')+'>'+glyph('search')+' '+(busy?'Pesquisando...':'Pesquisar')+'</button></form>'+
  (mapsJob?'<p role="status">Google Maps: '+esc(mapsJob.status)+(mapsJob.error?' · '+esc(mapsJob.error):'')+'. A pesquisa não garante cobertura completa.</p>':'')+
  (prospectError?'<p class="prospect-search-error" role="alert">'+esc(prospectError)+'</p>':'')+'</section>'+
  '<section class="panel prospect-results-simple"><div class="heading"><div><h2>Empresas não abordadas</h2><p>'+count+' resultado'+(count===1?'':'s')+' na base'+(niche||city?' para esta pesquisa':'')+'. Selecionar todas inclui somente esta lista carregada; limite de 1000 empresas por fila. A fonte não garante todas as empresas da cidade.</p></div></div>'+
  '<label>Abordagem desta lista<select id="approach-offer" class="field">'+[['portfolio','Portfólio · referência para aprovação R$ 350'],['promotion','Oferta promocional · referência R$ 550'],['corporate','Empresa maior · referência R$ 1.500']].map(([key,label])=>'<option value="'+key+'" '+(offerType===key?'selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
  '<div class="selection-toolbar"><div class="selection-left"><button type="button" class="secondary" data-action="toggle-all" '+(available.length?'':'disabled')+'>'+glyph('check')+' '+(allSelected?'Desmarcar todas':'Selecionar todas da lista carregada')+'</button><span class="selection-count">'+selectedLeadIds.size+' selecionada'+(selectedLeadIds.size===1?'':'s')+'</span></div><button type="button" class="primary" data-action="approach-selected" '+(!selectedLeadIds.size||active?'disabled':'')+'>Abordar '+glyph('arrow')+'</button></div>'+
  (active?'<div class="prospect-queue-strip" role="status"><span>Fila de abordagens: '+waiting+' aguardando · intervalo aleatório de 90 a 180 segundos</span><button class="secondary compact" type="button" data-action="cancel-approach-queue">Cancelar fila</button></div>':'')+
  (records.length?'<div class="table-wrap"><table class="result-table"><thead><tr><th class="check-col">SEL.</th><th>EMPRESA</th><th>CIDADE / RAMO</th><th>TELEFONE</th><th>PRIMEIRA ABORDAGEM</th><th>CONTATO / CONSULTA</th></tr></thead><tbody>'+records.map(p=>
  '<tr class="'+(selectedLeadIds.has(p.id)?'selected-row':'')+'"><td><input type="checkbox" class="lead-checkbox" data-select-lead="'+esc(p.id)+'" '+(selectedLeadIds.has(p.id)?'checked':'')+' '+(p.selectable?'':'disabled')+' aria-label="Selecionar '+esc(p.business)+'"></td><td><strong>'+esc(p.business)+'</strong><small>'+esc(p.website||'')+'</small></td><td>'+esc(p.city||'—')+'<small>'+esc(p.segment||'—')+'</small></td><td>'+esc(p.phone||'Sem telefone')+'</td><td>'+esc(p.authorized?'Liberado':'Aprovar ao abordar')+'</td><td><div class="external-actions">'+(p.manual_contact_url?'<a class="secondary compact" target="_blank" rel="noopener noreferrer" href="'+esc(p.manual_contact_url)+'">WhatsApp manual ↗</a>':'')+'<a class="secondary compact" target="_blank" rel="noopener noreferrer" href="'+esc(p.maps_url||'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(p.business+' '+(p.city||'')))+'">Maps ↗</a>'+(p.instagram_url?'<a class="secondary compact" target="_blank" rel="noopener noreferrer" href="'+esc(p.instagram_url)+'">Instagram ↗</a>':'')+'</div></td></tr>'
  ).join('')+'</tbody></table></div>':'<div class="empty prospect-empty"><span class="empty-mark">'+glyph('search')+'</span><h4>Nenhuma empresa encontrada</h4><p>Pesquise um ramo e uma cidade. Se as fontes externas não responderem, a lista mostrará apenas registros já salvos.</p></div>')+
  '<p class="prospect-disclaimer">Selecionar empresas e clicar Abordar aprova somente essa lista, com intervalo aleatório de 90 a 180 segundos entre contatos. A IA continua após respostas; bloqueios e pedidos de não contato são respeitados.</p>'+
  '</section></div>';
}
function whatsappAccountsPanel(){
 return '<section class="panel wa-accounts"><div class="heading"><div><span class="kicker">CANAIS DE ATENDIMENTO</span><h3>Seus WhatsApps</h3><p>'+waAccounts.filter(x=>x.connected).length+' conectado(s) · Cada conversa permanece no número de origem.</p></div><button class="secondary compact" data-tab="training">Treinar atendimento</button></div><div class="account-grid">'+waAccounts.map((item,i)=>'<button type="button" class="account-card '+(connectionSession===item.session_id?'selected':'')+'" data-action="select-wa" data-session="'+esc(item.session_id)+'" aria-pressed="'+(connectionSession===item.session_id)+'"><span class="account-icon">'+(i+1)+'</span><span><strong>'+esc(item.label)+'</strong><small><span class="pulse '+(item.connected?'ok':'')+'"></span> '+(item.connected?'Conectado':item.status==='SCAN_QR'?'Aguardando QR Code':'Conectar número')+'</small></span><span class="account-arrow">'+glyph('arrow')+'</span></button>').join('')+'</div><div class="add-account"><input id="new-wa-label" maxlength="70" placeholder="Nome do novo WhatsApp (opcional)" aria-label="Nome do novo WhatsApp"><button class="primary" data-action="add-wa" '+(busy?'disabled':'')+'>+ Conectar mais um WhatsApp</button></div><p class="footnote">Selecione um canal para gerenciá-lo e exibir seu QR Code abaixo. O intervalo de 90 a 180 segundos é compartilhado entre os números.</p></section>';
}
function connections(){
 const connected=!!wa?.connected,status=wa?.status||"DISCONNECTED",qr=qrResult?.qr;
 return whatsappAccountsPanel()+'<section class="connect-layout"><div class="panel connect-info"><span class="kicker">INTEGRAÇÃO WHATSAPP</span><h2>Conecte seu WhatsApp em segundos.</h2><p>Você não precisa acessar outro sistema. O Prospector gera o QR Code aqui e cuida da sincronização das suas conversas.</p><div class="connection-status '+(connected?"connected":"")+'"><span class="pulse '+(connected?"ok":"")+'"></span><span><strong>'+(connected?"WhatsApp conectado":"WhatsApp não conectado")+'</strong><small>'+esc(status==="ERROR"?(wa?.message||"Falha de comunicação"):connected?"Pronto para receber conversas":"Clique em Conectar para iniciar a sessão")+'</small></span></div><div class="actions">'+(connected?'<button class="secondary" data-action="disconnect">Desconectar</button>':'<button class="primary" data-action="connect" '+(busy?"disabled":"")+'>'+(busy?"Conectando...":"Conectar WhatsApp")+'</button>')+'</div><div class="steps"><strong>Como conectar</strong><p>1. Abra o WhatsApp no celular.</p><p>2. Vá em <b>Aparelhos conectados</b> e toque em <b>Conectar aparelho</b>.</p><p>3. Escaneie o QR Code mostrado ao lado.</p></div></div><div class="panel qr-panel"><div class="qr-frame">'+(connected?'<div class="qr-placeholder"><span>✓</span><h3>WhatsApp conectado!</h3><p>Suas conversas aparecerão na aba Conversas.</p></div>':qr?'<img class="qr-image" src="'+esc(qr)+'" alt="QR Code de conexão do WhatsApp"><p>Escaneie com a câmera do WhatsApp</p>':'<div class="qr-placeholder"><span>▦</span><h3>'+esc(wa?.hasSession?"Aguardando QR Code":"Pronto para conectar")+'</h3><p>'+esc(qrResult?.message||"Clique em Conectar WhatsApp para gerar seu código.")+'</p></div>')+'</div><p class="footnote">QR temporário e protegido. As abordagens automáticas obedecem ao horário e ao intervalo aleatório de 90 a 180 segundos.</p></div></section>';
}
function settings(){
 if(platformContext.role==="master")return masterSettings();
 const s=state?.settings||{};
 const policy=consentPolicy||{enforced:true,canDisable:false,policyStatus:'OPT_IN_REQUIRED',message:'Conferindo política de mensagens…',policyUrl:'https://whatsappbusiness.com/policy/'};
 return '<section class="panel settings"><span class="kicker">PREFERÊNCIAS</span><h2>Configurações</h2><p class="intro">Opções essenciais da operação, sem ferramentas extras.</p><div class="setting-line"><div><strong>Prospecção pausada</strong><small>Não iniciar campanhas ou envios automaticamente.</small></div><label class="switch"><input id="s-paused" type="checkbox" '+(s.paused?"checked":"")+'><span></span></label></div><div class="setting-line"><div><strong>Abordagem automática</strong><small>08h às 17h30; intervalo aleatório de 90 a 180 segundos entre contatos e três meses para reabordar.</small></div><label class="switch"><input id="s-autonomous" type="checkbox" '+(s.autonomous_outreach_enabled?"checked":"")+'><span></span></label></div><div class="setting-line consent-policy-line"><div><strong>Proteção de autorização no WhatsApp</strong><small>Exige autorização antes do primeiro WhatsApp comercial. Empresas encontradas no Maps não são automaticamente autorizadas.</small><small class="consent-policy-status" role="status">'+esc(policy.enforced?'Proteção ativa':'Proteção desativada')+' · '+esc(policy.canDisable?'Controle disponível':'Aguardando mudança oficial da Meta')+'</small></div><label class="switch" title="'+esc(policy.canDisable?'Alterar proteção de consentimento':policy.message)+'"><input id="s-consent-guard" type="checkbox" aria-label="Exigir autorização antes de mensagens comerciais" '+(policy.enforced?'checked':'')+' '+(!policy.canDisable||consentPolicyBusy?'disabled':'')+'><span></span></label></div><p class="footnote consent-policy-note">'+esc(policy.message)+' <a href="'+esc(policy.policyUrl||'https://whatsappbusiness.com/policy/')+'" target="_blank" rel="noopener noreferrer">Ver política oficial</a>.</p><div class="setting-line"><div><strong>Descoberta automática</strong><small>Pesquisa pública programada no OpenStreetMap.</small></div><label class="switch"><input id="s-discovery" type="checkbox" '+(s.discovery_auto_enabled?"checked":"")+'><span></span></label></div><div class="setting-line"><div><strong>IA de conversação</strong><small>A IA continua as conversas das empresas abordadas. Valores de propostas exigem sua aprovação pelo WhatsApp.</small></div><span class="tag '+(ai?.configured?"green":"")+'">'+(ai?.configured?"Configurada":"Não configurada")+'</span></div><div class="setting-line"><div><strong>Integração WhatsApp</strong><small>Seus números conectados em um só lugar.</small></div><button class="secondary compact" data-tab="connections">Gerenciar conexão</button></div><p class="footnote">Com a abordagem automática ativada, leads elegíveis entram na fila sem seleção individual. Você pode pausar a prospecção a qualquer momento. Interessados são encaminhados ao seu WhatsApp pessoal.</p></section>'+
 '<section class="panel"><span class="kicker">FRANCISCA · VOZ</span><h2>Diagnóstico das ligações</h2>'+
 '<p class="intro">Métricas agregadas dos últimos 7 dias. Nenhuma gravação ou transcrição é salva neste painel.</p>'+
 cards([
  ['Respostas medidas',voiceMetrics?.turns??'—','Turnos concluídos'],
  ['Tempo médio',voiceMetrics?.turns?(voiceMetrics.avgMs/1000).toFixed(1)+' s':'—','Preparação das respostas e voz'],
  ['Interrupções',voiceMetrics?.interruptions??'—','Turnos cortados pelo interlocutor'],
  ['Áudio em partes',voiceMetrics?.turns?String(voiceMetrics.avgSegments)+' segmentos':'—','Média de segmentos por resposta']
 ])+
 (voiceMetrics?.turns?'<p class="footnote">Tempo médio por etapa: transcrição '+(voiceMetrics.sttMs/1000).toFixed(1)+' s · processamento '+(voiceMetrics.llmMs/1000).toFixed(1)+' s · voz '+(voiceMetrics.ttsMs/1000).toFixed(1)+' s. Transcrições incertas: '+voiceMetrics.uncertain+' · Falhas de processamento: '+voiceMetrics.failures+'.</p>':'<p class="footnote">Os indicadores aparecerão após as primeiras chamadas na nova versão.</p>')+
 '</section>';
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
   if(w.connected)qrResult=null;
   else if(view==="connections"&&w.hasSession&&["SCAN_QR","CONNECTING","INITIALIZING"].includes(w.status)){
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
 qrOpening=true;busy=true;
 nav("connections");
 try{
  await post("/api/whatsapp/connect",{sessionId:connectionSession||undefined});
  await refreshWa();
  n(wa?.connected?"WhatsApp conectado.":"Sessão iniciada. Escaneie o QR Code quando ele aparecer.");
 }catch(error){n("Não foi possível iniciar a reconexão: "+error.message);}
 finally{qrOpening=false;busy=false;render();}
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
  if(view==="clients")await loadClients();else if(view==="training")await loadTraining();else if(view==="credits"){render();await loadCredits();}else if(view==="prospects")await loadProspects();else if(view==="conversations")await loadChats();else if(view==="overview")await loadKanban();else render();
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
  if(action==="reconnect-qr"||action==="connect"){await openWhatsappQr();return;}
  if(action==='select-wa'){
   connectionSession=String(el.dataset.session||'');qrResult=null;
   await refreshWa();render();return;
  }
  if(action==='add-wa'){
   if(busy)return;
   const name=q('#new-wa-label')?.value?.trim();
   const label=name||'WhatsApp '+(waAccounts.length+1);
   busy=true;render();
   try{const created=await post('/api/whatsapp/sessions',{name:label});connectionSession=created.sessionId;qrResult=null;await refreshWa();n('WhatsApp adicionado. Escaneie o QR Code deste número.');}
   finally{busy=false;render();}
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
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshWa()});
window.addEventListener("online",()=>refreshWa());
await reload();
await refreshWa();
