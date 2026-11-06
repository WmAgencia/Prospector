// Prospector: five focused views. Deliberately no legacy campaign modules.
const q=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const stamp=d=>d?new Date(d).toLocaleString("pt-BR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
const tabs={dashboard:"Dashboard",clients:"Clientes",overview:"Visão geral",conversations:"Conversas",prospects:"Prospecção",connections:"Conexões",training:"Treinamento da IA",credits:"Créditos",settings:"Configurações"};
let platformContext={role:"client",name:"Meu espaço"},clientList=[],creditState=null,creditRequests=[],clientSearch="",clientStatusFilter="all",trainingState=null,trainingChats=[],trainingSelection=new Set(),trainingMode="selected",trainingAllConfirmed=false,trainingBusy=false,clientAccess="";
let workspaceInitialized=false,masterMetrics=null,masterCreateOpen=false;
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
let waAccounts=[],connectionSession='',waModalOpen=false,waModalCloseTimer=null;
let prospectCalendar=null,scopeInfo=null,scopeMode='all',scopeNicheInput='',scopeCityInput='',calendarDay='',calendarCategory='approached';
let trainingStep=0,trainingWizardReopen=false,trainingRecorder=null,trainingRecording=false,trainingRecordedText='';
let outreachHours={start:'08:00',end:'17:30'};
let trainingRecordTimeout=null,franciscaOpen=false,franciscaHistory=[],franciscaBusy=false,franciscaAudio=null,franciscaAudioObjectURL=null,franciscaAudioResolve=null,franciscaConversationId=crypto.randomUUID();
let franciscaVoiceActive=false,franciscaVoiceState='off',franciscaVoiceSession=null,franciscaVoiceFailure='';
let noticeTimer=null,noticeToken=0;
let calendarMonth=(()=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return parts.year+'-'+parts.month;})();
async function loadCalendar(){
 try{prospectCalendar=await api('/api/prospecting/calendar?month='+encodeURIComponent(calendarMonth));if(view==='prospects')render();}catch(e){n('Calendário indisponível: '+e.message);}
}
async function loadScope(){
 try{scopeInfo=await api('/api/prospecting/preferences');scopeMode=scopeInfo.selection?.mode||'all';scopeNicheInput=scopeInfo.selection?.niche||'';scopeCityInput=scopeInfo.selection?.city?scopeInfo.selection.city+' / SP':'';if(view==='prospects')render();}catch(e){n(e.message);}
}
function moveCalendar(delta){
 const [y,m]=calendarMonth.split('-').map(Number),next=new Date(Date.UTC(y,m-1+delta,1));
 calendarMonth=next.toISOString().slice(0,7);calendarDay='';loadCalendar();
}

const waSessionQuery=()=>connectionSession?'?sessionId='+encodeURIComponent(connectionSession):'';
let waRefreshing=null,qrOpening=false;
function whatsappNotice(){return '';}
function n(msg){
 // Alerts are ephemeral: newer messages replace and restart the timeout.
 notice=String(msg||'');const id=++noticeToken;
 if(noticeTimer){clearTimeout(noticeTimer);noticeTimer=null;}
 const el=q('#notice');
 if(el){el.textContent=notice;el.classList.toggle('hidden',!notice);el.setAttribute('role',notice?'status':'none');}
 if(notice)noticeTimer=setTimeout(()=>{
  if(noticeToken!==id)return;
  notice='';noticeTimer=null;
  const current=q('#notice');
  if(current){current.textContent='';current.classList.add('hidden');current.setAttribute('role','none');}
 },4300);
}
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

function nav(viewName){if(view==='training'&&viewName!=='training')interviewStopVoice();n('');if(platformContext.role==="master"&&!["dashboard","clients","credits","settings"].includes(viewName))viewName="overview";if((viewName==="clients"||viewName==="dashboard")&&platformContext.role!=="master")viewName="overview";if(!tabs[viewName])viewName=platformContext.role==="master"?"dashboard":"overview";if(viewName==="overview"&&platformContext.role==="master")viewName="dashboard";view=viewName;location.hash="/"+view;render();if(platformContext.role==="master"){if(view==="clients")loadClients();if(view==="dashboard")loadMasterMetrics();return;}if(view==="connections"){if(!qrOpening)refreshWa();}if(view==="prospects"){loadCalendar();loadScope();}if(view==="conversations")loadChats();if(view==="overview")loadKanban();if(view==="clients")loadClients();if(view==="training")loadTraining();if(view==="credits")loadCredits();if(view==="settings")loadOutreachHours();}

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
function workspaceTabs(){return '<nav class="workspace-tabs" aria-label="Seções do painel">'+Object.entries(tabs).filter(([key])=>platformContext.role==='master'?['dashboard','clients','credits','settings'].includes(key):!['dashboard','clients'].includes(key)).map(([key,label])=>'<button data-tab="'+key+'" class="'+(view===key?'active':'')+'" '+(view===key?'aria-current="page"':'')+'>'+esc(label)+'</button>').join('')+'</nav>';}
function activationModal(){
 if(!platformContext.needsPasswordSetup||platformContext.role==='master')return '';
 return '<div class="master-modal-backdrop" role="presentation"><section class="master-client-modal invite-activation-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title"><span class="kicker">PRIMEIRO ACESSO / PROSPECTOR</span><h2 id="invite-title">Proteja sua conta</h2><p>Seu acesso foi criado. Defina uma senha para entrar normalmente por e-mail ou WhatsApp no futuro.</p><form id="activate-account" class="stack-form"><label>Nova senha<input type="password" name="password" minlength="10" maxlength="128" required autocomplete="new-password" placeholder="Ao menos 10 caracteres"></label><label>Repita a senha<input type="password" name="confirmPassword" minlength="10" maxlength="128" required autocomplete="new-password" placeholder="Confirme sua senha"></label><button class="primary" type="submit">Ativar meu login</button></form><p class="footnote">Por segurança, seu convite inicial será invalidado assim que a senha for definida.</p></section></div>';
}
function shell(){
 const active=tabs[view]||tabs.overview,connected=!!wa?.connected;
 root.innerHTML='<div class="shell"><div class="scrim" data-action="close-menu"></div><aside id="side" class="side" aria-label="Menu principal"><div class="brand"><span class="brand-mark">p<span>.</span></span><div><strong>prospector<span class="accent">.</span></strong><small>BY CONSECOM BRASIL</small></div><button class="side-close" data-action="close-menu" aria-label="Fechar menu">'+glyph('close')+'</button></div><div class="side-label">WORKSPACE</div><nav aria-label="Navegação principal">'+Object.entries(tabs).filter(([key])=>platformContext.role==="master"?["dashboard","clients","credits","settings"].includes(key):!["dashboard","clients"].includes(key)).map(([key,label])=>'<button type="button" class="nav '+(view===key?'active':'')+'" data-tab="'+key+'" title="'+esc(label)+'" aria-label="'+esc(label)+'" '+(view===key?'aria-current="page"':'')+'>'+glyph(key)+'<span>'+label+'</span>'+(view===key?'<span class="nav-indicator"></span>':'')+'</button>').join('')+'</nav><div class="side-spacer"></div><div class="side-panel"><span class="side-panel-label">STATUS DA OPERAÇÃO</span><div class="side-status"><span class="pulse '+(connected?'ok':'')+'"></span><div><strong>'+(platformContext.role==='master'?'Painel master':connected?'WhatsApp conectado':'WhatsApp pendente')+'</strong><small>'+(platformContext.role==='master'?'Gestão de clientes e acessos':connected?'Sessão sincronizada':'Confira em Conexões')+'</small></div></div><p>'+(platformContext.role==='master'?'Abra uma conta de cliente para acessar sua operação.':'Acompanhe conexões, conversas e oportunidades.')+'</p>'+(platformContext.canSwitchWorkspace?'<button type="button" class="workspace-switch-button sidebar-switch" data-action="switch-workspace">'+(platformContext.role==='master'?'Ir para Produção':'Ir para Master')+'</button>':'')+'</div><div class="side-footer"><span class="brand-min">C.</span><div><strong>'+esc(platformContext.name)+'</strong><small>'+(platformContext.role==='master'?'Painel master':'Espaço do cliente')+'</small></div></div></aside><div class="body"><header class="top"><div class="top-left"><button class="hamburger icon-button" data-action="menu" aria-label="Abrir menu">'+glyph('menu')+'</button><div class="top-title"><span class="eyebrow">WORKSPACE / '+esc(active.toUpperCase())+'</span><h1>'+esc(active)+'</h1></div></div><div class="top-right"><span class="status-chip '+(connected?'online':'')+'"><span class="pulse '+(connected?'ok':'')+'"></span><span>'+(platformContext.role==='master'?'Administração':connected?'WhatsApp online':'Desconectado')+'</span></span>'+(platformContext.canSwitchWorkspace?'<button type="button" class="workspace-switch-button" data-action="switch-workspace">'+(platformContext.role==='master'?'Ir para Produção':'Ir para Master')+'</button>':'')+(platformContext.role!=="master"&&!connected?'<button class="wa-inline-connect" type="button" data-action="reconnect-qr">'+glyph('connections')+' Conectar</button>':'')+'<button class="account-logout" type="button" data-action="logout-client" aria-label="Sair da conta">Sair</button><span class="useravatar" aria-hidden="true">'+esc((platformContext.name||'P').trim().charAt(0).toUpperCase()||'P')+'</span></div></header><div class="main-wrap">'+whatsappNotice()+'<div id="notice" class="notice '+(notice?'':'hidden')+'" role="status">'+esc(notice)+'</div><main class="content" id="view" aria-label="'+esc(active)+'"></main><footer class="main-footer"><span>PROSPECTOR / CONSECOM BRASIL</span><span>Ambiente privado · Dados sob sua gestão</span></footer></div></div></div>'+franciscaWidget()+activationModal();
}


function cards(values){
 return '<div class="stats">'+values.map((x,i)=>'<div class="metric"><div class="metric-top"><span class="metric-label">'+esc(x[0])+'</span><span class="metric-index">0'+(i+1)+'</span></div><div class="metric-value">'+esc(x[1])+'</div><div class="metric-help">'+esc(x[2]||'')+'</div></div>').join('')+'</div>';
}
function clientsView(){
 const filterText=clientSearch.trim().toLocaleLowerCase('pt-BR');
 const filtered=clientList.filter(c=>(clientStatusFilter==='all'||c.status===clientStatusFilter)&&(!filterText||(c.name+' '+c.email+' '+(c.phone||'')).toLocaleLowerCase('pt-BR').includes(filterText)));
 const packages=masterMetrics?.packages||[],planLabel=c=>c.unlimited?'Ilimitado':c.planId==='custom'?'Personalizado':packages.find(p=>p.id===c.planId)?.name||'Créditos';
 const form='<div class="master-modal-backdrop" role="presentation"><section role="dialog" aria-modal="true" aria-label="Adicionar cliente" class="master-client-modal"><div class="master-modal-head"><div><span class="kicker">CADASTRO / MASTER</span><h2>Adicionar cliente</h2><p>Crie uma conta privada com o plano adequado.</p></div><button type="button" class="master-modal-close" data-action="master-client-close" aria-label="Fechar formulário">×</button></div><form id="client-create" class="master-new-client-form"><div class="master-form-row"><label>Nome da empresa ou gestor<input name="name" required maxlength="100" placeholder="Nome da empresa" autocomplete="organization"></label><label>E-mail de acesso<input name="email" required maxlength="200" type="email" autocomplete="email" placeholder="contato@empresa.com.br"></label></div><div class="master-form-row"><label>WhatsApp com DDD<input name="phone" required type="tel" placeholder="(15) 99999-9999" maxlength="22" autocomplete="tel"></label><label>CPF do responsável<input name="cpf" required inputmode="numeric" maxlength="14" placeholder="000.000.000-00" autocomplete="off"></label></div><label>Plano do cliente<select id="master-plan-select" name="planId" required><option value="padrao">Padrão · 250 créditos</option>'+packages.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+' · '+Number(p.credits).toLocaleString('pt-BR')+' créditos</option>').filter(x=>!x.includes('value="padrao"')).join('')+'<option value="unlimited">Ilimitado</option><option value="custom">Personalizado</option></select></label><div id="master-custom-fields" class="master-form-row" hidden><label>Créditos personalizados<input name="customCredits" type="number" min="1" max="1000000" placeholder="Ex.: 500"></label><label>Valor em reais (R$)<input name="customPriceBRL" type="number" step="0.01" min="0" placeholder="Ex.: 19.90"></label></div><p class="footnote">Os planos pagos só recebem saldo após pagamento confirmado. O plano ilimitado não concede acesso ao Master. O CPF completo não é exibido nem armazenado em texto aberto.</p><button class="primary" type="submit" '+(busy?'disabled':'')+'>Criar conta e gerar convite</button></form>'+
 (clientAccess?'<div class="access-result master-invite-result"><strong>Conta criada! Convite privado</strong><p>Envie somente ao responsável. O link inicial autoriza acesso a essa conta.</p><input readonly aria-label="Convite de acesso" value="'+esc(clientAccess)+'"><button class="secondary compact" data-action="copy-access">Copiar convite</button></div>':'')+'</section></div>';
 return '<div class="master-clients-view"><div class="workspace-head master-client-heading"><div><span class="kicker">GESTÃO / CONTAS</span><h2>Seus clientes</h2><p>Encontre clientes, confira os planos e administre acessos em um único lugar.</p></div><button type="button" class="primary" data-action="master-client-create">+ Adicionar cliente</button></div>'+
 '<section class="panel master-directory-panel"><div class="master-directory-toolbar"><label class="master-search-field"><span>Pesquisar por nome ou e-mail</span><input id="client-search" type="search" autocomplete="off" placeholder="Busque pelo nome, e-mail ou telefone" value="'+esc(clientSearch)+'"></label><label class="master-filter-field"><span>Contas</span><select id="client-status-filter"><option value="all" '+(clientStatusFilter==='all'?'selected':'')+'>Todas</option><option value="active" '+(clientStatusFilter==='active'?'selected':'')+'>Ativas</option><option value="suspended" '+(clientStatusFilter==='suspended'?'selected':'')+'>Suspensas</option></select></label><span class="master-results-count">'+filtered.length+' de '+clientList.length+' clientes</span></div>'+
 '<div class="master-customer-table">'+(filtered.length?filtered.map(c=>'<article class="master-customer-row"><span class="master-customer-avatar">'+esc(c.name?.charAt(0).toUpperCase()||'?')+'</span><div class="master-customer-identity"><strong>'+esc(c.name)+'</strong><small>'+esc(c.email)+'</small><small>'+esc(c.phone||'Telefone não informado')+' · '+esc(c.cpfMasked||'CPF não cadastrado')+'</small></div><div class="master-customer-plan"><span class="tag '+(c.unlimited?'green':'')+'">'+esc(planLabel(c))+'</span><small>'+(c.unlimited?'Abordagens sem limite de crédito':Number(c.available||0).toLocaleString('pt-BR')+' disponíveis')+'</small></div><div class="master-customer-status"><span class="tag '+(c.status==='active'?'green':'')+'">'+(c.status==='active'?'Ativo':'Suspenso')+'</span></div><div class="master-customer-actions"><button type="button" class="secondary compact" data-action="client-open" data-client="'+esc(c.id)+'">Abrir</button><button type="button" class="secondary compact" data-action="client-access" data-client="'+esc(c.id)+'">Novo convite</button>'+(c.internal?'':'<button type="button" class="text-button" data-action="client-status" data-client="'+esc(c.id)+'" data-status="'+(c.status==='active'?'suspended':'active')+'">'+(c.status==='active'?'Suspender':'Reativar')+'</button>')+'</div></article>').join(''):'<div class="empty"><h3>Nenhum cliente encontrado</h3><p>Altere a pesquisa ou adicione seu primeiro cliente.</p></div>')+'</div></section>'+(masterCreateOpen?form:'')+(clientAccess&&!masterCreateOpen?'<div class="master-access-toast"><strong>Convite gerado</strong><input readonly value="'+esc(clientAccess)+'" aria-label="Convite de acesso"><button class="secondary compact" data-action="copy-access">Copiar</button></div>':'')+'</div>';
}
function masterDashboard(){
 const m=masterMetrics||{},finance=m.revenue||{},customers=m.clients||{},credits=m.credits||{},trend=m.trend||[],top=m.topClients||[],payments=m.recentPayments||[],plans=customers.plans||{};
 const kpis=[
  ['Recebido hoje',moneyFromCents(finance.todayCents||0),'Pagamento confirmado', 'money'],
  ['Recebido no mês',moneyFromCents(finance.monthCents||0),m.month||'Mês atual','money'],
  ['Clientes ativos',Number(customers.active||0),Number(customers.total||0)+' cadastrados','clients'],
  ['Créditos disponíveis',Number(credits.available||0).toLocaleString('pt-BR'),'Saldo dos clientes','credits'],
  ['Créditos utilizados',Number(credits.usedMonth||0).toLocaleString('pt-BR'),'Neste mês','credit-use'],
  ['Novos clientes',Number(customers.newThisMonth||0),'Neste mês','growth']
 ];
 const max=Math.max(1,...trend.map(x=>x.amountCents));
 const bars=trend.map(d=>'<div class="master-trend-col" title="'+esc(d.date)+' · '+moneyFromCents(d.amountCents)+'"><div class="master-trend-track"><span style="height:'+Math.max(3,Math.round(d.amountCents/max*100))+'%" class="'+(d.amountCents?'has-value':'')+'"></span></div><small>'+esc(d.label)+'</small></div>').join('');
 const total=Number(customers.total||0),unlimited=Number(plans.unlimited||0),custom=Number(plans.custom||0),prepaid=Number(plans.credits||0);
 const chart='conic-gradient(#7548ff 0 '+(total?Math.round(unlimited/total*100):0)+'%,#ac8afc '+(total?Math.round(unlimited/total*100):0)+'% '+(total?Math.round((unlimited+custom)/total*100):0)+'%,#d7c7ff '+(total?Math.round((unlimited+custom)/total*100):0)+'% 100%)';
 return '<div class="master-console"><div class="workspace-head master-dashboard-head"><div><span class="kicker">CENTRAL DE INTELIGÊNCIA / MASTER</span><h2>Dashboard de resultados</h2><p>Visão operacional e financeira da plataforma, com dados confirmados.</p></div><div class="actions"><span class="tag '+(m.billing?.configured?'green':'')+'">'+(m.billing?.configured?'Pagamentos automáticos':'Pagamentos a configurar')+'</span><button class="secondary compact" data-action="refresh-master">Atualizar indicadores</button></div></div>'+
 '<div class="master-kpi-grid">'+kpis.map(([title,value,sub,icon],i)=>'<article class="master-kpi master-kpi-'+i+'"><div class="master-kpi-top"><span>'+esc(title)+'</span><span class="master-kpi-icon">'+(i===0?'↗':i===1?'◆':i===2?'◈':i===3?'◉':i===4?'↘':'✦')+'</span></div><strong>'+esc(value)+'</strong><small>'+esc(sub)+'</small></article>').join('')+'</div>'+
 '<div class="master-charts-grid"><section class="panel master-chart-panel"><div class="master-section-head"><div><span class="kicker">PERFORMANCE FINANCEIRA</span><h3>Recebimentos nos últimos 14 dias</h3><p>Somente pagamentos com confirmação verificada pelo provedor.</p></div><strong>'+moneyFromCents(finance.monthCents||0)+'</strong></div><div class="master-trend-chart" role="img" aria-label="Recebimentos verificados por dia nos últimos 14 dias">'+bars+'</div>'+(trend.some(d=>d.amountCents)?'':'<p class="master-chart-zero">Nenhum pagamento verificado neste período. Os valores não incluem pedidos pendentes.</p>')+'</section>'+
 '<section class="panel master-chart-panel master-plan-panel"><div class="master-section-head"><div><span class="kicker">CARTEIRA DE CLIENTES</span><h3>Distribuição dos planos</h3><p>'+total+' contas registradas</p></div></div><div class="master-donut-area"><div class="master-donut" style="background:'+chart+'"><span><strong>'+total+'</strong><small>contas</small></span></div><div class="master-plan-legend"><div><i class="unlimited"></i><span>Ilimitados</span><strong>'+unlimited+'</strong></div><div><i class="custom"></i><span>Personalizados</span><strong>'+custom+'</strong></div><div><i class="prepaid"></i><span>Créditos</span><strong>'+prepaid+'</strong></div></div></div></section></div>'+
 '<div class="master-bottom-grid"><section class="panel master-chart-panel"><div class="master-section-head"><div><span class="kicker">ATIVIDADE DE CRÉDITOS</span><h3>Operações em destaque</h3><p>Consumo de créditos de abordagem neste mês.</p></div><button class="secondary compact" data-tab="clients">Ver clientes</button></div><div class="master-ranking">'+(top.length?top.map((client,i)=>'<div class="master-ranking-row"><span class="rank">'+String(i+1).padStart(2,'0')+'</span><div><strong>'+esc(client.name)+'</strong><small>'+esc(client.planId||'Créditos')+'</small></div><b>'+Number(client.creditsUsed||0)+' usados</b></div>').join(''):'<p class="empty-small">Não há dados de consumo para exibir.</p>')+'</div></section>'+
 '<section class="panel master-chart-panel"><div class="master-section-head"><div><span class="kicker">RECEBIMENTOS RECENTES</span><h3>Movimentações verificadas</h3><p>O resumo não contabiliza solicitações ainda sem pagamento.</p></div></div><div class="master-payment-list">'+(payments.length?payments.map(x=>'<div class="master-payment-row"><div><strong>'+esc(x.clientName)+'</strong><small>'+stamp(x.at)+' · '+Number(x.credits).toLocaleString('pt-BR')+' créditos</small></div><b>'+moneyFromCents(x.amountCents)+'</b></div>').join(''):'<p class="empty-small">Nenhum pagamento confirmado até o momento.</p>')+'</div></section></div>'+
 '<p class="master-metric-note">Valores financeiros mostram exclusivamente pagamentos confirmados via integração. Os saldos incluem as contas de créditos, mas não contabilizam uso ilimitado como créditos fictícios. '+(m.billing?.configured?'Cobranças automáticas ativadas.':'Checkout e webhook ainda precisam estar conectados para liberar créditos automaticamente.')+'</p></div>';
}
function masterSettings(){
 return '<div class="workspace-head"><div><span class="kicker">SEGURANÇA / ADMINISTRAÇÃO</span><h2>Configurações da conta Master</h2><p>O mesmo login é utilizado no Master e no painel de Produção.</p></div><span class="tag green">Conta interna protegida</span></div>'+
 '<div class="master-security-grid"><section class="panel master-security-card"><span class="kicker">LOGIN E SENHA</span><h3>Dados de acesso</h3><p>Atualize suas credenciais. As alterações também valem para sua conta de produção.</p><form id="account-credentials" class="stack-form"><label>E-mail do administrador<input type="email" name="newEmail" required maxlength="200" autocomplete="email" value="'+esc(platformContext.email||'')+'"></label><label>Senha atual<input type="password" name="currentPassword" required autocomplete="current-password" maxlength="128"></label><label>Nova senha (opcional)<input type="password" name="newPassword" autocomplete="new-password" minlength="10" maxlength="128" placeholder="Mínimo de 10 caracteres"></label><button class="primary" type="submit">Salvar alterações</button></form><p class="footnote">Depois de mudar o e-mail ou a senha, outras sessões são encerradas por segurança.</p></section>'+
 '<section class="panel master-security-card"><span class="kicker">PERMISSÕES</span><h3>Seu ambiente, protegido</h3><div class="master-security-fact"><span>Perfil administrativo</span><strong>Master exclusivo</strong></div><div class="master-security-fact"><span>Ambiente de operação</span><strong>Mesmas credenciais</strong></div><div class="master-security-fact"><span>Dados dos clientes</span><strong>Ambientes separados</strong></div><button class="secondary" data-action="switch-workspace">Ir para Produção</button></section></div>';
}
const moneyFromCents=cents=>'R$ '+(Number(cents||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
function masterCreditRequests(){
 const pending=creditRequests.filter(x=>x.status==='PENDING'),recent=creditRequests.slice(0,12);
 return '<section class="panel master-orders"><div class="heading"><div><span class="kicker">SOLICITAÇÕES DE RECARGA</span><h3>Pedidos aguardando pagamento</h3><p>Créditos só são liberados após sua confirmação de recebimento.</p></div><span class="tag '+(pending.length?'':'green')+'">'+pending.length+' pendente'+(pending.length===1?'':'s')+'</span></div>'+
 (recent.length?'<div class="orders-list">'+recent.map(x=>'<article class="order-row"><div class="order-identity"><strong>'+esc(x.client_name)+'</strong><small>'+esc(x.client_email)+' · '+stamp(x.created_at)+'</small></div><div class="order-amount"><strong>'+Number(x.credits).toLocaleString('pt-BR')+' créditos</strong><small>'+moneyFromCents(x.price_cents)+'</small></div><span class="tag '+(x.status==='APPROVED'?'green':'')+'">'+(x.status==='PENDING'?'Aguardando':x.status==='APPROVED'?'Confirmado':'Recusado')+'</span>'+(x.status==='PENDING'?'<div class="order-actions"><button class="primary compact" data-action="credit-request-approve" data-request="'+esc(x.id)+'">Confirmar pagamento</button><button class="text-button" data-action="credit-request-decline" data-request="'+esc(x.id)+'">Recusar</button></div>':'')+'</article>').join('')+'</div>':'<div class="empty"><h4>Nenhum pedido ainda</h4><p>Quando um gestor solicitar créditos, o pedido aparecerá aqui para sua conferência.</p></div>')+'</section>';
}
function masterBillingView(){
 const m=masterMetrics||{},f=m.revenue||{},c=m.credits||{},payments=m.recentPayments||[],ready=!!m.billing?.configured;
 return '<div class="workspace-head"><div><span class="kicker">GESTÃO FINANCEIRA / MASTER</span><h2>Pagamentos e créditos</h2><p>Conciliação e liberação de saldo mediante confirmação automática do provedor.</p></div><span class="tag '+(ready?'green':'')+'">'+(ready?'Checkout automático ativo':'Integração pendente')+'</span></div>'+
 '<div class="master-finance-cards"><article><small>Recebido hoje</small><strong>'+moneyFromCents(f.todayCents||0)+'</strong></article><article><small>Recebido este mês</small><strong>'+moneyFromCents(f.monthCents||0)+'</strong></article><article><small>Créditos liberados para uso</small><strong>'+Number(c.available||0).toLocaleString('pt-BR')+'</strong></article><article><small>Solicitações pendentes</small><strong>'+Number(c.pendingRequests||0)+'</strong></article></div>'+
 (ready?'<section class="panel master-billing-status"><span class="kicker">PAGAMENTO AUTOMÁTICO</span><h3>Recarga pela confirmação do provedor</h3><p>O cliente escolhe o pacote, paga no checkout seguro e os créditos são adicionados quando o webhook de pagamento verificado é recebido. Pedidos não pagos não liberam saldo.</p><span class="tag green">Verificação automática habilitada</span></section>':'<section class="panel master-billing-status"><span class="kicker">INTEGRAÇÃO PENDENTE</span><h3>Pagamentos ainda não estão conectados</h3><p>O painel não pode marcar pedidos como recebidos sem uma confirmação válida. É necessário configurar os links do checkout e a assinatura do webhook no servidor.</p></section>')+
 '<section class="panel master-billing-list"><div class="heading"><div><h3>Pagamentos verificados</h3><p>Apenas transações confirmadas são contabilizadas como receita.</p></div></div><div class="master-payment-list">'+(payments.length?payments.map(x=>'<div class="master-payment-row"><div><strong>'+esc(x.clientName)+'</strong><small>'+stamp(x.at)+' · '+Number(x.credits).toLocaleString('pt-BR')+' créditos</small></div><b>'+moneyFromCents(x.amountCents)+'</b></div>').join(''):'<p class="empty-small">Ainda não há pagamentos verificados.</p>')+'</div></section>';
}
function creditsView(){
 if(platformContext.role==='master')return masterBillingView();
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
function voiceMime(){
 if(!window.MediaRecorder)return '';
 return ['audio/webm','audio/mp4','audio/ogg'].find(type=>MediaRecorder.isTypeSupported(type))||'';
}
async function toggleTrainingRecording(){
 if(trainingRecorder?.state==='recording'){trainingRecorder.stop();return;}
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){n('Seu navegador não permite gravação de áudio neste contexto. Use o campo de texto.');return;}
 trainingRecordedText=q('#training-input')?.value||trainingRecordedText;
 let stream;
 try{
  const mime=voiceMime();if(!mime)throw Error('Formato de gravação indisponível');
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
  const rec=new MediaRecorder(stream,{mimeType:mime}),chunks=[];
  trainingRecorder=rec;
  rec.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
  rec.onstop=async()=>{
   if(trainingRecordTimeout)clearTimeout(trainingRecordTimeout);trainingRecordTimeout=null;
   stream.getTracks().forEach(t=>t.stop());trainingRecording=false;trainingRecorder=null;
   try{
    const blob=new Blob(chunks,{type:mime});
    if(blob.size>5*1024*1024)throw Error('Gravação acima de 5 MB');
    const result=await api('/api/training/voice-note',{method:'POST',headers:{'Content-Type':mime},body:blob});
    trainingRecordedText=[trainingRecordedText,result.text].filter(Boolean).join('\n');
    if(view==='training')render();n('Áudio transcrito. Revise o texto antes de enviar como orientação.');
   }catch(e){if(view==='training')render();n(e.message);}
  };
  rec.start();trainingRecording=true;render();
  trainingRecordTimeout=setTimeout(()=>{if(rec.state==='recording')rec.stop();},45000);
 }catch(e){stream?.getTracks().forEach(t=>t.stop());trainingRecording=false;trainingRecorder=null;n('Microfone indisponível: '+e.message);}
}
function franciscaActionButton(m){
 // Only server-defined action types are permitted. Labels and handlers are fixed locally.
 const options={
  connect_whatsapp:{attribute:'data-action="reconnect-qr"',label:'Conectar WhatsApp'},
  open_conversations:{attribute:'data-tab="conversations"',label:'Abrir Conversas'},
  open_prospecting:{attribute:'data-tab="prospects"',label:'Abrir Prospecção'}
 };
 const action=options[m?.uiAction?.kind];
 return action?'<button type="button" class="francisca-quick-action" '+action.attribute+'>'+action.label+'</button>':'';
}
function franciscaWidget(){
 return '<div class="francisca-widget"><button type="button" class="francisca-orb" data-action="francisca-toggle" aria-label="'+(franciscaOpen?'Fechar Francisca':'Conversar com Francisca por voz')+'" aria-expanded="'+String(franciscaOpen)+'"><span>F</span><small>Francisca</small></button>'+
 (franciscaOpen?'<section class="francisca-window" role="dialog" aria-label="Assistente Francisca"><div class="francisca-header"><span class="francisca-avatar">F</span><div><strong>Francisca</strong><small>Assistente do seu painel · voz e texto</small></div><button type="button" data-action="francisca-close" aria-label="Fechar Francisca">×</button></div><div class="francisca-log" role="log" aria-live="polite">'+(franciscaHistory.length?franciscaHistory.map(m=>'<div class="francisca-message '+(m.role==='user'?'sent':'received')+'">'+esc(m.text)+franciscaActionButton(m)+'</div>').join(''):'<div class="francisca-intro"><strong>Oi! Sou a Francisca.</strong><p>Posso explicar seus indicadores, créditos, conexões e orientações de atendimento. Posso consultar informações da operação, preparar pesquisas e responder contatos pelo WhatsApp quando você me der um comando direto.</p></div>')+(franciscaBusy?'<div class="francisca-message received">Preparando sua resposta…</div>':'')+'</div><form id="francisca-form" class="francisca-compose"><input id="francisca-input" maxlength="700" placeholder="Pergunte ou fale com a Francisca…" autocomplete="off" aria-label="Sua pergunta para Francisca"><button type="submit" class="francisca-send" '+(franciscaBusy?'disabled':'')+' aria-label="Enviar pergunta">➤</button></form><div class="francisca-controls"><button type="button" class="francisca-mic '+(franciscaVoiceActive?'recording':'')+'" data-action="francisca-record-toggle" aria-pressed="'+String(franciscaVoiceActive)+'">'+(franciscaVoiceActive?'■ Encerrar conversa por voz':'🎙 Conversar por voz')+'</button></div><p class="francisca-voice-status" role="status" aria-live="polite">'+esc(({'off':'Por texto, a Francisca responde somente por texto.','connecting':'Aguardando permissão do microfone…','listening':'● Estou ouvindo. Pode falar naturalmente.','hearing':'● Estou ouvindo sua frase…','processing':'Preparando a resposta da Francisca…','speaking':'A Francisca está falando. Você pode interromper quando quiser.'})[franciscaVoiceState]||'Pronto para conversar.')+'</p><p class="francisca-privacy">A conversa por voz começa ao tocar no microfone e termina ao tocar em Encerrar. Áudios são processados somente para responder, sem gravação persistente no painel.</p></section>':'')+'</div>';
}
function renderFrancisca(){
 const old=q('.francisca-widget');
 if(!old)return;
 const wrap=document.createElement('div');wrap.innerHTML=franciscaWidget();
 const next=wrap.firstElementChild;if(old&&next)old.replaceWith(next);
 q('.francisca-log')?.scrollTo({top:q('.francisca-log').scrollHeight,behavior:'smooth'});
}
function franciscaInlineError(message){
 franciscaHistory.push({role:'assistant',text:String(message||'Não consegui concluir agora.').slice(0,380)});
 franciscaHistory=franciscaHistory.slice(-20);renderFrancisca();
}
function stopFranciscaSound(){
 const audio=franciscaAudio;franciscaAudio=null;
 if(audio){try{audio.pause();audio.removeAttribute('src');audio.load();}catch{}}
 if(franciscaAudioObjectURL){
  try{URL.revokeObjectURL(franciscaAudioObjectURL);}catch{}
  franciscaAudioObjectURL=null;
 }
 const resolve=franciscaAudioResolve;franciscaAudioResolve=null;
 if(resolve)resolve();
}
function stopFranciscaVoice(){
 franciscaVoiceActive=false;franciscaVoiceState='off';
 if(franciscaVoiceSession){franciscaVoiceSession.stop();franciscaVoiceSession=null;}
 stopFranciscaSound();
 renderFrancisca();
}
async function speakFrancisca(text){
 if(!franciscaVoiceActive)return;
 try{
  const response=await fetch('/api/ai/francisca-speak',{
   method:'POST',credentials:'same-origin',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({text})
  });
  if(!response.ok)throw Error('Não foi possível gerar a voz agora.');
  const blob=await response.blob();
  if(!franciscaVoiceActive)return;
  if(!blob.size)throw Error('O áudio da resposta veio vazio.');
  stopFranciscaSound();
  const url=URL.createObjectURL(blob),audio=new Audio(url);
  franciscaAudio=audio;franciscaAudioObjectURL=url;
  franciscaVoiceState='speaking';renderFrancisca();
  await new Promise((resolve,reject)=>{
   let settled=false;
   franciscaAudioResolve=()=>{
    if(settled)return;settled=true;resolve();
   };
   audio.onended=()=>{stopFranciscaSound();};
   audio.onerror=()=>{stopFranciscaSound();reject(Error('A reprodução da voz falhou.'));};
   Promise.resolve(audio.play()).catch(error=>{stopFranciscaSound();reject(error);});
  });
 }catch(error){
  stopFranciscaSound();
  if(franciscaVoiceActive)franciscaInlineError('A resposta em texto está disponível, mas a voz falhou. '+String(error.message||'').slice(0,80));
 }
}
async function franciscaReply(input,isAudio=false){
 if(franciscaBusy)return;
 franciscaBusy=true;renderFrancisca();
 try{
  let result;
  if(isAudio){
   const resp=await fetch('/api/ai/francisca-turn',{
    method:'POST',credentials:'same-origin',
    headers:{'Content-Type':input.type||'audio/webm','X-Francisca-Conversation':franciscaConversationId},
    body:input
   });
   result=await resp.json().catch(()=>({}));
   if(!resp.ok)throw Error(result.error||'Não foi possível transcrever a sua fala.');
  }else{
   result=await post('/api/ai/francisca-turn',{
    text:input,history:franciscaHistory.slice(-10),
    conversationId:franciscaConversationId
   });
  }
  franciscaHistory.push({role:'user',text:result.transcript||String(input).slice(0,700)});
  franciscaHistory.push({role:'assistant',text:result.answer,uiAction:result.uiAction||null});
  franciscaHistory=franciscaHistory.slice(-20);renderFrancisca();
  // Written messages are ALWAYS text-only. Voice is strictly opt-in.
  if(isAudio&&franciscaVoiceActive)await speakFrancisca(result.answer);
 }catch(error){
  franciscaInlineError('Não consegui responder agora. '+String(error.message||'Tente novamente.').slice(0,150));
 }finally{
  franciscaBusy=false;renderFrancisca();
 }
}
async function toggleFranciscaRecording(){
 // This is a real conversation control, not a push-to-talk recorder.
 if(franciscaVoiceActive){stopFranciscaVoice();return;}
 if(franciscaBusy){franciscaInlineError('Termine a resposta atual antes de iniciar a conversa por voz.');return;}
 franciscaVoiceActive=true;franciscaVoiceState='connecting';renderFrancisca();
 try{
  // Greet once, with the real Francisca voice, before opening microphone VAD.
  // This avoids the assistant's own greeting being transcribed as user speech.
  const [voiceModule]=await Promise.all([
   import('./francisca-live.mjs'),
   speakFrancisca('Oi! Sou a Francisca. Pode falar, estou te ouvindo.')
  ]);
  if(!franciscaVoiceActive)return;
  const {createFranciscaVoiceSession}=voiceModule;
  franciscaVoiceSession=createFranciscaVoiceSession({
   canInterrupt:()=>franciscaVoiceActive&&franciscaVoiceState==='speaking',
   onInterrupt:()=>{
    // Playback stops immediately; the mic stays live and captures the new turn.
    stopFranciscaSound();
    franciscaVoiceState='hearing';
    renderFrancisca();
   },
   onState:status=>{
    if(status==='off'&&franciscaVoiceActive){franciscaVoiceActive=false;franciscaVoiceSession=null;}
    franciscaVoiceState=status;renderFrancisca();
   },
   onError:message=>{if(franciscaVoiceActive)franciscaInlineError(message);},
   onTurn:async blob=>{if(franciscaVoiceActive)await franciscaReply(blob,true);}
  });
  await franciscaVoiceSession.start();
 }catch(error){
  stopFranciscaVoice();
  franciscaInlineError('Não foi possível iniciar a conversa por voz. Confira a permissão do microfone: '+String(error.message||'Erro').slice(0,160));
 }
}
function trainingConversation(t){
 return '<section class="panel training-manual"><div class="heading"><div><span class="kicker">DO SEU JEITO</span><h3>O que seu atendimento precisa saber?</h3><p>Explique com suas próprias palavras. A IA transformará suas orientações em um perfil para sua revisão.</p></div></div>'+
 '<div class="training-tips"><strong>Você pode contar:</strong><span>O que sua empresa faz</span><span>Para quem vocês vendem</span><span>Quais serviços oferecem</span><span>Como prefere responder e quando assumir</span></div>'+
 '<div class="training-messages" role="log" aria-label="Conversa de treinamento">'+(t.chat?.length?t.chat.map(m=>'<div class="training-message '+(m.role==='user'?'sent':'received')+'"><small>'+(m.role==='user'?'Você':'Assistente de treinamento')+'</small><p>'+esc(m.body)+'</p></div>').join(''):'<div class="training-welcome"><strong>Conte como sua empresa trabalha.</strong><p>Exemplo: “Atendemos oficinas mecânicas, oferecemos gestão de tráfego e preferimos perguntas curtas. Quando alguém pedir valores, me avise para eu assumir.”</p></div>')+'</div>'+
 '<form class="training-composer" id="training-chat"><label class="sr-only" for="training-input">Orientações para a IA</label><textarea id="training-input" name="text" maxlength="3000" rows="3" required placeholder="Fale de forma natural sobre a sua empresa…">'+esc(trainingRecordedText)+'</textarea><div class="training-compose-actions"><button type="button" class="secondary training-record '+(trainingRecording?'recording':'')+'" data-action="training-record-toggle">'+(trainingRecording?'■ Parar gravação':'🎙 Falar por áudio')+'</button><button class="primary" type="submit" '+(trainingBusy?'disabled':'')+'>Enviar orientação ↗</button></div></form>'+
 '<p class="footnote">Áudios são transcritos para um texto que você confere antes de enviar. A gravação original não é salva pelo painel.</p></section>';
}
function trainingProfile(t){
 const draft=t.draft,profile=t.profile;
 return '<section class="panel profile-review"><div class="heading"><div><span class="kicker">REVISÃO DO GESTOR</span><h3>'+(draft?'Novo perfil para revisar':'Manual de atendimento')+'</h3><p>'+(draft?'Este é o rascunho Markdown. Revise os valores e as regras antes de ativar.':'Arquivo Markdown aprovado, usado pela Francisca nas conversas deste espaço.')+'</p></div>'+(profile?'<span class="tag green">Ativo</span>':'')+'</div>'+
 (draft?'<div class="training-markdown-info"><span>Documento privado · <strong>.md</strong></span><a href="/api/training/draft.md" download="francisca-rascunho.md" class="secondary compact">Baixar rascunho .md ↗</a></div><form id="training-approve" class="stack-form"><input type="hidden" name="id" value="'+esc(draft.id)+'"><label>Conteúdo do Markdown (editável)<textarea name="text" rows="12" maxlength="9000" required>'+esc(draft.text)+'</textarea></label><button class="primary" type="submit">Aprovar e salvar Francisca.md</button></form>':profile?'<div class="training-markdown-info"><span>Manual ativo <strong>francisca.md</strong> · restrito à sua empresa</span><a href="/api/training/profile.md" download="francisca.md" class="secondary compact">Baixar Markdown .md ↗</a></div><pre class="profile-text">'+esc(profile.text)+'</pre><button class="secondary" type="button" data-action="training-edit-profile">Editar manual</button>':'<div class="empty"><p>Seu manual aparecerá aqui após a entrevista e aprovação.</p></div>')+'</section>';
}
function trainingAnalysis(t){
 const running=t.runs?.some(x=>x.status==='RUNNING');
 const connected=!!wa?.connected;
 return '<section class="panel training-analysis"><div class="heading"><div><span class="kicker">APRENDER COM O WHATSAPP</span><h3>Extrair contexto das conversas</h3><p>Identifique padrões e exemplos de atendimento para revisar com sua IA.</p></div></div>'+
 (!connected?'<div class="training-connect-notice"><span class="training-connection-icon">'+glyph('connections')+'</span><div><strong>Conecte seus WhatsApps primeiro</strong><p>Para analisar conversas comerciais, conecte os números na aba Conexões. Você pode continuar com treinamento manual enquanto isso.</p></div><button type="button" class="primary" data-tab="connections">Conectar números</button></div>':
 '<div class="training-chats-actions"><span class="tag green">WhatsApp conectado</span><button type="button" class="secondary compact" data-action="training-chats">Carregar conversas</button></div><div class="mode-options"><label><input type="radio" name="training-mode" value="selected" '+(trainingMode==='selected'?'checked':'')+'> Selecionar conversas</label><label><input type="radio" name="training-mode" value="all" '+(trainingMode==='all'?'checked':'')+'> Todas as disponíveis</label></div>'+
 (trainingMode==='all'?'<p class="analysis-note">A lista inclui apenas conversas com abordagem confirmada pelo Prospector. Confirme quais exemplos comerciais deseja usar.</p><label class="training-all-confirm"><input id="training-all-confirm" type="checkbox" '+(trainingAllConfirmed?'checked':'')+'> Confirmo que todas as conversas disponíveis podem ser utilizadas para este treinamento.</label>':'<div class="training-chat-list">'+(trainingChats.length?trainingChats.map(x=>'<label><input type="checkbox" data-training-chat="'+esc(x.key)+'" '+(trainingSelection.has(x.key)?'checked':'')+'><span><strong>'+esc(x.name)+'</strong><small>'+esc(x.channel)+'</small></span></label>').join(''):'<p>Carregue as conversas para escolher quais exemplos deseja analisar.</p>')+'</div>')+
 '<button type="button" class="primary" data-action="training-analyze" '+(running||trainingBusy?'disabled':'')+'>'+(running?'Análise em andamento…':'Analisar e gerar relatório')+'</button>')+
 '<p class="footnote">A análise não envia mensagens aos contatos e só examina amostras dos textos enviados pela empresa. O perfil gerado precisa ser revisado antes de entrar em uso.</p>'+
 (t.runs?.length?'<div class="training-history"><h4>Últimas análises</h4>'+t.runs.slice(0,3).map(x=>'<p><strong>'+esc(({RUNNING:'Analisando',REVIEW:'Pronta para revisão',FAILED:'Não concluída'})[x.status]||x.status)+'</strong> · '+stamp(x.created_at)+(x.details?.error?'<br>'+esc(x.details.error):'')+'</p>').join('')+'</div>':'')+'</section>';
}

let interviewVoice=false,interviewVoiceSession=null,interviewAudio=null,interviewAudioUrl=null,interviewAudioDone=null,interviewVoiceState='off',interviewSending=false,interviewInput='',interviewShowAnalysis=false;
function interviewStopSpeech(){
 if(interviewAudio){try{interviewAudio.pause();interviewAudio.src='';}catch{}interviewAudio=null;}
 if(interviewAudioUrl){URL.revokeObjectURL(interviewAudioUrl);interviewAudioUrl=null;}
 const done=interviewAudioDone;interviewAudioDone=null;if(done)done();
}
function interviewStopVoice(){
 interviewVoice=false;interviewVoiceState='off';
 if(interviewVoiceSession){interviewVoiceSession.stop();interviewVoiceSession=null;}
 interviewStopSpeech();
}
function interviewVoiceLabel(){
 if(!interviewVoice)return 'Voz desligada. Você pode responder escrevendo.';
 return ({connecting:'Conectando microfone...',speaking:'Francisca está falando · você pode interromper',listening:'Microfone ligado · pode falar',hearing:'Estou ouvindo...',processing:'Transcrevendo sua resposta...'})[interviewVoiceState]||'Microfone ativo';
}
function interviewVoiceIndicator(){
 const s=q('#interview-voice-status');if(s)s.textContent=interviewVoiceLabel();
 const button=q('[data-action="interview-voice-toggle"]');
 if(button){button.textContent=interviewVoice?'Desligar voz':'Conversar por voz';button.classList.toggle('recording',interviewVoice);}
}
async function interviewSpeak(message){
 if(!interviewVoice||!message)return;
 try{
  interviewVoiceState='speaking';interviewVoiceIndicator();
  const response=await fetch('/api/ai/francisca-speak',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({text:String(message).slice(0,650)})});
  if(!response.ok)throw Error('Voz temporariamente indisponível');
  if(!interviewVoice)return;
  const url=URL.createObjectURL(await response.blob()),audio=new Audio(url);
  interviewStopSpeech();interviewAudioUrl=url;interviewAudio=audio;
  await new Promise((resolve,reject)=>{
   interviewAudioDone=resolve;
   audio.onended=()=>interviewStopSpeech();
   audio.onerror=()=>{interviewStopSpeech();reject(Error('Reprodução falhou'));};
   Promise.resolve(audio.play()).catch(e=>{interviewStopSpeech();reject(e);});
  });
 }catch(error){if(interviewVoice)n('A pergunta está escrita no chat; '+String(error.message).slice(0,80));}
 finally{if(interviewVoice){interviewVoiceState='listening';interviewVoiceIndicator();}}
}
async function interviewSend(text){
 if(interviewSending)return;
 text=String(text||'').trim();
 if(text.length<2&&!(trainingState?.interview?.step==='approach'&&/^[1-5]$/.test(text))){n('Responda à pergunta antes de continuar.');return;}
 interviewSending=true;interviewInput='';render();
 try{
  trainingState=await post('/api/training/interview/turn',{text});
  render();
  const el=q('.training-interview-feed');if(el)el.scrollTop=el.scrollHeight;
  const last=trainingState.interview?.messages?.at(-1);
  if(interviewVoice&&last?.role==='assistant')await interviewSpeak(last.body);
  if(trainingState.interview?.completed&&interviewVoice)interviewStopVoice();
 }catch(error){interviewInput=text;n(error.message);}
 finally{interviewSending=false;render();if(view==='training'&&!interviewVoice)q('#interview-answer')?.focus();}
}
async function interviewStartVoice(){
 if(interviewVoice||!trainingState?.interview||trainingState.interview.completed)return;
 interviewVoice=true;interviewVoiceState='connecting';interviewVoiceIndicator();
 try{
  const {createFranciscaVoiceSession}=await import('./francisca-live.mjs');
  if(!interviewVoice)return;
  interviewVoiceSession=createFranciscaVoiceSession({
   canInterrupt:()=>interviewVoice&&interviewVoiceState==='speaking',
   onInterrupt:()=>{interviewStopSpeech();interviewVoiceState='hearing';interviewVoiceIndicator();},
   onState:s=>{if(interviewVoice&&interviewVoiceState!=='speaking'){interviewVoiceState=s;interviewVoiceIndicator();}},
   onError:msg=>{if(interviewVoice)n(msg);},
   onTurn:async blob=>{
    if(!interviewVoice||interviewSending)return;
    try{
     interviewVoiceState='processing';interviewVoiceIndicator();
     const r=await fetch('/api/training/voice-note',{method:'POST',credentials:'same-origin',headers:{'Content-Type':(blob.type||'audio/webm').split(';')[0]},body:blob});
     const v=await r.json();if(!r.ok)throw Error(v.error||'Não foi possível entender o áudio');
     if(interviewVoice)await interviewSend(v.text);
    }catch(error){if(interviewVoice)n(error.message);}
   }
  });
  await interviewVoiceSession.start();
  if(!interviewVoice)return;
  interviewVoiceState='listening';interviewVoiceIndicator();
  await interviewSpeak(trainingState.interview.question);
 }catch(e){interviewStopVoice();render();n('Microfone indisponível. Você pode digitar: '+String(e.message||'').slice(0,100));}
}
async function interviewStart(mode){
 if(interviewSending)return;
 interviewStopVoice();interviewSending=true;
 try{trainingState=await post('/api/training/interview/start',{mode});interviewShowAnalysis=false;}
 catch(e){n(e.message);return;}
 finally{interviewSending=false;render();}
 if(mode==='voice')await interviewStartVoice();
}
function interviewView(){
 const t=trainingState||{},i=t.interview;
 const top='<div class="workspace-head"><div><span class="kicker">TREINAMENTO DA IA</span><h2>Converse com a Francisca.</h2><p>Ela faz perguntas objetivas e adapta o treinamento à sua empresa e aos seus serviços.</p></div><span class="tag '+(t.profile?'green':'')+'">'+(t.profile?'Perfil aprovado':'Aguardando treinamento')+'</span></div>';
 let body='';
 if(!i){
  body='<section class="panel interview-welcome"><span class="interview-avatar">F</span><span class="kicker">OI! SOU A FRANCISCA</span><h3>Você quer fazer meu treinamento escrito ou por voz?</h3><p>Eu vou aprender o que você vende, para quem vende, valores, condições e quando devo avisar você.</p><div class="interview-modes"><button type="button" data-action="interview-start" data-mode="voice"><span>◉</span><strong>Por voz</strong><small>Eu pergunto em voz alta, escuto suas respostas e também mostro tudo por escrito.</small><b>Começar por voz ↗</b></button><button type="button" data-action="interview-start" data-mode="text"><span>✎</span><strong>Por escrito</strong><small>Uma conversa natural no chat. Responda com calma e revise no final.</small><b>Começar por chat ↗</b></button></div><p class="interview-hint">Seu perfil só será usado após sua aprovação.</p></section>';
 }else{
  const messages=(i.messages||[]).map(m=>'<div class="interview-line '+(m.role==='user'?'user':'assistant')+'">'+(m.role==='assistant'?'<span class="interview-small-avatar">F</span>':'')+'<div class="interview-bubble"><small>'+(m.role==='assistant'?'Francisca':'Você')+'</small><p>'+esc(m.body)+'</p></div></div>').join('');
  body='<section class="panel interview-chat"><header><div><span class="interview-small-avatar">F</span><div><strong>Francisca</strong><small>'+(i.mode==='voice'?'Treinamento por voz e chat':'Treinamento por chat')+'</small></div></div><div><span class="tag">'+esc(i.progress)+'%</span><button type="button" class="secondary compact" data-action="interview-reset">Recomeçar</button></div></header><div class="interview-progress" role="progressbar" aria-label="Progresso do treinamento" aria-valuenow="'+esc(i.progress)+'" aria-valuemin="0" aria-valuemax="100"><span style="width:'+esc(i.progress)+'%"></span></div><div class="training-interview-feed" role="log" aria-live="polite">'+messages+'</div>'+
  (i.step==='approach'&&Array.isArray(i.choices)&&i.choices.length?'<div class="interview-approach-options" role="group" aria-label="Escolha sua abordagem inicial">'+i.choices.map((opt,index)=>'<button type="button" data-action="interview-approach-choice" data-choice="'+esc(opt.id)+'" '+(interviewSending?'disabled':'')+'><span class="approach-number">'+(index+1)+'</span><strong>'+esc(opt.label)+'</strong><small>'+esc(opt.description)+'</small></button>').join('')+'</div>':'')+
  (i.completed?'<p class="interview-completed">✓ Entrevista concluída. Revise o perfil abaixo antes de ativar.</p>':
  '<form id="interview-compose"><label class="sr-only" for="interview-answer">Sua resposta</label><textarea id="interview-answer" name="text" maxlength="850" rows="2" placeholder="'+(i.step==='approach_custom'?'Escreva a mensagem exata, com {{nome}}, {{empresa}} e {{servico}}…':'Responda escrevendo ou por voz…')+'" '+(interviewSending?'disabled':'')+'>'+esc(interviewInput)+'</textarea><div class="interview-compose-actions"><button type="button" class="secondary '+(interviewVoice?'recording':'')+'" data-action="interview-voice-toggle">'+(interviewVoice?'Desligar voz':'Conversar por voz')+'</button><button type="submit" class="primary" '+(interviewSending?'disabled':'')+'>'+(interviewSending?'Registrando…':'Enviar ↗')+'</button></div><p id="interview-voice-status" role="status">'+esc(interviewVoiceLabel())+'</p></form>')+
  '<p class="interview-hint">Você pode falar e escrever. Áudios são transcritos, não salvos como gravação. Nada é ativado sem sua aprovação.</p></section>';
 }
 const profile=(i?.completed||(!i&&(t.profile||t.draft)))?'<div class="interview-profile">'+trainingProfile(t)+'</div>':'';
 const advanced='<div class="interview-advanced"><button type="button" class="secondary compact" data-action="interview-analysis">'+(interviewShowAnalysis?'Ocultar análise':'Analisar conversas comerciais também')+'</button></div>'+(interviewShowAnalysis?trainingAnalysis(t):'');
 const shared='<div class="training-markdown-info"><span><strong>Método global de vendas</strong> · compartilhado e somente leitura. O seu perfil de serviços, preços e tom é privado.</span><a href="/api/training/global.md" download="francisca-vendas-global.md" class="secondary compact">Baixar base global .md ↗</a></div>';
 return top+shared+'<div class="interview-layout">'+body+profile+'</div>'+advanced;
}
function trainingView(){return interviewView();}

async function loadMasterMetrics(){try{masterMetrics=await api('/api/platform/analytics');if(platformContext.role==='master'&&view==='dashboard')render();}catch(e){n('Indicadores indisponíveis: '+e.message);}}
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
 if(action==='master-client-create'){masterCreateOpen=true;clientAccess='';render();q('.master-client-modal input[name=name]')?.focus();return true;}
 if(action==='master-client-close'){masterCreateOpen=false;render();return true;}
 if(action==='refresh-master'){await Promise.all([loadClients(),loadMasterMetrics()]);n('Dados atualizados.');return true;}
 if(action==='refresh-clients'){await loadClients();return true;}
 if(action==='request-credit-package'){
  if(!creditState?.automaticBilling){n('O checkout automático está sendo configurado. Nenhuma cobrança ou recarga foi efetuada.');return true;}
  const pack=creditState?.packages?.find(p=>p.id===el.dataset.package);
  if(!pack)throw Error('Pacote não encontrado. Atualize seus créditos.');
  const answer=await confirmInApp({title:'Comprar '+pack.credits.toLocaleString('pt-BR')+' créditos',description:'Pacote '+pack.name+' no valor de '+moneyFromCents(pack.priceCents)+'. Você será direcionado ao checkout seguro. O saldo só será liberado após confirmação do pagamento pelo provedor.',confirmLabel:'Continuar para o pagamento'});
  if(!answer)return true;
  const order=await post('/api/platform/credit-requests',{packageId:pack.id,requestKey:crypto.randomUUID()});
  if(!order.checkoutUrl)throw Error('Checkout indisponível. Nenhuma cobrança foi realizada.');
  preferredPackage='';try{sessionStorage.removeItem('prospector-preferred-package');}catch{}
  location.assign(order.checkoutUrl);return true;
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
 if(action==='interview-start'){await interviewStart(el.dataset.mode==='voice'?'voice':'text');return true;}
 if(action==='interview-approach-choice'){
  if(!trainingState?.interview||trainingState.interview.step!=='approach'||interviewSending)return true;
  const choice=String(el.dataset.choice||'');
  if(['permission','direct','consultative','friendly','custom'].includes(choice))await interviewSend(choice);
  return true;
 }
 if(action==='interview-voice-toggle'){if(interviewVoice){interviewStopVoice();render();}else await interviewStartVoice();return true;}
 if(action==='interview-reset'){const approved=await confirmInApp({title:'Recomeçar entrevista?',description:'As respostas desta entrevista serão reiniciadas. O perfil já aprovado não será alterado.',confirmLabel:'Recomeçar'});if(approved){interviewStopVoice();trainingState=await post('/api/training/interview/reset',{});interviewInput='';render();}return true;}
 if(action==='interview-analysis'){interviewShowAnalysis=!interviewShowAnalysis;render();return true;}
 if(action==='training-reopen'){trainingWizardReopen=true;trainingStep=0;render();return true;}
 if(action==='training-open-analysis'){trainingStep=2;render();return true;}
 if(action==='training-finish'){trainingWizardReopen=false;trainingStep=0;render();return true;}
 if(action==='training-goto'){trainingWizardReopen=true;trainingStep=Math.max(0,Math.min(3,Number(el.dataset.step)||0));render();return true;}
 if(action==='training-next'){trainingWizardReopen=true;trainingStep=Math.min(3,trainingStep+1);render();return true;}
 if(action==='training-prev'){trainingWizardReopen=true;trainingStep=Math.max(0,trainingStep-1);render();return true;}
 if(action==='training-record-toggle'){await toggleTrainingRecording();return true;}
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
 const id=ev.target.id;if(id==='interview-compose'){ev.preventDefault();await interviewSend(new FormData(ev.target).get('text'));return true;}if(!['client-create','training-business','training-chat','training-approve'].includes(id))return false;
 ev.preventDefault();if(trainingBusy||busy)return true;
 const input=Object.fromEntries(new FormData(ev.target));trainingBusy=true;busy=id==='client-create';
 const button=ev.target.querySelector('button');if(button)button.disabled=true;
 try{
  if(id==='client-create'){
   if(input.planId==='custom'){
    input.customPriceCents=Math.round(Number(input.customPriceBRL)*100);
    if(!Number.isSafeInteger(input.customPriceCents)||!Number.isSafeInteger(Number(input.customCredits))||Number(input.customCredits)<1)throw Error('Defina os créditos e o valor do plano personalizado.');
   }
   delete input.customPriceBRL;
   const r=await post('/api/platform/clients',input);
   clientAccess=location.origin+r.accessPath;
   await Promise.all([loadClients(),loadMasterMetrics()]);
   n('Cliente criado. Compartilhe o convite privado com o responsável.');
  }
  else{trainingState=await post('/api/training/'+({ 'training-business':'business','training-chat':'chat','training-approve':'approve'})[id],input);if(id==='training-business')trainingStep=1;if(id==='training-chat')trainingRecordedText='';if(id==='training-approve'){trainingWizardReopen=false;trainingStep=0;}n(id==='training-approve'?'Perfil aprovado e ativo.':'Informações de treinamento salvas.');}
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
  '<div class="kanban-board-title"><h3>Kanban de oportunidades</h3><small>Acompanhe cada etapa e abra a conversa pelo cartão.</small></div>'+
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
 const scopes=scopeInfo?.options||{},chosen=scopeInfo?.selection||{};
 const allNiches=!scopeMode.startsWith('niche'),allCities=!scopeMode.endsWith('-city');
 const calendar=prospectCalendar||{month:calendarMonth,days:[],totals:{approached:0,closed:0}},lookup=new Map((calendar.days||[]).map(x=>[x.date,x]));
 const [year,month]=calendarMonth.split('-').map(Number);
 const numberOfDays=new Date(year,month,0).getDate(),firstWeekday=(new Date(year,month-1,1).getDay()+6)%7;
 const fullMonth=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(year,month-1,1));
 const calendarCells=[...Array(firstWeekday)].map(()=>'<div class="calendar-empty" aria-hidden="true"></div>');
 for(let day=1;day<=numberOfDays;day++){
  const date=calendarMonth+'-'+String(day).padStart(2,'0'),info=lookup.get(date)||{approachedCount:0,closedCount:0,conversionRate:0};
  calendarCells.push('<div class="calendar-day '+(date===calendarDay?'selected':'')+'"><div class="calendar-day-number">'+day+'</div><div class="calendar-day-stats"><button type="button" class="calendar-day-counter" data-action="calendar-day" data-date="'+date+'" data-kind="approached" title="Ver empresas abordadas" aria-label="Ver empresas abordadas em '+date+'"><b>'+Number(info.approachedCount||0)+'</b><small>Abord.</small></button><button type="button" class="calendar-day-counter closed" data-action="calendar-day" data-date="'+date+'" data-kind="closed" title="Ver empresas fechadas" aria-label="Ver empresas fechadas em '+date+'"><b>'+Number(info.closedCount||0)+'</b><small>Fech.</small></button></div><small class="calendar-day-rate">'+Number(info.conversionRate||0).toLocaleString('pt-BR')+'% conversão</small></div>');
 }
 const selected=lookup.get(calendarDay),items=selected?.[calendarCategory]||[],typeLabel=calendarCategory==='closed'?'Fechadas':'Abordadas';
 return '<div class="prospect-dashboard">'+
 '<section class="panel scope-panel"><div class="scope-heading"><div><span class="kicker">PROSPECÇÃO AUTOMÁTICA</span><h2>O que você quer prospectar?</h2><p>Escolha seus nichos e regiões. A descoberta pesquisa automaticamente a partir das 5h.</p></div><span class="tag '+(state?.settings?.discovery_auto_enabled?'green':'')+'">'+(state?.settings?.discovery_auto_enabled?'Pesquisa ativa':'Pesquisa pausada')+'</span></div>'+
 '<form id="scope-form" class="scope-form"><div class="scope-field '+(allNiches?'is-all':'')+'"><div class="scope-field-top"><label for="scope-niche">Nicho</label><button type="button" class="scope-mode-button '+(allNiches?'active':'')+'" data-action="scope-toggle-niche" aria-pressed="'+allNiches+'">Todos '+(allNiches?'✓':'')+'</button></div><input id="scope-niche" name="niche" list="scope-niches" value="'+esc(scopeNicheInput)+'" '+(allNiches?'readonly data-action="scope-toggle-niche"':'required')+' placeholder="'+(allNiches?'Todos os nichos selecionados':'Ex.: oficina ou contabilidade')+'" autocomplete="off"><datalist id="scope-niches">'+(scopes.segments||[]).map(x=>'<option value="'+esc(x.id)+'" label="'+esc(x.label)+'"></option>').join('')+'</datalist></div>'+
 '<div class="scope-field '+(allCities?'is-all':'')+'"><div class="scope-field-top"><label for="scope-city">Cidade / Estado</label><button type="button" class="scope-mode-button '+(allCities?'active':'')+'" data-action="scope-toggle-city" aria-pressed="'+allCities+'">Brasil inteiro '+(allCities?'✓':'')+'</button></div><input id="scope-city" name="city" list="scope-cities" value="'+esc(scopeCityInput)+'" '+(allCities?'readonly data-action="scope-toggle-city"':'required')+' placeholder="'+(allCities?'Brasil inteiro selecionado':'Ex.: Sorocaba / SP')+'" autocomplete="address-level2"><datalist id="scope-cities">'+(scopes.cities||[]).map(x=>'<option value="'+esc(x)+' / SP"></option>').join('')+'</datalist></div>'+
 '<button type="submit" class="primary scope-save">Salvar preferência</button></form><p class="scope-limitation">A opção “Brasil inteiro” significa pesquisar em todas as regiões que a fonte oferece no momento; a cobertura nacional ainda está em expansão. Atualmente: '+Number(scopes.cities?.length||0)+' cidades e '+Number(scopes.segments?.length||0)+' nichos. A pesquisa não inicia mensagens sem autorização.</p></section>'+
 '<section class="panel calendar-panel"><div class="calendar-head"><div><span class="kicker">HISTÓRICO DE PROSPECÇÃO</span><h3>Calendário de resultados</h3><p>Veja as empresas abordadas e os fechamentos confirmados, dia a dia.</p></div><div class="calendar-nav"><button type="button" class="secondary compact" data-action="calendar-prev" aria-label="Mês anterior">‹</button><strong>'+esc(fullMonth)+'</strong><button type="button" class="secondary compact" data-action="calendar-next" aria-label="Próximo mês">›</button></div></div><div class="calendar-month-totals"><span><strong>'+Number(calendar.totals?.approached||0)+'</strong> abordadas no mês</span><span><strong>'+Number(calendar.totals?.closed||0)+'</strong> vendas confirmadas no mês</span></div><div class="calendar-scroll"><div class="calendar-week-grid">'+['SEG','TER','QUA','QUI','SEX','SÁB','DOM'].map(x=>'<span>'+x+'</span>').join('')+'</div><div class="calendar-days-grid">'+calendarCells.join('')+'</div></div><p class="calendar-definition">'+esc(calendar.conversionDefinition||'A taxa compara empresas abordadas naquele dia com as que têm venda confirmada registrada.')+'</p></section>'+
 (calendarDay?'<section class="panel calendar-details"><div class="heading"><div><span class="kicker">DETALHES DO DIA</span><h3>'+esc(new Date(calendarDay+'T12:00:00').toLocaleDateString('pt-BR',{day:'numeric',month:'long',year:'numeric'}))+'</h3></div><div class="calendar-detail-tabs"><button type="button" data-action="calendar-day" data-date="'+calendarDay+'" data-kind="approached" class="'+(calendarCategory==='approached'?'active':'')+'">Abordadas · '+Number(selected?.approachedCount||0)+'</button><button type="button" data-action="calendar-day" data-date="'+calendarDay+'" data-kind="closed" class="'+(calendarCategory==='closed'?'active':'')+'">Fechadas · '+Number(selected?.closedCount||0)+'</button></div></div>'+(items.length?'<div class="calendar-company-list">'+items.map(x=>'<div><span class="calendar-company-avatar">'+esc((x.business||'E')[0])+'</span><span><strong>'+esc(x.business)+'</strong><small>'+esc(x.city||'Sem cidade informada')+(x.confirmedTime===false?' · data estimada':'')+'</small></span><span class="tag '+(calendarCategory==='closed'?'green':'')+'">'+typeLabel.slice(0,-1)+'</span></div>').join('')+'</div>':'<div class="empty"><p>Nenhuma empresa registrada nesta categoria e data.</p></div>')+'</section>':'')+
 '</div>';
}
function whatsappAccountsPanel(){
 const count=waAccounts.filter(x=>x.connected).length;
 return '<section class="panel wa-directory"><div class="heading"><div><span class="kicker">CANAIS DE ATENDIMENTO</span><h2>Seus WhatsApps</h2><p>Identifique seus números e gerencie cada conexão com segurança.</p></div><span class="tag green">'+count+' conectado'+(count===1?'':'s')+'</span></div>'+
 '<div class="wa-directory-list">'+(waAccounts.length?waAccounts.map(item=>'<button type="button" class="wa-directory-item" data-action="select-wa" data-session="'+esc(item.session_id)+'"><span class="wa-directory-avatar">'+glyph('conversations')+'</span><span class="wa-directory-details"><strong>'+esc(item.label)+'</strong><small>'+(item.numberSuffix?'•••• '+esc(item.numberSuffix)+' · ':'')+(item.connected?'Número conectado':'Aguardando conexão')+'</small></span><span class="wa-directory-status '+(item.connected?'is-online':'')+'"><span class="pulse '+(item.connected?'ok':'')+'"></span> '+(item.connected?'Conectado':'Conectar')+'</span>'+glyph('arrow')+'</button>').join(''):'<div class="empty"><h3>Seu primeiro WhatsApp</h3><p>Dê um nome para identificar o canal e conecte pelo QR Code.</p></div>')+'</div>'+
 '<form class="wa-add-form" id="wa-add-form"><label>Nome do novo WhatsApp<input id="new-wa-label" name="label" maxlength="70" placeholder="Ex.: Comercial 01 ou Atendimento" required></label><button type="submit" data-action="add-wa" class="primary" '+(busy?'disabled':'')+'>+ Conectar mais um WhatsApp</button></form>'+
 '<p class="footnote">Cada número tem sua própria sessão. A cadência de novas abordagens é compartilhada entre os canais.</p></section>';
}
function connections(){
 const item=waAccounts.find(x=>x.session_id===connectionSession);
 return whatsappAccountsPanel()+(waModalOpen?'<div class="wa-modal-backdrop" role="presentation"><section class="wa-modal" role="dialog" aria-modal="true" aria-labelledby="wa-modal-title"><button type="button" class="wa-modal-close" data-action="close-wa-modal" aria-label="Fechar">'+glyph('close')+'</button><span class="kicker">CONEXÃO WHATSAPP</span><h2 id="wa-modal-title">'+esc(item?.label||'Novo número')+'</h2><p>No celular, abra WhatsApp → <strong>Aparelhos conectados</strong> → <strong>Conectar aparelho</strong>. Depois escaneie o código.</p><div class="wa-modal-qr">'+(wa?.connected?'<div class="wa-connected-success"><span>✓</span><h3>Conectado!</h3><p>Seu WhatsApp está pronto. Esta janela fecha automaticamente.</p></div>':qrResult?.qr?'<img class="qr-image" src="'+esc(qrResult.qr)+'" alt="QR Code para conectar este WhatsApp"><small>Escaneie com o seu WhatsApp</small>':'<div class="wa-qr-loading"><span class="wa-qr-skeleton">▦</span><strong>Aguardando QR Code</strong><small>'+esc(qrResult?.message||'Preparando o pareamento')+'</small></div>')+'</div><div class="wa-modal-actions">'+(wa?.connected?'<button type="button" class="secondary" data-action="disconnect">Desconectar número</button>':'<button type="button" class="secondary" data-action="connect">Atualizar QR Code</button>')+'<button type="button" class="primary" data-action="close-wa-modal">Fechar</button></div></section></div>':'');
}
function settings(){
 if(platformContext.role==='master')return masterSettings();
 const hours=outreachHours||{start:'08:00',end:'17:30'};
 return '<div class="workspace-head"><div><span class="kicker">PREFERÊNCIAS DA CONTA</span><h2>Configurações</h2><p>O essencial para sua operação, com segurança e sem ferramentas técnicas desnecessárias.</p></div></div>'+
 '<div class="account-settings-grid"><section class="panel"><div class="heading"><div><span class="kicker">HORÁRIO DE ABORDAGENS</span><h3>Quando abordar empresas?</h3><p>Defina quando sua operação pode iniciar novas conversas.</p></div></div><form id="outreach-hours-form" class="stack-form"><div class="setting-hour-fields"><label>Início das abordagens<input name="start" type="time" step="60" min="08:00" max="17:29" value="'+esc(hours.start)+'" required></label><label>Fim das abordagens<input name="end" type="time" step="60" min="08:01" max="17:30" value="'+esc(hours.end)+'" required></label></div><p class="footnote">A descoberta continua a partir das 5h. Os horários configurados devem ficar dentro da janela de segurança das 8h às 17h30, e os envios continuam sujeitos à autorização do destinatário e às regras do canal.</p><button class="primary" type="submit">Salvar horário</button></form></section>'+
 '<section class="panel"><div class="heading"><div><span class="kicker">ACESSO E SEGURANÇA</span><h3>E-mail e senha</h3><p>Para qualquer alteração, confirme a senha atual.</p></div></div><form id="account-credentials" class="stack-form"><label>Novo e-mail<input type="email" name="newEmail" autocomplete="email" value="'+esc(platformContext.email||'')+'" required></label><label>Senha atual<input type="password" name="currentPassword" autocomplete="current-password" minlength="1" maxlength="128" required></label><label>Nova senha (opcional)<input type="password" name="newPassword" autocomplete="new-password" minlength="10" maxlength="128" placeholder="Mínimo de 10 caracteres"></label><p class="footnote">Alterar o e-mail ou a senha encerra outras sessões conectadas. Você permanece conectado neste navegador.</p><button class="primary" type="submit">Salvar dados de acesso</button></form></section></div>'+
 '<section class="panel settings-simple-control"><div><span class="kicker">CONTROLE RÁPIDO</span><h3>Pausar novas abordagens</h3><p>Pause imediatamente a fila automática sem interromper conversas recebidas.</p></div><label class="switch" aria-label="Pausar abordagem automática"><input id="s-paused" type="checkbox" '+(state?.settings?.paused?'checked':'')+'><span></span></label></section>'+
 '<p class="settings-small-note">Seus dados e conversas ficam vinculados ao seu espaço. Treinamento com históricos exige autorização. A Francisca está disponível na bolinha lateral, em todas as áreas do painel.</p>';
}
async function loadOutreachHours(){
 try{const r=await api('/api/settings/outreach-hours');outreachHours=r.hours;if(view==='settings')render();}
 catch(e){n(e.message);}
}
function render(){
 shell();
 const el=q("#view");
 el.innerHTML={dashboard:masterDashboard,clients:clientsView,overview,conversations,prospects:prospecting,connections,training:trainingView,credits:creditsView,settings}[view]();
 if(view==='training'){const feed=q('.training-interview-feed');if(feed)feed.scrollTop=feed.scrollHeight;}
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
   if(w.connected&&waModalOpen&&!waModalCloseTimer){waModalCloseTimer=setTimeout(()=>{waModalOpen=false;waModalCloseTimer=null;if(view==='connections')render();},2500);}
   if(!w.connected&&waModalCloseTimer){clearTimeout(waModalCloseTimer);waModalCloseTimer=null;}
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
 qrOpening=true;busy=true;waModalOpen=true;
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
 if(!workspaceInitialized){
  workspaceInitialized=true;
  try{platformContext=await api('/api/platform/context');}
  catch(e){root.innerHTML='<main class="load-error"><h2>Não foi possível acessar o painel</h2><p>'+esc(e.message)+'</p><button onclick="location.reload()">Tentar novamente</button></main>';return;}
  if(platformContext.role!=='master'&&view==='clients')view='overview';
  if(platformContext.role==='master'&&(!location.hash||!['dashboard','clients','credits','settings'].includes(view)))view='dashboard';
  // Show a working dashboard immediately; large API snapshots and WhatsApp
  // sync are loaded after first paint instead of delaying the whole layout.
  render();
 }
 try{
  if(platformContext.role==="master"){await Promise.all([loadClients(),loadMasterMetrics()]);lastRefresh=Date.now();render();return;}
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
  if(action==='switch-workspace'){
    const mode=platformContext.role==='master'?'production':'master';
    const response=await post('/api/platform/workspace',{mode});
    // A hash-only navigation does not recreate the authenticated app context.
    // Change the query string as well, forcing a full, credentialed page load.
    location.replace('/?workspace='+encodeURIComponent(mode)+(response.next||'#/overview'));return;
   }
   if(action==='scope-toggle-niche'||action==='scope-toggle-city'){
    scopeNicheInput=q('#scope-niche')?.value||scopeNicheInput;
    scopeCityInput=q('#scope-city')?.value||scopeCityInput;
    const nicheSelected=scopeMode.startsWith('niche');
    const citySelected=scopeMode.endsWith('-city');
    const nextNiche=action==='scope-toggle-niche'?!nicheSelected:nicheSelected;
    const nextCity=action==='scope-toggle-city'?!citySelected:citySelected;
    scopeMode=nextNiche?(nextCity?'niche-city':'niche-all'):(nextCity?'all-city':'all');
    render();return;
   }
   if(action==='francisca-toggle'){
    franciscaOpen=!franciscaOpen;
    if(notice.includes('Abra o espaço de um cliente para conversar com a Francisca'))n('');
    renderFrancisca();return;
   }
  if(action==='francisca-close'){franciscaOpen=false;stopFranciscaVoice();renderFrancisca();return;}
  if(action==='francisca-record-toggle'){await toggleFranciscaRecording();return;}
  if(action==='calendar-prev'||action==='calendar-next'){moveCalendar(action==='calendar-prev'?-1:1);return;}
  if(action==='calendar-day'){calendarDay=el.dataset.date||'';calendarCategory=el.dataset.kind==='closed'?'closed':'approached';render();return;}
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
  if(action==='close-wa-modal'){waModalOpen=false;if(waModalCloseTimer){clearTimeout(waModalCloseTimer);waModalCloseTimer=null;}render();return;}
  if(action==='select-wa'){
   connectionSession=String(el.dataset.session||'');qrResult=null;waModalOpen=true;
   if(waModalCloseTimer){clearTimeout(waModalCloseTimer);waModalCloseTimer=null;}
   await refreshWa();if(!wa?.connected)await post('/api/whatsapp/connect',{sessionId:connectionSession});
   await refreshWa();render();return;
  }
  if(action==='add-wa'){
   if(busy)return;
   const name=q('#new-wa-label')?.value?.trim();
   const label=name||'WhatsApp '+(waAccounts.length+1);
   busy=true;render();
   try{const created=await post('/api/whatsapp/sessions',{name:label});connectionSession=created.sessionId;qrResult=null;waModalOpen=true;await refreshWa();n('WhatsApp adicionado. Escaneie o QR Code deste número.');}
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

 if(ev.target.id==='activate-account'){
  const input=Object.fromEntries(new FormData(ev.target));
  if(input.password!==input.confirmPassword){n('As senhas não são iguais.');return;}
  try{
   const result=await post('/api/platform/account/setup',{password:input.password});
   platformContext.needsPasswordSetup=false;
   n('Conta ativada com sucesso. Seu convite inicial perdeu a validade.');
   render();
  }catch(error){n(error.message);}
  return;
 }
 if(ev.target.id==='outreach-hours-form'){
  const payload=Object.fromEntries(new FormData(ev.target));
  try{const r=await post('/api/settings/outreach-hours',payload);outreachHours=r.hours;n('Horário de abordagem salvo.');render();}catch(e){n(e.message);}return;
 }
 if(ev.target.id==='account-credentials'){
  const payload=Object.fromEntries(new FormData(ev.target));
  try{const r=await post('/api/platform/account',payload);platformContext.email=r.email;n(r.message||'Conta atualizada.');render();}
  catch(e){n(e.message);}return;
 }
 if(ev.target.id==='francisca-form'){
  const text=q('#francisca-input')?.value.trim();if(!text)return;
  const input=q('#francisca-input');if(input)input.value='';
  // Typing always returns a typed answer, even after a voice conversation.
  if(franciscaVoiceActive)stopFranciscaVoice();
  await franciscaReply(text,false);return;
 }
 if(ev.target.id==='scope-form'){
  scopeNicheInput=q('#scope-niche')?.value.trim()||'';
  scopeCityInput=q('#scope-city')?.value.trim()||'';
  const payload={mode:scopeMode,niche:scopeNicheInput,city:scopeCityInput,enabled:'on'};
  try{
   scopeInfo=await post('/api/prospecting/preferences',payload);
   scopeMode=scopeInfo.selection?.mode||'all';
   n('Preferência salva. A pesquisa automática seguirá esse foco a partir das 5h.');
   render();
  }catch(e){n(e.message);}
  return;
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
 if(e.target.name==="training-mode"){trainingMode=e.target.value;trainingAllConfirmed=false;render();return;}
 if(e.target.id==='training-all-confirm'){trainingAllConfirmed=e.target.checked;return;}
 if(e.target.id==='client-status-filter'){clientStatusFilter=e.target.value;render();return;}
 if(e.target.id==='master-plan-select'){
  const fields=q('#master-custom-fields'),custom=e.target.value==='custom';
  if(fields){fields.hidden=!custom;for(const input of fields.querySelectorAll('input'))input.required=custom;}
  return;
 }

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
 if(e.target.id==='scope-niche'){scopeNicheInput=e.target.value;return;}
 if(e.target.id==='scope-city'){scopeCityInput=e.target.value;return;}

 if(e.target.id==='interview-answer'){interviewInput=e.target.value;return;}
  if(e.target.id==='training-input'){trainingRecordedText=e.target.value;return;}
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
if(view==='prospects')await Promise.all([loadCalendar(),loadScope()]);
if(view==='settings')await loadOutreachHours();
