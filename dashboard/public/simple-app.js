// Prospector: five focused views. Deliberately no legacy campaign modules.
const q=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const stamp=d=>d?new Date(d).toLocaleString("pt-BR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
const tabs={dashboard:"Dashboard",clients:"Clientes",overview:"Visão geral",conversations:"Conversas",prospects:"Prospecção",connections:"Conexões",training:"Treinamento da IA",credits:"Créditos",settings:"Configurações"};
let naturalPreviewHistory=[],naturalPreviewBusy=false;
let platformContext={role:"client",name:"Meu espaço"},clientList=[],creditState=null,creditRequests=[],clientSearch="",clientStatusFilter="all",trainingState=null,offerAbState=null,trainingChats=[],trainingSelection=new Set(),trainingMode="all",trainingAllConfirmed=false,trainingBusy=false,clientAccess="",demoLoginCredentials=null;
let workspaceInitialized=false,masterMetrics=null,masterCreateOpen=false;
let billingReminderOpen=false,billingReminderDismissed=false,billingDemoExhausted=false,billingDemoStep=0,billingDemoPackage='',billingLastChecked=0;
let billingCheckoutReturn=null;
try{
 if(new URLSearchParams(location.search).get('pagamento')==='retorno'){
  billingCheckoutReturn={requestId:sessionStorage.getItem('prospector-last-checkout-request')||'',startedAt:Date.now()};
  // Remove the query parameter so refreshes do not falsely suggest another return.
  const clean=new URL(location.href);clean.searchParams.delete('pagamento');clean.hash='#/credits';
  history.replaceState(null,'',clean.pathname+clean.search+clean.hash);
 }
}catch{}
function checkoutReturnBanner(){
 if(!billingCheckoutReturn||platformContext.demo||platformContext.role==='master')return '';
 const order=(creditState?.requests||[]).find(x=>x.id===billingCheckoutReturn.requestId);
 const status=order?.status||'CHECKING',isApproved=status==='APPROVED',isDeclined=status==='DECLINED';
 if(isApproved){try{sessionStorage.removeItem('prospector-last-checkout-request');}catch{}}
 const elapsed=Date.now()-billingCheckoutReturn.startedAt;
 const title=isApproved?'Pagamento confirmado — créditos liberados':isDeclined?'Pedido não aprovado':'Conferindo seu pagamento com a Stripe';
 const description=isApproved?'Seu saldo foi atualizado após o webhook confirmado pela Stripe.':
  isDeclined?'A solicitação não foi concluída. Nenhum crédito foi liberado por este pedido.':
  elapsed>180000?'Ainda não recebemos a confirmação da Stripe. Se pagou via Pix ou outro método assíncrono, acompanhe o status do pedido e atualize seu saldo.':
  'O retorno do checkout não confirma o pagamento. Os créditos serão adicionados somente após a confirmação segura da Stripe.';
 const statusTag=isApproved?'Confirmado':isDeclined?'Não aprovado':'Aguardando confirmação';
 return '<section class="panel billing-return-status" role="status" aria-live="polite"><div><span class="kicker">STRIPE / STATUS DO PEDIDO</span><h3>'+title+'</h3><p>'+description+'</p><span class="tag '+(isApproved?'green':'')+'">'+statusTag+'</span></div><div class="billing-return-actions"><button type="button" class="secondary compact" data-action="refresh-credits">Atualizar saldo</button><button type="button" class="secondary compact" data-action="billing-return-close">Fechar aviso</button></div></section>';
}

let preferredPackage='';
try{preferredPackage=sessionStorage.getItem('prospector-preferred-package')||'';}catch{}
let offerType='portfolio';
const icons={overview:"▦",conversations:"◉",prospects:"⌕",connections:"◫",settings:"⚙"};
let view=Object.keys(tabs).includes(location.hash.split("/")[1])?location.hash.split("/")[1]:"overview";
let salesResults=null,salesFunnel=null,state=null,wa=null,ai=null,voiceMetrics=null,remoteChats=[],selectedThread=null,messages=[],groqSalesProfile=null,interactiveState=null,prospects=null,approachQueue=null,kanban=null,mapsJob=null,mapsResearch=null,mapsTimer=null,mapsPolling=false,prospectFilter="uncontacted",selectedLeadIds=new Set(),approachPreview=null,niche="",city="",busy=false,notice="",qrResult=null,chatFilter="",lastRefresh=0,searchSource="osm",prospectError="",prospectLoading=false,handoffPending=false,consentPolicy=null,consentPolicyBusy=false;
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
let trainingReviewSearch='',trainingShowComposer=false,trainingSetupMinimized=true;
try{trainingSetupMinimized=sessionStorage.getItem('prospector-setup-compact-v2')!=='0';}catch{}
let waAccountsLastCheck=0;
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
  dialog.innerHTML='<form method="dialog" class="prospector-dialog-form"><span class="kicker">PROSPECTOR / CONFIRMAÇÃO</span><h2 id="prospector-dialog-title">'+esc(title)+'</h2><p id="prospector-dialog-description">'+esc(description)+'</p>'+fields+'<div class="prospector-dialog-actions"><button class="secondary" type="button" data-dialog-cancel>Cancelar</button><button class="'+(danger?'danger-button':'primary')+'" type="submit" value="confirm">'+esc(confirmLabel)+'</button></div></form>';
  document.body.append(dialog);
  // "Cancelar" MUST bypass HTML required/minlength validation.
  // A submit-type cancel button leaves the native dialog stuck on invalid forms.
  const cancel=()=>{if(dialog.open)dialog.close('cancel');else{dialog.remove();resolve(null);}};
  dialog.querySelector('[data-dialog-cancel]').addEventListener('click',cancel);
  dialog.addEventListener('cancel',()=>{dialog.returnValue='cancel';});
  dialog.addEventListener('click',event=>{if(event.target===dialog)cancel();});
  dialog.addEventListener('close',()=>{
   const value=dialog.returnValue==='confirm'?Object.fromEntries(new FormData(dialog.querySelector('form'))):null;
   dialog.remove();resolve(value);
  },{once:true});
  try{dialog.showModal();}catch{dialog.remove();resolve(null);}
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
function franciscaOnboarding(){
 if(platformContext.role==='master')return '';
 const connectedIds=waAccounts.filter(item=>item.connected===true).map(item=>String(item.session_id||'')).filter(Boolean);
 const connected=connectedIds.length>0||wa?.connected===true;
 const training=!!trainingState?.profile;
 const recentCompleted=(trainingState?.runs||[]).find(x=>x.status==='REVIEW'||x.status==='APPROVED');
 const analyzedIds=new Set(Array.isArray(recentCompleted?.details?.sessions)?recentCompleted.details.sessions:[]);
 // Never count a new connected channel as analyzed until a later run includes it.
 const needsFreshAnalysis=connectedIds.length>0&&connectedIds.some(id=>!analyzedIds.has(id));
 const analyzed=!!recentCompleted&&!needsFreshAnalysis;
 const hasNewChannel=!!recentCompleted&&needsFreshAnalysis;
 const stages=[
  {title:'Conectar WhatsApp',sub:connectedIds.length?connectedIds.length+' número(s) online. Pode adicionar mais quando quiser.':'Conecte pelo menos um número para começar.',done:connected,tab:'connections',action:'Conectar'},
  {title:'Treinar a Francisca',sub:'Explique suas regras e aprove o treinamento.',done:training,tab:'training',action:'Treinar'},
  {title:hasNewChannel?'Analisar novo WhatsApp':'Analisar conversas',sub:hasNewChannel?'Um novo número foi conectado. Atualize o treinamento com os atendimentos autorizados.':'Ensine o jeito de atender a partir de históricos autorizados.',done:analyzed,tab:'training',action:'Analisar'}
 ];
 if(stages.every(x=>x.done))return '';
 const done=stages.filter(x=>x.done).length;
 return '<aside class="fr-setup-widget '+(trainingSetupMinimized?'is-minimized':'')+'" aria-label="Guia de configuração da Francisca">'+
  '<div class="fr-setup-heading"><div><span class="fr-setup-emblem">✦</span><div><strong>Seu Prospector, passo a passo</strong><small>'+done+' de 3 etapas concluídas</small></div></div><button type="button" data-action="training-setup-toggle" aria-expanded="'+(!trainingSetupMinimized)+'" aria-label="'+(trainingSetupMinimized?'Expandir checklist':'Minimizar checklist')+'">'+(trainingSetupMinimized?'+':'−')+'</button></div>'+
  (trainingSetupMinimized?'':'<div class="fr-setup-body"><div class="fr-setup-track"><span style="width:'+Math.round(done/3*100)+'%"></span></div>'+
  stages.map((x,i)=>'<div class="fr-setup-row '+(x.done?'done':'')+'"><span class="fr-setup-step">'+(x.done?'✓':i+1)+'</span><div><strong>'+esc(x.title)+'</strong><small>'+esc(x.sub)+'</small></div>'+(x.done?'':'<button type="button" class="secondary compact" data-action="'+(i===2?'training-setup-analyze':'training-setup-go')+'" data-tab-target="'+x.tab+'">'+esc(x.action)+'</button>')+'</div>').join('')+'</div>')+'</aside>';
}
function billingNeedsRenewal(){
 if(platformContext.role==='master'||platformContext.unlimited)return false;
 if(platformContext.demo)return billingDemoExhausted;
 if(creditState?.trial?.status==='PENDING')return false;
 const count=Number(creditState?.available??platformContext.available);
 return Number.isFinite(count)&&count<=0;
}
function billingOfferDialog(){
 if(!billingReminderOpen||!billingNeedsRenewal())return '';
 const demo=platformContext.demo===true,packs=creditState?.packages||[];
 const chosen=packs.find(x=>x.id===billingDemoPackage);
 const options=(demo&&billingDemoStep===1&&chosen)?
  '<div class="billing-renew-demo"><div class="billing-summary"><strong>'+esc(chosen.name)+' · '+Number(chosen.credits).toLocaleString('pt-BR')+' abordagens</strong><b>'+moneyFromCents(chosen.priceCents)+'</b></div><h4>Prévia do checkout</h4><p>Na compra real, o cliente paga na página protegida da Stripe. O Prospector não recebe números de cartão.</p><div class="billing-payment-example">▣ <span>Cartão de crédito</span></div><div class="billing-payment-example">◇ <span>Pix, se habilitado pela Stripe</span></div><div class="billing-renew-demo-actions"><button type="button" class="secondary" data-action="billing-demo-back">Voltar</button><small>Exemplo visual. Nenhum pagamento foi criado.</small></div></div>':
  '<div class="billing-renew-plans">'+packs.map(x=>'<article class="billing-renew-plan"><div><strong>'+esc(x.name)+'</strong><small>'+Number(x.credits).toLocaleString('pt-BR')+' abordagens</small></div><b>'+moneyFromCents(x.priceCents)+'</b><button type="button" class="primary compact" data-action="'+(demo?'billing-demo-select':'request-credit-package')+'" data-package="'+esc(x.id)+'">'+(demo?'Ver pagamento':'Escolher')+'</button></article>').join('')+'</div>'+
   (!demo&&!creditState?.automaticBilling?'<p class="billing-renew-warning">Checkout em configuração. Nenhuma cobrança será efetuada até a ativação.</p>':'')+
   '<p class="billing-renew-footnote">Sem renovação automática. Você escolhe quando comprar. Novos créditos só entram após confirmação segura do pagamento.</p>';
 return '<div class="billing-renew-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="billing-renew-title" class="billing-renew-modal"><div class="billing-renew-header"><div><span class="kicker">'+(demo?'DEMONSTRAÇÃO · SEM COBRANÇAS':'RECARREGUE QUANDO PRECISAR')+'</span><h2 id="billing-renew-title">'+(demo?'Como o cliente renova':'Suas abordagens chegaram ao fim')+'</h2><p>'+(demo?'Esta é a experiência quando os 100 créditos gratuitos acabam. Nenhum WhatsApp será acionado.':'Seu painel, treinamento e conversas continuam disponíveis. Para iniciar novas abordagens, escolha uma recarga.')+'</p></div><button type="button" class="billing-renew-close" data-action="billing-reminder-close" aria-label="Fechar aviso de recarga">×</button></div>'+options+'</section></div>';
}
function maybeOpenBillingReminder(){
 if(billingCheckoutReturn)return; // Let the Stripe confirmation status remain visible instead of covering it.
 if(!billingNeedsRenewal()||billingReminderDismissed||billingReminderOpen)return;
 if(!platformContext.demo){try{if(sessionStorage.getItem('prospector-billing-reminder-'+platformContext.id)==='dismissed')return;}catch{}}
 billingReminderOpen=true;render();
}
function shell(){
 const active=tabs[view]||tabs.overview,connected=!!wa?.connected;
 root.innerHTML='<div class="shell"><div class="scrim" data-action="close-menu"></div><aside id="side" class="side" aria-label="Menu principal"><div class="brand"><span class="brand-mark">p<span>.</span></span><div><strong>prospector<span class="accent">.</span></strong><small>BY CONSECOM BRASIL</small></div><button class="side-close" data-action="close-menu" aria-label="Fechar menu">'+glyph('close')+'</button></div><div class="side-label">WORKSPACE</div><nav aria-label="Navegação principal">'+Object.entries(tabs).filter(([key])=>platformContext.role==="master"?["dashboard","clients","credits","settings"].includes(key):!["dashboard","clients"].includes(key)).map(([key,label])=>'<button type="button" class="nav '+(view===key?'active':'')+'" data-tab="'+key+'" title="'+esc(label)+'" aria-label="'+esc(label)+'" '+(view===key?'aria-current="page"':'')+'>'+glyph(key)+'<span>'+label+'</span>'+(view===key?'<span class="nav-indicator"></span>':'')+'</button>').join('')+'</nav><div class="side-spacer"></div><div class="side-panel"><span class="side-panel-label">STATUS DA OPERAÇÃO</span><div class="side-status"><span class="pulse '+(connected?'ok':'')+'"></span><div><strong>'+(platformContext.role==='master'?'Painel master':connected?'WhatsApp conectado':'WhatsApp pendente')+'</strong><small>'+(platformContext.role==='master'?'Gestão de clientes e acessos':connected?'Sessão sincronizada':'Confira em Conexões')+'</small></div></div><p>'+(platformContext.role==='master'?'Abra uma conta de cliente para acessar sua operação.':'Acompanhe conexões, conversas e oportunidades.')+'</p>'+(platformContext.canSwitchWorkspace?'<button type="button" class="workspace-switch-button sidebar-switch" data-action="switch-workspace">'+(platformContext.role==='master'?'Ir para Produção':'Ir para Master')+'</button>':'')+'</div><div class="side-footer"><span class="brand-min">C.</span><div><strong>'+esc(platformContext.name)+'</strong><small>'+(platformContext.role==='master'?'Painel master':'Espaço do cliente')+'</small></div></div></aside><div class="body"><header class="top"><div class="top-left"><button class="hamburger icon-button" data-action="menu" aria-label="Abrir menu">'+glyph('menu')+'</button><div class="top-title"><span class="eyebrow">WORKSPACE / '+esc(active.toUpperCase())+'</span><h1>'+esc(active)+'</h1></div></div><div class="top-right"><span class="status-chip '+(connected?'online':'')+'"><span class="pulse '+(connected?'ok':'')+'"></span><span>'+(platformContext.role==='master'?'Administração':connected?'WhatsApp online':'Desconectado')+'</span></span>'+(platformContext.canSwitchWorkspace?'<button type="button" class="workspace-switch-button" data-action="switch-workspace">'+(platformContext.role==='master'?'Ir para Produção':'Ir para Master')+'</button>':'')+(platformContext.role!=="master"&&!connected?'<button class="wa-inline-connect" type="button" data-action="reconnect-qr">'+glyph('connections')+' Conectar</button>':'')+'<button class="account-logout" type="button" data-action="logout-client" aria-label="Sair da conta">Sair</button><span class="useravatar" aria-hidden="true">'+esc((platformContext.name||'P').trim().charAt(0).toUpperCase()||'P')+'</span></div></header><div class="main-wrap">'+whatsappNotice()+'<div id="notice" class="notice '+(notice?'':'hidden')+'" role="status">'+esc(notice)+'</div><main class="content" id="view" aria-label="'+esc(active)+'"></main><footer class="main-footer"><span>PROSPECTOR / CONSECOM BRASIL</span><span>Ambiente privado · Dados sob sua gestão</span></footer></div></div></div>'+franciscaWidget()+activationModal()+franciscaOnboarding()+billingOfferDialog();
}


function cards(values){
 return '<div class="stats">'+values.map((x,i)=>'<div class="metric"><div class="metric-top"><span class="metric-label">'+esc(x[0])+'</span><span class="metric-index">0'+(i+1)+'</span></div><div class="metric-value">'+esc(x[1])+'</div><div class="metric-help">'+esc(x[2]||'')+'</div></div>').join('')+'</div>';
}
function clientsView(){
 const filterText=clientSearch.trim().toLocaleLowerCase('pt-BR');
 const filtered=clientList.filter(c=>(clientStatusFilter==='all'||c.status===clientStatusFilter)&&(!filterText||(c.name+' '+c.email+' '+(c.phone||'')).toLocaleLowerCase('pt-BR').includes(filterText)));
 const packages=masterMetrics?.packages||[],planLabel=c=>c.unlimited?'Ilimitado':c.trial&&c.planId==='credits'?'Teste grátis':c.planId==='custom'?'Personalizado':packages.find(p=>p.id===c.planId)?.name||'Créditos';
 const form='<div class="master-modal-backdrop" role="presentation"><section role="dialog" aria-modal="true" aria-label="Adicionar cliente" class="master-client-modal"><div class="master-modal-head"><div><span class="kicker">CADASTRO / MASTER</span><h2>Adicionar cliente</h2><p>Crie uma conta privada com o plano adequado.</p></div><button type="button" class="master-modal-close" data-action="master-client-close" aria-label="Fechar formulário">×</button></div><form id="client-create" class="master-new-client-form"><div class="master-form-row"><label>Nome da empresa ou gestor<input name="name" required maxlength="100" placeholder="Nome da empresa" autocomplete="organization"></label><label>E-mail de acesso<input name="email" required maxlength="200" type="email" autocomplete="email" placeholder="contato@empresa.com.br"></label></div><div class="master-form-row"><label>WhatsApp com DDD<input name="phone" required type="tel" placeholder="(15) 99999-9999" maxlength="22" autocomplete="tel"></label><label>CPF do responsável<input name="cpf" required inputmode="numeric" maxlength="14" placeholder="000.000.000-00" autocomplete="off"></label></div><label>Plano do cliente<select id="master-plan-select" name="planId" required><option value="dia1">1 dia · 250 créditos</option>'+packages.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+' · '+Number(p.credits).toLocaleString('pt-BR')+' créditos</option>').filter(x=>!x.includes('value="dia1"')).join('')+'<option value="unlimited">Ilimitado</option><option value="custom">Personalizado</option></select></label><div id="master-custom-fields" class="master-form-row" hidden><label>Créditos personalizados<input name="customCredits" type="number" min="1" max="1000000" placeholder="Ex.: 500"></label><label>Valor em reais (R$)<input name="customPriceBRL" type="number" step="0.01" min="0" placeholder="Ex.: 19.90"></label></div><p class="footnote">Os planos pagos só recebem saldo após pagamento confirmado. O plano ilimitado não concede acesso ao Master. O CPF completo não é exibido nem armazenado em texto aberto.</p><button class="primary" type="submit" '+(busy?'disabled':'')+'>Criar conta e gerar convite</button></form>'+
 (clientAccess?'<div class="access-result master-invite-result"><strong>Conta criada! Convite privado</strong><p>Envie somente ao responsável. O link inicial autoriza acesso a essa conta.</p><input readonly aria-label="Convite de acesso" value="'+esc(clientAccess)+'"><button class="secondary compact" data-action="copy-access">Copiar convite</button></div>':'')+'</section></div>';
 return '<div class="master-clients-view"><div class="workspace-head master-client-heading"><div><span class="kicker">GESTÃO / CONTAS</span><h2>Seus clientes</h2><p>Encontre clientes, confira os planos e administre acessos em um único lugar.</p></div><button type="button" class="primary" data-action="master-client-create">+ Adicionar cliente</button></div>'+
 '<section class="panel master-directory-panel"><div class="master-directory-toolbar"><label class="master-search-field"><span>Pesquisar por nome ou e-mail</span><input id="client-search" type="search" autocomplete="off" placeholder="Busque pelo nome, e-mail ou telefone" value="'+esc(clientSearch)+'"></label><label class="master-filter-field"><span>Contas</span><select id="client-status-filter"><option value="all" '+(clientStatusFilter==='all'?'selected':'')+'>Todas</option><option value="active" '+(clientStatusFilter==='active'?'selected':'')+'>Ativas</option><option value="suspended" '+(clientStatusFilter==='suspended'?'selected':'')+'>Suspensas</option></select></label><span class="master-results-count">'+filtered.length+' de '+clientList.length+' clientes</span></div>'+
 '<div class="master-customer-table">'+(filtered.length?filtered.map(c=>'<article class="master-customer-row"><span class="master-customer-avatar">'+esc(c.name?.charAt(0).toUpperCase()||'?')+'</span><div class="master-customer-identity"><strong>'+esc(c.name)+'</strong>'+(c.demo?'<span class="tag">Conta de demonstração</span>':'')+'<small>'+esc(c.email)+'</small><small>'+esc(c.phone||'Telefone não informado')+' · '+esc(c.cpfMasked||'CPF não cadastrado')+'</small>'+(c.trial?'<small>100 abordagens grátis · '+(c.trial.status==='PENDING'?'Aguardando conferência de CPF':c.trial.status==='APPROVED'?'Identidade conferida': 'Teste não aprovado')+'</small>':'')+'</div><div class="master-customer-plan"><span class="tag '+(c.unlimited?'green':'')+'">'+esc(planLabel(c))+'</span><small>'+(c.unlimited?'Abordagens sem limite de crédito':Number(c.available||0).toLocaleString('pt-BR')+' disponíveis')+'</small></div><div class="master-customer-status"><span class="tag '+(c.status==='active'?'green':'')+'">'+(c.status==='active'?'Ativo':'Suspenso')+'</span></div><div class="master-customer-actions"><button type="button" class="secondary compact" data-action="client-open" data-client="'+esc(c.id)+'">Abrir</button>'+(c.trial?.status==='PENDING'?'<button type="button" class="secondary compact" data-action="trial-review" data-client="'+esc(c.id)+'">Verificar CPF</button>':'')+(c.demo?'<button type="button" class="secondary compact" data-action="client-demo-login" data-client="'+esc(c.id)+'">Gerar login de teste</button>':'')+'<button type="button" class="secondary compact" data-action="client-access" data-client="'+esc(c.id)+'">Novo convite</button>'+(c.internal?'':'<button type="button" class="text-button" data-action="client-status" data-client="'+esc(c.id)+'" data-status="'+(c.status==='active'?'suspended':'active')+'">'+(c.status==='active'?'Suspender':'Reativar')+'</button>')+'</div></article>').join(''):'<div class="empty"><h3>Nenhum cliente encontrado</h3><p>Altere a pesquisa ou adicione seu primeiro cliente.</p></div>')+'</div></section>'+(masterCreateOpen?form:'')+(demoLoginCredentials?'<section class="panel demo-credentials-card"><span class="kicker">CONTA DE TESTE · SEM COBRANÇA</span><h3>Login do cliente demonstrativo</h3><p>100 créditos fictícios, WhatsApp e pagamentos reais desabilitados. Essa senha aparece apenas agora e será substituída quando você gerar outra.</p><label>E-mail<input readonly value="'+esc(demoLoginCredentials.email)+'"></label><label>Senha temporária<input readonly value="'+esc(demoLoginCredentials.password)+'"></label><div class="actions"><button type="button" class="secondary compact" data-action="copy-demo-login">Copiar login</button><button type="button" class="primary" data-action="open-demo-login">Abrir tela de login</button><button type="button" class="secondary compact" data-action="close-demo-login">Ocultar senha</button></div></section>':'')+(clientAccess&&!masterCreateOpen?'<div class="master-access-toast"><strong>Convite gerado</strong><input readonly value="'+esc(clientAccess)+'" aria-label="Convite de acesso"><button class="secondary compact" data-action="copy-access">Copiar</button></div>':'')+'</div>';
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
 if(!platformContext.internalAccount){
  return '<div class="workspace-head"><div><span class="kicker">SEGURANÇA / ADMINISTRAÇÃO</span><h2>Recuperar acesso ao Master</h2><p>Disponível apenas após autenticar o acesso administrativo principal do Prospector.</p></div></div>'+
   '<section class="panel master-security-card"><h3>Redefinir senha da conta Master existente</h3><p>Digite o e-mail que já pertence à conta Master e defina uma nova senha. Nenhum novo administrador será criado. As sessões anteriores serão encerradas.</p>'+
   '<form id="master-recovery" class="stack-form"><label>E-mail atual do Master<input name="email" type="email" autocomplete="username" maxlength="200" required></label>'+
   '<label>Nova senha<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required placeholder="Pelo menos 12 caracteres"></label>'+
   '<label>Confirmar nova senha<input name="confirmPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label>'+
   '<button type="submit" class="primary">Redefinir senha do Master</button></form>'+
   '<p class="footnote">Este formulário exige sessão administrativa autorizada, não recebe a senha antiga e não altera a conta de outros clientes.</p></section>';
 }
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
 const demoBanner=c.demo?'<section class="panel billing-demo-banner"><span class="kicker">DEMONSTRAÇÃO · SEM PAGAMENTO</span><h3>Visualize a experiência do cliente</h3><p>Esta conta inclui 100 créditos fictícios. Ela permite explorar o painel, mas não envia mensagens nem faz cobranças reais.</p><button type="button" class="primary" data-action="billing-demo-toggle">'+(billingDemoExhausted?'Encerrar simulação':'Simular fim dos 100 créditos')+'</button></section>':'';
 const trialInfo=c.trial?'<section class="panel" style="margin-bottom:18px"><span class="kicker">TESTE GRATUITO · 100 ABORDAGENS</span><h3>'+(c.trial.status==='PENDING'?'Seu teste aguarda a conferência do CPF':c.trial.status==='APPROVED'?'Seu teste gratuito já foi liberado':'Seu teste não foi aprovado')+'</h3><p>'+(c.trial.status==='PENDING'?'Nenhum pagamento é necessário. A liberação das '+Number(c.trial.credits||100)+' abordagens depende de uma verificação confiável do nome completo com o CPF informado. Cada CPF, celular e e-mail pode receber o teste uma única vez.':c.trial.status==='APPROVED'?''+Number(c.trial.credits||100)+' abordagens gratuitas foram creditadas uma única vez. As abordagens usam esse saldo conforme as regras do canal.':'Para esclarecer a verificação de identidade, entre em contato com o suporte Consecom.')+'</p></section>':'';
 return '<div class="workspace-head"><div><span class="kicker">CRÉDITOS SOB DEMANDA</span><h2>Escolha seu ritmo. A IA faz o restante.</h2><p>Sem mensalidade obrigatória. Uma nova abordagem aceita pelo canal consome um crédito; a continuidade da mesma conversa não consome novos créditos de abordagem.</p></div></div>'+
 demoBanner+trialInfo+checkoutReturnBanner()+'<div class="credit-summary-grid"><section class="panel credit-balance"><span>Seu saldo disponível</span><strong>'+esc(c.available??platformContext.available??0)+'</strong><p>créditos de abordagem</p><button class="secondary compact" data-action="refresh-credits">Atualizar saldo</button></section><section class="panel credit-explain"><span class="kicker">COMO FUNCIONA</span><h3>Créditos sem vencimento</h3><p>Escolha um pacote e pague no checkout seguro da Stripe quando estiver disponível. Os créditos são liberados somente após a confirmação de pagamento.</p><p><strong>Importante:</strong> comprar um pacote maior não aumenta o teto de até 250 novas abordagens por dia nem garante entregas.</p></section></div>'+
 '<div class="heading credit-package-title"><div><h3>Pacotes disponíveis</h3><p>Escolha o que combina com sua operação.</p></div></div>'+
 (preferredPackage&&packs.some(p=>p.id===preferredPackage)?'<div class="credit-preference"><div><strong>Seu pacote escolhido na landing: '+esc(packs.find(p=>p.id===preferredPackage).name)+'</strong><p>Você já criou seu acesso. Se quiser, envie o pedido para a Consecom liberar os créditos após o pagamento.</p></div><button class="primary" data-action="request-credit-package" data-package="'+esc(preferredPackage)+'">Solicitar pacote selecionado</button></div>':'')+
 '<div class="credit-packages-grid">'+packs.map(p=>'<article class="credit-packet '+(p.id==='dias7'?'featured':'')+'"><div class="credit-packet-top"><span>'+esc(p.name)+'</span>'+(p.id==='dias7'?'<span class="tag green">Mais indicado</span>':'')+'</div><strong class="credit-packet-volume">'+Number(p.credits).toLocaleString('pt-BR')+'</strong><small>abordagens</small><div class="credit-packet-price">'+moneyFromCents(p.priceCents)+'</div><p>'+'R$ '+(p.priceCents/100/p.credits).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:5})+' por abordagem</p><button class="primary" data-action="request-credit-package" data-package="'+esc(p.id)+'">Solicitar '+esc(p.name)+'</button></article>').join('')+'</div>'+
 '<section class="panel"><div class="heading"><div><h3>Meus pedidos de recarga</h3><p>Um pedido não é uma cobrança automática.</p></div><button class="secondary compact" data-action="refresh-credits">Atualizar</button></div>'+(requests.length?'<div class="orders-list">'+requests.slice(0,15).map(x=>'<div class="order-row"><div class="order-identity"><strong>'+Number(x.credits).toLocaleString('pt-BR')+' créditos · '+moneyFromCents(x.price_cents)+'</strong><small>'+stamp(x.created_at)+'</small></div><span class="tag '+(x.status==='APPROVED'?'green':'')+'">'+(x.status==='PENDING'?'Aguardando confirmação':x.status==='APPROVED'?'Créditos liberados':'Não aprovado')+'</span>'+(x.status==='PENDING'&&c.automaticBilling&&!c.demo?'<button type="button" class="secondary compact" data-action="request-credit-resume" data-request="'+esc(x.id)+'">Continuar pagamento</button>':'')+'</div>').join('')+'</div>':'<div class="empty"><p>Você ainda não solicitou uma recarga.</p></div>')+'</section>'+
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
 return '<section class="panel training-manual"><div class="heading"><div><span class="kicker">DO SEU JEITO</span><h3>O que seu atendimento precisa saber?</h3><p>Explique com suas próprias palavras. As novas orientações são acrescentadas ao rascunho, sem apagar as regras anteriores. Você decide quando aprovar.</p></div></div>'+
 '<div class="training-tips"><strong>Você pode contar:</strong><span>O que sua empresa faz</span><span>Para quem vocês vendem</span><span>Quais serviços oferecem</span><span>Como prefere responder e quando assumir</span></div>'+
 '<div class="training-messages" role="log" aria-label="Conversa de treinamento">'+(t.chat?.length?t.chat.map(m=>'<div class="training-message '+(m.role==='user'?'sent':'received')+'"><small>'+(m.role==='user'?'Você':'Assistente de treinamento')+'</small><p>'+esc(m.body)+'</p></div>').join(''):'<div class="training-welcome"><strong>Conte como sua empresa trabalha.</strong><p>Exemplo: “Atendemos oficinas mecânicas, oferecemos gestão de tráfego e preferimos perguntas curtas. Quando alguém pedir valores, me avise para eu assumir.”</p></div>')+'</div>'+
 '<form class="training-composer" id="training-chat"><label class="sr-only" for="training-input">Orientações para a IA</label><textarea id="training-input" name="text" maxlength="3000" rows="3" required placeholder="Fale de forma natural sobre a sua empresa…">'+esc(trainingRecordedText)+'</textarea><div class="training-compose-actions"><button type="button" class="secondary training-record '+(trainingRecording?'recording':'')+'" data-action="training-record-toggle">'+(trainingRecording?'■ Parar gravação':'🎙 Falar por áudio')+'</button><button class="primary" type="submit" '+(trainingBusy?'disabled':'')+'>Enviar orientação ↗</button></div></form>'+
 '<p class="footnote">Áudios são transcritos para um texto que você confere antes de enviar. A gravação original não é salva pelo painel.</p></section>';
}
function trainingAnalysisReview(t){
 const analysis=t.analysis||{cards:[]};
 const cards=Array.isArray(analysis.cards)?analysis.cards:[];
 if(!cards.length)return '';
 const term=trainingReviewSearch.trim().toLocaleLowerCase('pt-BR');
 const filtered=cards.filter(c=>!term||(c.title+' '+c.summary+' '+(c.points||[]).join(' ')).toLocaleLowerCase('pt-BR').includes(term));
 const cardMarkup=filtered.map(c=>{
  const status=c.status==='added'?'Adicionada para aprovação':c.status==='ignored'?'Ignorada':'Aguardando decisão';
  const buttons=c.status==='new'?
   '<button type="button" class="primary compact" data-action="training-analysis-add" data-id="'+esc(c.id)+'">Revisar e adicionar</button><button type="button" class="secondary compact" data-action="training-analysis-ignore" data-id="'+esc(c.id)+'">Ignorar</button>':
   c.status==='ignored'?'<button type="button" class="secondary compact" data-action="training-analysis-restore" data-id="'+esc(c.id)+'">Restaurar sugestão</button>':
   '<span class="fr-suggestion-added">✓ No rascunho para aprovação</span>';
  return '<article class="fr-review-card fr-suggestion-card '+(c.status==='ignored'?'is-ignored':'')+'">'+
   '<div class="fr-review-card-top"><span class="fr-review-symbol">✦</span><small>'+status+'</small></div>'+
   '<h4>'+esc(c.title)+'</h4><p>'+esc(c.summary||'Sugestão baseada nas conversas analisadas.')+'</p>'+
   '<details><summary>Entender a sugestão</summary><ul>'+((c.points||[]).map(x=>'<li>'+esc(x)+'</li>').join('')||'<li>Reveja a orientação proposta antes de adicioná-la.</li>')+'</ul></details>'+
   '<div class="fr-review-card-actions fr-review-card-footer">'+buttons+'</div></article>';
 }).join('');
 return '<section class="fr-analysis-suggestions" id="fr-analysis-suggestions" aria-label="Sugestões da análise do WhatsApp">'+
  '<div class="fr-analysis-suggestions-head"><div><span class="kicker">APRENDIZADO DAS CONVERSAS</span><h4>Sugestões aguardando sua revisão</h4><p>A Francisca identificou padrões em '+Number(analysis.conversations||0)+' conversa(s). Escolha o que faz sentido. Nenhuma sugestão entra no atendimento automaticamente.</p></div>'+
  '<span class="tag">'+Number(analysis.pendingCount||0)+' para revisar</span></div>'+
  (filtered.length?'<div class="fr-review-grid">'+cardMarkup+'</div>':'<p class="fr-review-empty">Nenhuma sugestão corresponde à pesquisa.</p>')+
  '</section>';
}
function trainingProfile(t){
 const review=t.review||{cards:[]},cards=review.cards||[],globalCards=review.globalCards||[];
 const ready=!!t.profile,needsReview=!!t.draft;
 const search=trainingReviewSearch.trim().toLocaleLowerCase('pt-BR');
 const matches=v=>!search||String(v).toLocaleLowerCase('pt-BR').includes(search);
 const filtered=cards.filter(c=>matches(c.title+' '+c.summary+' '+(c.points||[]).join(' ')));
 const filteredGlobal=globalCards.filter(c=>matches(c.title+' '+c.summary+' '+(c.points||[]).join(' ')));
 const evidence=t.salesEvidence?.items||[];
 const filteredEvidence=evidence.filter(m=>matches(m.title+' '+(m.description||'')+' '+(m.url||'')+' '+m.kind));
 const ruleCards=filtered.map(c=>'<article class="fr-review-card" data-review-card="'+esc(c.id)+'"><div class="fr-review-card-top"><span class="fr-review-symbol">'+glyph('check')+'</span><small>'+esc(c.count||0)+' orientações</small></div><h4>'+esc(c.title)+'</h4><p>'+esc(c.summary||'Sem descrição. Abra para revisar.')+'</p><details><summary>Ver todas as orientações</summary><ul>'+((c.points||[]).map(point=>'<li>'+esc(point)+'</li>').join('')||'<li>Nenhuma orientação adicional.</li>')+'</ul></details><div class="fr-review-card-actions fr-review-card-footer"><button class="secondary compact" type="button" data-action="training-review-edit" data-id="'+esc(c.id)+'" data-index="'+c.index+'">Editar</button><button class="secondary compact fr-delete-action" type="button" data-action="training-review-delete" data-id="'+esc(c.id)+'" data-index="'+c.index+'">Excluir</button></div></article>').join('');
 const sharedCards=filteredGlobal.map(c=>'<article class="fr-review-card fr-shared-card"><div class="fr-review-card-top"><span class="fr-review-symbol">✦</span><small>Método geral</small></div><h4>'+esc(c.title)+'</h4><p>'+esc(c.summary||'Método de vendas compartilhado')+'</p><details><summary>Ver orientações</summary><ul>'+(c.points||[]).map(point=>'<li>'+esc(point)+'</li>').join('')+'</ul></details><div class="fr-review-card-actions fr-review-card-footer"><button type="button" class="secondary compact" data-action="training-review-copy" data-id="'+esc(c.id)+'" data-index="'+c.index+'">Editar</button><button type="button" class="secondary compact fr-delete-action" data-action="training-review-hide-shared" data-id="'+esc(c.id)+'" data-index="'+c.index+'">Excluir</button></div></article>').join('');
 const materialCards=filteredEvidence.map(x=>'<article class="fr-review-card fr-reference-card"><div class="fr-review-card-top"><span class="fr-review-symbol">▧</span><small>'+(x.approved?'Aprovado':'Aguardando revisão')+'</small></div><h4>'+esc(x.title)+'</h4><p>'+esc(x.description||'Arquivo ou link de referência')+'</p><div class="fr-review-card-actions">'+(x.url?'<a href="'+esc(x.url)+'" rel="noopener noreferrer" target="_blank">Abrir referência ↗</a>':'')+(x.mediaId?'<a href="/api/media/'+esc(x.mediaId)+'" target="_blank" rel="noopener noreferrer">Ver material ↗</a>':'')+'<button type="button" class="secondary compact" data-action="training-proof-edit" data-id="'+esc(x.id)+'">Editar</button>'+(!x.approved?'<button type="button" class="secondary compact" data-action="training-proof-approve" data-id="'+esc(x.id)+'">Aprovar</button>':'')+'<button type="button" class="secondary compact" data-action="training-proof-remove" data-id="'+esc(x.id)+'">Excluir</button></div></article>').join('');
 const status=needsReview?'<span class="tag">Alterações aguardando aprovação</span>':ready?'<span class="tag green">Treinamento ativo</span>':'<span class="tag">Ainda não treinada</span>';
 return '<section class="panel francisca-review"><div class="heading"><div><span class="kicker">REVISÃO DO GESTOR</span><h3>O que a Francisca aprendeu</h3><p>Consulte tudo que ela pode explicar, oferecer e como deve responder. Edite uma orientação de cada vez, sem precisar trabalhar com arquivos técnicos.</p></div>'+status+'</div>'+
 '<div class="fr-review-toolbar"><label class="fr-review-search">'+glyph('search')+'<input id="training-review-search" type="search" aria-label="Buscar nos treinamentos" placeholder="Pesquisar serviços, respostas, regras..." value="'+esc(trainingReviewSearch)+'"></label><button type="button" class="primary" data-action="training-review-add">+ Adicionar</button></div>'+
 (needsReview?'<div class="fr-review-pending"><div><strong>Revise antes de publicar</strong><p>A Francisca continua usando o treinamento já aprovado até você confirmar as mudanças.</p></div><button type="button" class="primary" data-action="training-review-approve">Aprovar alterações</button></div>':'')+
 (trainingShowComposer?'<div class="fr-review-composer"><div class="heading"><div><h4>Ensine algo novo conversando com a Francisca</h4><p>Ex.: “Quando perguntarem sobre prazo, explique nossas condições e avise o gestor se for urgente.”</p></div><button type="button" class="secondary compact" data-action="training-review-close">Fechar</button></div>'+trainingConversation(t)+'<button type="button" class="secondary compact" data-action="training-review-new">Ou criar uma orientação manual</button></div>':'')+
 '<div class="fr-review-stats"><span>'+cards.length+' regras da empresa</span><span>'+globalCards.length+' orientações do método geral</span><span>'+evidence.length+' materiais</span>'+(review.hiddenGlobalCount?'<button class="secondary compact" type="button" data-action="training-review-restore-shared">Restaurar '+review.hiddenGlobalCount+' orientação(ões) ocultada(s)</button>':'')+'</div>'+ 
 trainingAnalysisReview(t)+'<div class="fr-review-grid">'+(ruleCards+materialCards+sharedCards||'<div class="fr-review-empty">Nenhum treinamento corresponde à pesquisa. Tente outra palavra ou adicione uma orientação.</div>')+'</div>'+
 '<details class="fr-review-materials"><summary><strong>Gerenciar materiais que ela pode apresentar</strong><span>Adicionar link, imagem ou PDF autorizado</span></summary>'+trainingMaterials()+'</details>'+
 (!needsReview&&ready?'<p class="fr-review-hint">Treinamento aprovado e ativo. Novas edições só entram no atendimento depois da revisão do gestor.</p>':'')+'</section>';
}
function trainingAnalysis(t){
 const run=t.runs?.[0]||null,running=run?.status==='RUNNING';
 const percent=Math.max(0,Math.min(100,Number(run?.details?.percent||0)));
 const count=Math.max(waAccounts.filter(x=>x.connected===true).length,wa?.connected===true?1:0);
 const connected=count>0;
 const ready=!!t.profile&&connected;
 const latestCompleted=(t.runs||[]).find(x=>x.status==='REVIEW'||x.status==='APPROVED');
 const covered=new Set(Array.isArray(latestCompleted?.details?.sessions)?latestCompleted.details.sessions:[]);
 const liveIds=waAccounts.filter(x=>x.connected===true).map(x=>x.session_id).filter(Boolean);
 const hasNewChannel=!!latestCompleted&&liveIds.some(id=>!covered.has(id));
 return '<section class="panel fr-analysis"><div class="heading"><div><span class="kicker">ÚLTIMA ETAPA · APRENDER COM SEUS ATENDIMENTOS</span><h3>Analisar conversas do WhatsApp</h3><p>Depois do treinamento, a Francisca identifica como sua equipe conversa, pergunta e responde. As sugestões ficam aguardando sua revisão.</p></div><span class="tag '+(run?.status==='REVIEW'?'green':'')+'">'+(running?'Analisando em segundo plano':hasNewChannel?'Novo número para analisar':run?.status==='REVIEW'?'Análise concluída':'Etapa final')+'</span></div>'+
 (!t.profile?'<div class="fr-analysis-gate"><strong>Finalize e aprove o treinamento primeiro</strong><p>Conclua a conversa com a Francisca e revise as orientações acima para liberar a análise.</p></div>':'')+
 (!connected?'<div class="training-connect-notice"><span class="training-connection-icon">'+glyph('connections')+'</span><div><strong>Conecte pelo menos um WhatsApp</strong><p>Você escolhe quantos números deseja conectar. A análise fica disponível assim que ao menos um estiver online.</p></div><button type="button" class="primary" data-tab="connections">Conectar números</button></div>':
 '<p class="fr-analysis-ready">✓ '+count+' número(s) conectado(s). É possível analisar agora; novos números poderão ser analisados depois.</p>')+
 (running?'<div class="fr-analysis-progress" role="progressbar" aria-label="Andamento da análise de conversas" aria-valuenow="'+percent+'" aria-valuemin="0" aria-valuemax="100"><div><strong>Analisando mensagens...</strong><span>'+percent+'%</span></div><i><b style="width:'+percent+'%"></b></i><p>Pode continuar usando as outras telas. O processamento ocorre no servidor e o progresso é salvo.</p></div>':
 run?.status==='REVIEW'?'<div class="fr-analysis-result"><strong>'+(hasNewChannel?'Novo WhatsApp conectado':'✓ Conversas analisadas')+'</strong><p>'+Number(run.details?.conversations||0)+' conversa(s) incluída(s) na última análise. '+(hasNewChannel?'Você pode analisar tudo novamente para incluir o novo número.':'A Francisca preparou sugestões para revisão do gestor.')+'</p><button type="button" class="secondary compact" data-action="training-review-focus">Revisar sugestões</button></div>':
 run?.status==='FAILED'?'<p class="fr-analysis-warning">A análise anterior não terminou: '+esc(run.details?.error||'Tente novamente após verificar a conexão.')+'</p>':'')+
 (!running?'<div class="fr-analysis-start"><label class="training-all-confirm"><input id="training-all-confirm" type="checkbox" '+(trainingAllConfirmed?'checked':'')+'> Confirmo que os históricos diretos destes números são profissionais e tenho autorização para utilizá-los no treinamento. Não incluirei conversas pessoais.</label><button type="button" class="primary" data-action="training-analyze" '+(!ready||trainingBusy?'disabled':'')+'>'+(hasNewChannel?'Analisar tudo novamente ↗':'Analisar conversas ↗')+'</button></div>':'')+
 '<p class="footnote">A análise não envia mensagens nem acessa grupos. Confirme que os históricos usados são comerciais; não selecione conversas pessoais. Nenhuma sugestão entra em uso antes da aprovação.</p></section>';
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
 if(text.length<2&&!(['approach','closing_mode','payment_methods'].includes(trainingState?.interview?.step)&&/^[1-5]$/.test(text))){n('Responda à pergunta antes de continuar.');return;}
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
function trainingMaterials(){
 const t=trainingState||{},e=t.salesEvidence||{items:[]};
 const library='<section class="panel training-addons-card"><div class="heading"><div><span class="kicker">REFERÊNCIAS DA FRANCISCA</span><h3>Materiais que ela pode apresentar</h3><p>Imagens, PDFs, cases, depoimentos autorizados e links.</p></div><span class="tag">'+(e.approved?.length||0)+' aprovados</span></div>'+
 '<form id="training-proof-form" class="training-addons-form"><div class="training-addons-pair"><label>Tipo<select name="kind"><option value="portfolio">Portfólio</option><option value="case">Case</option><option value="testimonial">Depoimento</option><option value="other">Outro</option></select></label><label>Título<input name="title" maxlength="120" required placeholder="Ex.: Site de oficina"></label></div><label>Descrição comprovável<input name="description" maxlength="350" placeholder="Explique o que realmente foi entregue"></label><label>Link HTTPS (opcional)<input name="url" type="url" maxlength="700" placeholder="https://..."></label><label>Ou envie imagem ou PDF de até 8 MB<input name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></label><label class="training-consent-check"><input type="checkbox" name="authorized" required> Tenho autorização para usar este material comercialmente.</label><button class="primary" type="submit">Adicionar material</button></form>'+
 ((e.items||[]).length?'<div class="training-proof-list">'+e.items.map(x=>'<article class="training-proof-item"><div><strong>'+esc(x.title)+'</strong><small>'+esc(x.kind)+' · '+(x.approved?'Aprovado':'Aguardando aprovação')+'</small><p>'+esc(x.description||'')+'</p>'+(x.url?'<a target="_blank" rel="noopener noreferrer" href="'+esc(x.url)+'">Ver link ↗</a>':'')+(x.mediaId?'<a target="_blank" rel="noopener noreferrer" href="/api/media/'+esc(x.mediaId)+'">Ver arquivo ↗</a>':'')+'</div><div class="training-proof-controls">'+(!x.approved?'<button type="button" class="secondary compact" data-action="training-proof-approve" data-id="'+esc(x.id)+'">Aprovar</button>':'')+'<button type="button" class="secondary compact" data-action="training-proof-remove" data-id="'+esc(x.id)+'">Excluir</button></div></article>').join('')+'</div>':'<p class="training-muted">Nenhum material cadastrado. Você pode continuar e acrescentar depois.</p>')+'</section>';
 return library;
}
function trainingSalesExtras(){
 const t=trainingState||{},e=t.salesEvidence||{items:[]},closing=t.closing||{},mode=closing.mode||'handoff',methods=new Set(closing.methods||[]);
 const options=[['pix','PIX'],['card','Cartão'],['transfer','Transferência'],['invoice','Boleto']];
 const closingPanel='<section class="panel training-addons-card"><div class="heading"><div><span class="kicker">FECHAMENTO E COBRANÇAS</span><h3>Escolha a autonomia da Francisca</h3><p>A IA pode encaminhar interessados ou conduzir até o pedido de pagamento aprovado.</p></div></div><form id="training-closing-form" class="training-addons-form"><label>Quando houver interesse<select name="mode"><option value="handoff" '+(mode==='handoff'?'selected':'')+'>Avisar e transferir para mim</option><option value="complete" '+(mode==='complete'?'selected':'')+'>Francisca negocia e solicita pagamento</option></select></label><fieldset><legend>Formas de pagamento</legend>'+options.map(([key,label])=>'<label><input type="checkbox" name="methods" value="'+key+'" '+(methods.has(key)?'checked':'')+'>'+label+'</label>').join('')+'</fieldset><div class="training-addons-pair"><label>Entrada (%)<input name="depositPercent" type="number" min="0" max="100" step="1" value="'+esc(closing.depositPercent??50)+'"></label><label>Nome do titular PIX<input name="pixName" maxlength="100" value="'+esc(closing.pixName||'')+'"></label></div><label>Chave PIX '+(closing.pixConfigured?'(cadastrada · '+esc(closing.pixMasked)+')':'(não cadastrada)')+'<input name="pixKey" type="password" maxlength="140" autocomplete="off" placeholder="'+(closing.pixConfigured?'Em branco mantém a chave atual':'Digite a chave PIX da empresa')+'"></label><p class="training-muted">A chave fica no espaço da empresa, não no método global. A Francisca registra o fechamento comercial ao receber o comprovante e avisa você para visualizar.</p><button type="submit" class="primary">Salvar política de fechamento</button></form>'+
 ((t.paymentQueue||[]).length?'<div class="training-payment-queue"><h4>Comprovantes recebidos</h4>'+t.paymentQueue.map(x=>'<div class="training-payment-row"><div><strong>'+esc(x.business||'Cliente')+'</strong><small>'+esc(x.status)+' · entrada '+moneyFromCents(x.entry_cents)+'</small></div>'+(x.status==='RECEIPT_RECEIVED'?'<a class="secondary compact" href="https://wa.me/'+esc(x.phone||'')+'" rel="noopener noreferrer" target="_blank">Abrir comprovante no WhatsApp ↗</a>':'')+'</div>').join('')+'</div>':'')+'</section>';
 return '<div class="training-autonomy-layout">'+closingPanel+'</div>'; // A/B oferta da Consecom permanece apenas na operação privada, não no treinamento dos clientes.
}

function interviewView(){
 const t=trainingState||{},i=t.interview;
 const top='<div class="workspace-head"><div><span class="kicker">TREINAMENTO DA IA</span><h2>Converse com a Francisca.</h2><p>Ela faz perguntas objetivas e adapta o treinamento à sua empresa e aos seus serviços.</p></div><span class="tag '+(t.profile?'green':'')+'">'+(t.profile?'Perfil aprovado':'Aguardando treinamento')+'</span></div>';
 let body='';
 if(t.internalAccount&&t.profile){
  body='<section class="panel interview-owner-ready"><span class="interview-owner-ready-icon" aria-hidden="true">✓</span><span class="kicker">CONSECOM BRASIL · OPERAÇÃO ORIGINAL</span><h3>Sua Francisca já está treinada.</h3><p>O perfil comercial da Consecom e a abordagem em duas etapas do Wesley estão preservados. A entrevista de novos clientes não é necessária aqui.</p><div class="interview-owner-ready-points"><span>✓ Método global de vendas</span><span>✓ Perfil exclusivo da Consecom</span><span>✓ Abordagem do Wesley</span><span>✓ Manual editável sob revisão</span></div><button type="button" class="secondary" data-action="training-edit-profile">Editar meu treinamento</button><p class="interview-hint">Qualquer alteração precisa ser revisada e aprovada; a Francisca mantém o manual atual até lá.</p></section>';
 }else if(!i){
  body='<section class="panel interview-welcome"><span class="interview-avatar">F</span><span class="kicker">OI! SOU A FRANCISCA</span><h3>Você quer fazer meu treinamento escrito ou por voz?</h3><p>Eu vou aprender o que você vende, para quem vende, valores, condições e quando devo avisar você.</p><div class="interview-modes"><button type="button" data-action="interview-start" data-mode="voice"><span>◉</span><strong>Por voz</strong><small>Eu pergunto em voz alta, escuto suas respostas e também mostro tudo por escrito.</small><b>Começar por voz ↗</b></button><button type="button" data-action="interview-start" data-mode="text"><span>✎</span><strong>Por escrito</strong><small>Uma conversa natural no chat. Responda com calma e revise no final.</small><b>Começar por chat ↗</b></button></div><p class="interview-hint">Seu perfil só será usado após sua aprovação.</p></section>';
 }else{
  const messages=(i.messages||[]).map(m=>'<div class="interview-line '+(m.role==='user'?'user':'assistant')+'">'+(m.role==='assistant'?'<span class="interview-small-avatar">F</span>':'')+'<div class="interview-bubble"><small>'+(m.role==='assistant'?'Francisca':'Você')+'</small><p>'+esc(m.body)+'</p></div></div>').join('');
  body='<section class="panel interview-chat"><header><div><span class="interview-small-avatar">F</span><div><strong>Francisca</strong><small>'+(i.mode==='voice'?'Treinamento por voz e chat':'Treinamento por chat')+'</small></div></div><div><span class="tag">'+esc(i.progress)+'%</span><button type="button" class="secondary compact" data-action="interview-reset">Recomeçar</button></div></header><div class="interview-progress" role="progressbar" aria-label="Progresso do treinamento" aria-valuenow="'+esc(i.progress)+'" aria-valuemin="0" aria-valuemax="100"><span style="width:'+esc(i.progress)+'%"></span></div><div class="training-interview-feed" role="log" aria-live="polite">'+messages+'</div>'+
  (['approach','closing_mode','payment_methods'].includes(i.step)&&Array.isArray(i.choices)&&i.choices.length?'<div class="interview-approach-options" role="group" aria-label="Escolha sua abordagem inicial">'+i.choices.map((opt,index)=>'<button type="button" data-action="interview-choice" data-choice="'+esc(opt.id)+'" '+(interviewSending?'disabled':'')+'><span class="approach-number">'+(index+1)+'</span><strong>'+esc(opt.label)+'</strong><small>'+esc(opt.description)+'</small></button>').join('')+'</div>':'')+
  (i.completed?'<p class="interview-completed">✓ Entrevista concluída. Revise o perfil abaixo antes de ativar.</p>':
  '<form id="interview-compose"><label class="sr-only" for="interview-answer">Sua resposta</label><textarea id="interview-answer" name="text" maxlength="850" rows="2" placeholder="'+(i.step==='approach_custom'?'Escreva a mensagem exata, com {{nome}}, {{empresa}} e {{servico}}…':'Responda escrevendo ou por voz…')+'" '+(interviewSending?'disabled':'')+'>'+esc(interviewInput)+'</textarea><div class="interview-compose-actions"><button type="button" class="secondary '+(interviewVoice?'recording':'')+'" data-action="interview-voice-toggle">'+(interviewVoice?'Desligar voz':'Conversar por voz')+'</button><button type="submit" class="primary" '+(interviewSending?'disabled':'')+'>'+(interviewSending?'Registrando…':'Enviar ↗')+'</button></div><p id="interview-voice-status" role="status">'+esc(interviewVoiceLabel())+'</p></form>')+
  '<p class="interview-hint">Você pode falar e escrever. Áudios são transcritos, não salvos como gravação. Nada é ativado sem sua aprovação.</p></section>';
 }
 const shownTraining=t.internalAccount&&t.profile&&t.draft?.source==='interview'?{...t,draft:null}:t;
 const profile=((t.internalAccount&&t.profile)||i?.completed||(!i&&(t.profile||t.draft))||(t.analysis?.cards||[]).length)?'<div class="interview-profile">'+trainingProfile(shownTraining)+'</div>':'';
 const advanced='<div class="interview-final-stage">'+trainingAnalysis(t)+'</div>';
 const shared='<div class="training-markdown-info"><span><strong>Método global de vendas</strong> · compartilhado e somente leitura. O seu perfil de serviços, preços e tom é privado.</span><a href="/api/training/global.md" download="francisca-vendas-global.md" class="secondary compact">Baixar base global .md ↗</a></div>';
 return top+'<div class="interview-layout">'+body+'</div>'+profile+trainingSalesExtras()+advanced;
}
// Private roleplay sandbox: no real clients, WhatsApp sends or production leads.
function naturalPreviewView(){
 if(!trainingState?.internalAccount)return '';
 const transcript=naturalPreviewHistory.length?naturalPreviewHistory.map(item=>
  '<div class="training-message '+(item.role==='user'?'sent':'received')+'"><small>'+
  (item.role==='user'?'Cliente fictício':'Francisca Natural')+'</small><p>'+esc(item.text)+'</p></div>'
 ).join(''):'<div class="training-welcome"><strong>Teste como a Francisca responde.</strong><p>Experimente: “Já tenho site”, “achei caro”, “vou falar com meu sócio” ou simule uma conversa inteira.</p></div>';
 return '<section class="panel" style="margin-bottom:20px"><div class="heading"><div>'+
 '<span class="kicker">LABORATÓRIO • SEM ENVIOS</span><h3>Testar conversa natural</h3>'+
 '<p>Converse com a nova Francisca como se fosse um cliente. Este teste não envia WhatsApp nem acessa leads.</p>'+
 '</div></div><div class="training-messages" role="log" aria-label="Simulação da conversa natural" style="min-height:130px;max-height:390px;overflow:auto">'+transcript+'</div>'+
 '<form class="training-composer" id="natural-preview-form">'+
 '<label for="natural-preview-text" class="sr-only">Mensagem do cliente fictício</label>'+
 '<textarea id="natural-preview-text" name="text" maxlength="1500" rows="2" required placeholder="Escreva aqui como se fosse um cliente..." '+(naturalPreviewBusy?'disabled':'')+'></textarea>'+
 '<div class="training-compose-actions">'+
 '<button type="button" class="secondary" data-action="natural-preview-clear" '+(naturalPreviewBusy?'disabled':'')+'>Reiniciar conversa</button>'+
 '<button type="submit" class="primary" '+(naturalPreviewBusy?'disabled':'')+'>'+(naturalPreviewBusy?'Respondendo…':'Enviar mensagem de teste')+'</button>'+
 '</div></form><p class="footnote">Somente simulação. Nenhuma mensagem será enviada ou salva no WhatsApp.</p></section>';
}
function trainingView(){return naturalPreviewView()+interviewView();}

async function loadMasterMetrics(){try{masterMetrics=await api('/api/platform/analytics');if(platformContext.role==='master'&&view==='dashboard')render();}catch(e){n('Indicadores indisponíveis: '+e.message);}}
async function loadClients(){try{const [clients,requests]=await Promise.all([api('/api/platform/clients'),api('/api/platform/credit-requests')]);clientList=clients.items||[];creditRequests=requests.items||[];if(platformContext.role==='master')render();}catch(e){n(e.message);}}
async function loadCredits(){if(platformContext.role==='master')return;try{creditState=await api('/api/platform/credits');billingLastChecked=Date.now();platformContext.available=creditState.available;if(view==='credits')render();maybeOpenBillingReminder();}catch(e){n(e.message);}}
async function loadTraining(){try{const wasRunning=trainingState?.runs?.some(x=>x.status==='RUNNING');trainingState=await api('/api/training');if(trainingState?.internalAccount){try{offerAbState=await api('/api/prospecting/offer-ab');}catch{offerAbState=null;}}if((view==='training'&&!q('textarea:focus,input:focus'))||(view!=='training'&&wasRunning&&!trainingState?.runs?.some(x=>x.status==='RUNNING')))render();}catch(e){n(e.message);}}

let stripeEmbeddedInstance=null;
async function openProspectorCheckout(order){
 if(!order?.clientSecret||!order?.publishableKey)return false;
 if(!/^pk_live_/.test(order.publishableKey))throw Error('Checkout não configurado.');
 const existing=document.querySelector('#prospector-embedded-payment');if(existing)existing.remove();
 const overlay=document.createElement('div');overlay.id='prospector-embedded-payment';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Pagamento seguro');
 overlay.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(8,11,19,.82);display:flex;align-items:center;justify-content:center;padding:14px;overflow:auto';
 const panel=document.createElement('section');panel.style.cssText='position:relative;width:min(100%,640px);max-height:95vh;overflow:auto;background:#fff;color:#141414;padding:24px;border-radius:18px;box-shadow:0 20px 80px #0005';
 const heading=document.createElement('div');heading.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px';
 const title=document.createElement('strong');title.textContent='Pagamento seguro · Prospector';
 const close=document.createElement('button');close.type='button';close.textContent='Fechar';close.style.cssText='padding:8px 14px;border-radius:9px;border:1px solid #ddd;background:#fff;color:#222;cursor:pointer';
 const mount=document.createElement('div');mount.id='prospector-stripe-checkout';
 const info=document.createElement('p');info.textContent='Pix e cartão são processados de forma segura pela Stripe. Créditos somente após confirmação do pagamento.';info.style.cssText='font-size:12px;color:#666;line-height:1.5';
 heading.append(title,close);panel.append(heading,info,mount);overlay.append(panel);document.body.append(overlay);
 const release=()=>{try{stripeEmbeddedInstance?.destroy();}catch{}stripeEmbeddedInstance=null;overlay.remove();};
 close.addEventListener('click',release);overlay.addEventListener('click',e=>{if(e.target===overlay)release();});
 try{
  if(!window.Stripe){
   await new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='https://js.stripe.com/v3/';script.async=true;script.onload=resolve;script.onerror=()=>reject(Error('Não foi possível carregar a Stripe'));document.head.append(script);
   });
  }
  if(!document.contains(overlay))return true;
  const stripe=window.Stripe(order.publishableKey);
  stripeEmbeddedInstance=await stripe.initEmbeddedCheckout({clientSecret:order.clientSecret});
  if(document.contains(mount))stripeEmbeddedInstance.mount('#prospector-stripe-checkout');
  return true;
 }catch(error){release();throw error;}
}

async function platformAction(action,el){
 if(action==='client-demo-login'){
  const client=clientList.find(c=>c.id===el.dataset.client);
  if(!client?.demo)throw Error('Conta demonstrativa não encontrada');
  const approved=await confirmInApp({title:'Gerar acesso de teste?',description:'Será criada uma nova senha para a conta demonstrativa. Qualquer senha anterior deixará de funcionar. Essa conta não envia WhatsApp e não faz cobranças.',confirmLabel:'Gerar acesso'});
  if(!approved)return true;
  demoLoginCredentials=await post('/api/platform/demo-login',{});
  render();n('Login de demonstração gerado. Copie a senha antes de sair do Master.');return true;
 }
 if(action==='copy-demo-login'){
  if(!demoLoginCredentials)return true;
  await navigator.clipboard.writeText('E-mail: '+demoLoginCredentials.email+'\nSenha: '+demoLoginCredentials.password+'\nLogin: '+location.origin+'/entrar');
  n('Credenciais demonstrativas copiadas.');return true;
 }
 if(action==='open-demo-login'){window.open('/entrar','_blank','noopener');return true;}
 if(action==='close-demo-login'){demoLoginCredentials=null;render();return true;}
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
 if(action==='billing-return-close'){
  billingCheckoutReturn=null;
  render();return true;
 }
 if(action==='billing-reminder-close'){
  billingReminderOpen=false;billingReminderDismissed=true;billingDemoStep=0;
  if(!platformContext.demo){try{sessionStorage.setItem('prospector-billing-reminder-'+platformContext.id,'dismissed');}catch{}}
  render();return true;
 }
 if(action==='billing-reminder-open'){billingReminderOpen=true;billingReminderDismissed=false;billingDemoStep=0;render();return true;}
 if(action==='billing-demo-toggle'){
  if(!platformContext.demo)return true;
  billingDemoExhausted=!billingDemoExhausted;billingDemoStep=0;
  billingReminderOpen=billingDemoExhausted;billingReminderDismissed=false;render();return true;
 }
 if(action==='billing-demo-select'){
  if(!platformContext.demo)return true;
  const pack=creditState?.packages?.find(x=>x.id===el.dataset.package);
  if(pack){billingDemoPackage=pack.id;billingDemoStep=1;render();}return true;
 }
 if(action==='billing-demo-back'){billingDemoStep=0;render();return true;}
 if(action==='request-credit-resume'){
  if(platformContext.demo||!creditState?.automaticBilling)throw Error('Checkout não disponível nesta conta');
  const id=String(el.dataset.request||'');
  const request=(creditState?.requests||[]).find(x=>x.id===id&&x.status==='PENDING');
  if(!request)throw Error('Pedido pendente não encontrado. Atualize seus créditos.');
  const order=await post('/api/platform/credit-requests/'+encodeURIComponent(id)+'/checkout',{});
  if(!order.checkoutUrl&&!order.clientSecret)throw Error('Checkout temporariamente indisponível.');
  try{sessionStorage.setItem('prospector-last-checkout-request',id);}catch{}
  if(order.clientSecret){try{await openProspectorCheckout(order);return true;}catch(e){if(!order.checkoutUrl)throw e;}}
  location.assign(order.checkoutUrl);return true;
 }
 if(action==='request-credit-package'){
  if(!creditState?.automaticBilling){n('O checkout automático está sendo configurado. Nenhuma cobrança ou recarga foi efetuada.');return true;}
  const pack=creditState?.packages?.find(p=>p.id===el.dataset.package);
  if(!pack)throw Error('Pacote não encontrado. Atualize seus créditos.');
  const answer=await confirmInApp({title:'Comprar '+pack.credits.toLocaleString('pt-BR')+' créditos',description:'Pacote '+pack.name+' no valor de '+moneyFromCents(pack.priceCents)+'. Você será direcionado ao checkout seguro. O saldo só será liberado após confirmação do pagamento pelo provedor.',confirmLabel:'Continuar para o pagamento'});
  if(!answer)return true;
  const order=await post('/api/platform/credit-requests',{packageId:pack.id,requestKey:crypto.randomUUID()});
  if(!order.checkoutUrl&&!order.clientSecret)throw Error('Checkout indisponível. Nenhuma cobrança foi realizada.');
  try{sessionStorage.setItem('prospector-last-checkout-request',order.request.id);}catch{}
  preferredPackage='';try{sessionStorage.removeItem('prospector-preferred-package');}catch{}
  if(order.clientSecret){try{await openProspectorCheckout(order);return true;}catch(e){if(!order.checkoutUrl)throw e;}}
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
 if(action==='trial-review'){
  const c=clientList.find(x=>x.id===el.dataset.client);
  if(!c||c.trial?.status!=='PENDING')throw Error('Teste gratuito não encontrado');
  // Full CPF is sent only over this authenticated Master endpoint and not cached.
  const identity=await api('/api/platform/free-trials/'+c.id+'/identity');
  const answer=await confirmInApp({
   title:'Conferir identidade para liberar 100 abordagens',
   description:'Nome declarado: '+identity.name+' | CPF: '+identity.cpf+' | E-mail: '+identity.email+' | Telefone: '+identity.phone+'. Confira nome e CPF em fonte confiável. A verificação de dígitos não confirma titularidade. Não faça a aprovação apenas com base no que foi informado no cadastro.',
   confirmLabel:'Liberar 100 abordagens grátis',
   fields:'<div class="dialog-fields"><label>Fonte da conferência<select name="verificationMethod" required><option value="OFFICIAL_REGISTRY_MANUAL">Consulta cadastral oficial (manual)</option><option value="TRUSTED_IDENTITY_PROVIDER">Provedor de identidade confiável</option></select></label><label>Referência da verificação (sem CPF completo)<input name="evidenceReference" required minlength="12" maxlength="240" placeholder="Protocolo ou referência segura"></label><label class="dialog-check"><input name="verifiedNameAndCpf" type="checkbox" required> Consultei uma fonte confiável e confirmei que este nome completo corresponde a este CPF.</label></div>'
  });
  if(!answer)return true;
  if(answer.verifiedNameAndCpf!=='on')throw Error('Confirme a correspondência nome/CPF antes de liberar créditos');
  await post('/api/platform/free-trials/'+c.id+'/review',{approved:true,verifiedNameAndCpf:true,evidenceReference:answer.evidenceReference,verificationMethod:answer.verificationMethod});
  await Promise.all([loadClients(),loadMasterMetrics()]);n('Identidade confirmada pelo Master. 100 abordagens grátis liberadas uma única vez.');return true;
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
 if(action==='training-setup-toggle'){
  trainingSetupMinimized=!trainingSetupMinimized;
  try{sessionStorage.setItem('prospector-setup-compact-v2',trainingSetupMinimized?'1':'0');}catch{}
  render();return true;
 }
 if(action==='training-setup-go'){nav(el.dataset.tabTarget||'training');return true;}
 if(action==='training-setup-analyze'){nav('training');setTimeout(()=>q('.fr-analysis')?.scrollIntoView({behavior:'smooth',block:'start'}),80);return true;}
 if(action==='training-review-add'){trainingShowComposer=true;render();q('#training-input')?.focus();return true;}
 if(action==='training-review-close'){trainingShowComposer=false;render();return true;}
 if(action==='training-review-focus'){(q('.fr-analysis-suggestions')||q('.francisca-review'))?.scrollIntoView({behavior:'smooth',block:'start'});return true;}
 if(action==='training-review-approve'){
  const draft=trainingState?.draft;
  if(!draft)return true;
  const confirmation=await confirmInApp({title:'Publicar orientações revisadas?',description:'As novas regras passarão a ser utilizadas pela Francisca. O histórico aprovado será atualizado somente após sua confirmação.',confirmLabel:'Aprovar orientações'});
  if(!confirmation)return true;
  trainingState=await post('/api/training/approve',{id:draft.id,text:draft.text});
  trainingShowComposer=false;render();n('Orientações aprovadas. A Francisca já pode utilizá-las.');return true;
 }
 if(action==='training-analysis-add'||action==='training-analysis-ignore'||action==='training-analysis-restore'){
  const analysis=trainingState?.analysis||{};
  const card=(analysis.cards||[]).find(c=>c.id===el.dataset.id);
  if(!card||!analysis.runId)throw Error('Sugestão indisponível. Atualize a página.');
  const request={runId:analysis.runId,cardId:card.id,action:action==='training-analysis-add'?'add':action==='training-analysis-ignore'?'ignore':'restore'};
  if(request.action==='add'){
   const confirmation=await confirmInApp({
    title:'Adicionar ao treinamento da Francisca?',
    description:'Você pode ajustar o que ela deve fazer e dizer. Esta orientação será salva apenas como rascunho, até sua aprovação explícita.',
    confirmLabel:'Adicionar para revisão',
    fields:'<div class="dialog-fields"><label>Assunto<input name="title" maxlength="110" minlength="3" required value="'+esc(card.title)+'"></label>'+
     '<label>Como a Francisca deve agir<textarea name="body" rows="8" minlength="12" maxlength="16000" required>'+esc(card.editText||(card.points||[]).join('\n'))+'</textarea></label></div>'
   });
   if(!confirmation)return true;
   request.title=confirmation.title;request.body=confirmation.body;
  }
  trainingState=await post('/api/training/suggestions',request);
  render();
  n(request.action==='add'?'Sugestão adicionada ao rascunho. Revise e aprove para ativar.':request.action==='ignore'?'Sugestão ignorada. Você pode restaurá-la quando quiser.':'Sugestão restaurada.');
  return true;
 }
 if(action==='training-review-delete'){
  const card=(trainingState?.review?.cards||[]).find(c=>c.id===el.dataset.id&&c.index===Number(el.dataset.index));
  if(!card)throw Error('Orientação desatualizada. Atualize a página.');
  const confirmed=await confirmInApp({title:'Excluir orientação da Francisca?',description:'"'+card.title+'" será retirada do treinamento da sua empresa somente depois que você aprovar a revisão. O perfil atual continua funcionando até lá.',danger:true,confirmLabel:'Excluir para revisão'});
  if(!confirmed)return true;
  trainingState=await post('/api/training/cards',{action:'delete',index:card.index,cardId:card.id,version:trainingState?.review?.version});
  render();n('Orientação marcada para exclusão. Aprove a revisão para aplicar a mudança.');return true;
 }
 if(action==='training-review-hide-shared'){
  const card=(trainingState?.review?.globalCards||[]).find(c=>c.id===el.dataset.id&&c.index===Number(el.dataset.index));
  if(!card)throw Error('Orientação compartilhada desatualizada. Atualize a página.');
  const confirmed=await confirmInApp({title:'Ocultar orientação compartilhada?',description:'Este card será retirado da sua lista de revisão. A base global e as regras de segurança continuam válidas para todas as empresas. Você poderá restaurar o card depois.',confirmLabel:'Ocultar da minha lista'});
  if(!confirmed)return true;
  trainingState=await post('/api/training/global-cards',{action:'hide',id:card.id});
  render();n('Card ocultado da revisão desta empresa. O método global permanece protegido.');return true;
 }
 if(action==='training-review-restore-shared'){
  trainingState=await post('/api/training/global-cards',{action:'restore'});
  render();n('Orientações compartilhadas restauradas na revisão.');return true;
 }
 if(action==='training-review-new'||action==='training-review-edit'||action==='training-review-copy'){
  const card=action==='training-review-edit'?(trainingState?.review?.cards||[]).find(x=>x.id===el.dataset.id&&x.index===Number(el.dataset.index)):null;
  const copy=action==='training-review-copy'?(trainingState?.review?.globalCards||[]).find(x=>x.id===el.dataset.id&&x.index===Number(el.dataset.index)):null;
  const selected=card||copy;
  if(action==='training-review-edit'&&!card)throw Error('Orientação desatualizada. Atualize a página.');
  const result=await confirmInApp({
   title:card?'Editar orientação da Francisca':copy?'Personalizar método de vendas':'Adicionar orientação manual',
   description:'Explique o que a Francisca deve saber, quando responder e o que não deve prometer. A alteração ficará para aprovação.',
   confirmLabel:'Salvar para revisão',
   fields:'<div class="dialog-fields"><label>Assunto<input name="title" maxlength="110" minlength="3" required value="'+esc(selected?.title||'')+'" placeholder="Ex.: Como responder sobre prazos"></label>'+
   '<label>O que a Francisca deve fazer ou responder<textarea name="body" rows="9" minlength="12" maxlength="16000" required placeholder="Quando o cliente perguntar..., a Francisca deve...">'+esc(selected?.editText||(selected?.points||[]).join('\n'))+'</textarea></label></div>'
  });
  if(!result)return true;
  trainingState=await post('/api/training/cards',{action:card?'edit':'add',index:card?.index,cardId:card?.id,title:result.title,body:result.body,version:trainingState?.review?.version});
  trainingShowComposer=false;render();n('Orientação salva para revisão. Aprove as alterações para ativar.');return true;
 }
 if(action==='training-proof-edit'){
  const item=trainingState?.salesEvidence?.items?.find(x=>x.id===el.dataset.id);
  if(!item)throw Error('Material não encontrado');
  const changed=await confirmInApp({title:'Editar material da Francisca',description:'A referência editada voltará a aguardar aprovação antes de poder ser mostrada aos contatos.',confirmLabel:'Salvar edição',fields:
   '<div class="dialog-fields"><label>Título<input name="title" value="'+esc(item.title)+'" maxlength="120" minlength="3" required></label>'+
   '<label>Tipo<select name="kind">'+[['portfolio','Portfólio'],['case','Projeto'],['testimonial','Depoimento'],['other','Outro']].map(([key,val])=>'<option value="'+key+'" '+(item.kind===key?'selected':'')+'>'+val+'</option>').join('')+'</select></label>'+
   '<label>Descrição<textarea name="description" rows="4" maxlength="350">'+esc(item.description||'')+'</textarea></label>'+
   '<label>Link HTTPS<input name="url" type="url" value="'+esc(item.url||'')+'" maxlength="700"></label></div>'});
  if(!changed)return true;
  await post('/api/training/evidence/update',{id:item.id,...changed});
  await loadTraining();n('Material editado e enviado para aprovação.');return true;
 }
 if(action==='interview-start'){await interviewStart(el.dataset.mode==='voice'?'voice':'text');return true;}
 if(action==='interview-choice'){
  if(!trainingState?.interview||!['approach','closing_mode','payment_methods'].includes(trainingState.interview.step)||interviewSending)return true;
  const choice=String(el.dataset.choice||'');
  if(['permission','direct','consultative','friendly','custom','handoff','complete','pix','card','transfer','invoice'].includes(choice))await interviewSend(choice);
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
 if(action==='offer-ab-activate'){
  if(!offerAbState?.config||offerAbState.config.paused){n('Prospecção pausada; aguarde autorização explícita para retomar.');return true;}
  try{offerAbState=await post('/api/prospecting/offer-ab',{action:'configure',portfolioDueDate:offerAbState.config.portfolioDueDate,startDate:offerAbState.config.startDate,enabled:true});render();n('Teste A/B habilitado para conversas elegíveis.');}catch(e){n(e.message);}
  return true;
 }
 if(action==='training-proof-approve'||action==='training-proof-remove'){
  const id=String(el.dataset.id||'');
  if(action==='training-proof-remove'){const ok=await confirmInApp({title:'Excluir material?',description:'Ele não será mais utilizado como prova social.',danger:true,confirmLabel:'Excluir'});if(!ok)return true;}
  await post('/api/training/evidence/'+(action==='training-proof-approve'?'approve':'remove'),{id});
  await loadTraining();n('Biblioteca atualizada.');return true;
 }
 if(action==='training-payment-verify'){
  const check=await confirmInApp({title:'Verificação de entrada PIX',description:'Confira o valor no extrato bancário. Um comprovante recebido não comprova liquidação bancária.',confirmLabel:'Registrei a conferência',fields:'<label><input type="checkbox" name="paymentVerified" required> Verifiquei o recebimento no banco</label><label>Referência bancária<input name="reference" minlength="4" maxlength="120" required></label>'});
  if(!check)return true;
  await post('/api/training/payment/verify',{leadId:el.dataset.lead,paymentVerified:check.paymentVerified==='on',reference:check.reference});await loadTraining();n('Pagamento verificado no banco.');return true;
 }
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
 if(ev.target.id==='training-offer-ab-form'){
  ev.preventDefault();const fd=new FormData(ev.target),file=fd.get('audio');
  try{
   if(file?.size){
    if(fd.get('audioUpdated')!=='on')throw Error('Confirme que selecionou o arquivo PROPOSTA.ogg original enviado nesta conversa, sem alterar ou recomprimir.');
    if(file.size>15*1024*1024)throw Error('Áudio maior que 15 MB.');
    const mime='audio/ogg';
    const r=await fetch('/api/media?kind=audio&name='+encodeURIComponent('Áudio original proposta Consecom'),{
     method:'POST',credentials:'same-origin',headers:{'Content-Type':mime},body:file});
    const uploaded=await r.json();if(!r.ok)throw Error(uploaded.error||'Falha no upload');
    await post('/api/prospecting/offer-ab',{action:'register-audio',mediaId:uploaded.id,confirmedScript:true});
   }
   offerAbState=await post('/api/prospecting/offer-ab',{action:'configure',portfolioDueDate:fd.get('portfolioDueDate'),startDate:fd.get('startDate'),enabled:false});
   render();n('Roteiro e planejamento salvos sem ativar a prospecção.');
  }catch(e){n(e.message);}return true;
 }

 if(ev.target.id==='training-proof-form'){
  ev.preventDefault();const fd=new FormData(ev.target),file=fd.get('file');
  try{
   if(fd.get('authorized')!=='on')throw Error('Confirme que você pode utilizar o material.');
   if(!file?.size&&!String(fd.get('url')||'').trim())throw Error('Escolha arquivo ou link.');
   let mediaId=null;
   if(file?.size){
    if(file.size>8*1024*1024)throw Error('Arquivo maior que 8 MB.');
    const mime=String(file.type||'');
    if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(mime))throw Error('Envie JPG, PNG, WebP ou PDF.');
    const response=await fetch('/api/media?kind='+(mime==='application/pdf'?'document':'image')+'&name='+encodeURIComponent(String(fd.get('title')||'Portfólio')),{method:'POST',credentials:'same-origin',headers:{'Content-Type':mime},body:file});
    const uploaded=await response.json();if(!response.ok)throw Error(uploaded.error||'Upload indisponível.');
    mediaId=uploaded.id;
   }
   await post('/api/training/evidence/add',{kind:fd.get('kind'),title:fd.get('title'),description:fd.get('description'),url:fd.get('url'),mediaId});
   await loadTraining();n('Material salvo. Aprove o item para usá-lo no atendimento.');
  }catch(err){n(err.message);}return true;
 }
 if(ev.target.id==='training-closing-form'){
  ev.preventDefault();const fd=new FormData(ev.target);
  const input={mode:fd.get('mode'),methods:fd.getAll('methods'),depositPercent:Number(fd.get('depositPercent')),pixName:fd.get('pixName')};
  if(fd.get('pixKey'))input.pixKey=fd.get('pixKey');
  try{await post('/api/training/closing',input);await loadTraining();n('Regras de fechamento salvas.');}catch(err){n(err.message);}
  return true;
 }

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
  else{
   trainingState=await post('/api/training/'+({'training-business':'business','training-chat':'chat','training-approve':'approve'})[id],input);
   if(id==='training-business')trainingStep=1;
   if(id==='training-chat'){
    trainingRecordedText='';
    n(trainingState.chatResult?.saved?'Nova orientação adicionada ao rascunho. Revise e aprove antes de ativar.':'A Francisca respondeu no chat. Nenhuma orientação foi ativada; continue a conversa para completar o treinamento.');
   }else{
    if(id==='training-approve'){trainingWizardReopen=false;trainingStep=0;}
    n(id==='training-approve'?'Perfil aprovado e ativo.':'Informações de treinamento salvas.');
   }
  }
 }catch(e){n(e.message);}finally{trainingBusy=false;busy=false;render();}return true;
}
function pipelineGraphic(k){
 const stages=[['approaching','Em abordagem'],['interested','Interessados'],['conversing','Em atendimento']],values=stages.map(([key])=>Math.max(0,Number(k.counts?.[key])||0)),max=Math.max(1,...values);
 return '<section class="pipeline-graphic" aria-label="Resumo visual do funil"><div><span class="kicker">MOVIMENTO DA OPERAÇÃO</span><h3>Da conversa à oportunidade.</h3></div><div class="pipeline-bars">'+stages.map(([key,label],i)=>'<div><span>'+label+'</span><div class="pipeline-track"><i style="width:'+Math.round(values[i]/max*100)+'%"></i></div><strong>'+values[i]+'</strong></div>').join('')+'</div></section>';
}
function commercialFunnelCard(){
 if(!salesFunnel)return '';
 const f=salesFunnel;
 const percent=x=>x===null||x===undefined?'—':Number(x).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
 const steps=[['Abordagens confirmadas',f.delivered],['Conversas iniciadas',f.replied],['Oportunidades qualificadas',f.qualified],['Propostas de pagamento',f.proposed],['Vendas registradas',f.won]];
 const max=Math.max(1,Number(f.delivered)||0);
 return '<section class="panel" aria-label="Funil de conversão da Francisca" style="margin-top:20px">'+
  '<div class="heading"><div><span class="kicker">FRANCISCA • CONVERSÃO</span><h3>Da abordagem à venda</h3><p>Contatos únicos registrados. Nenhuma intenção de compra é contada como pagamento.</p></div></div>'+
  '<div class="pipeline-list">'+steps.map(([label,value])=>'<div class="pipeline-row"><span>'+esc(label)+'</span><div class="pipeline-track"><i style="width:'+Math.max(value?3:0,Math.round(Number(value||0)/max*100))+'%"></i></div><strong>'+esc(value||0)+'</strong></div>').join('')+'</div>'+
  '<div class="kanban-metrics" style="margin-top:14px">'+
   '<div class="kanban-metric"><span>Responderam</span><strong>'+percent(f.ratios?.replyPct)+'</strong><small>Das abordagens confirmadas</small></div>'+
   '<div class="kanban-metric"><span>Qualificados</span><strong>'+percent(f.ratios?.qualifiedFromRepliedPct)+'</strong><small>Dos que responderam</small></div>'+
   '<div class="kanban-metric"><span>Vendas</span><strong>'+percent(f.ratios?.wonFromDeliveredPct)+'</strong><small>Das abordagens confirmadas</small></div>'+
   '<div class="kanban-metric"><span>Não contatar</span><strong>'+esc(f.optout||0)+'</strong><small>Recusas registradas</small></div></div>'+
  '<details style="margin-top:12px"><summary>Como são medidos esses números?</summary><p>Histórico registrado desde o início da operação. Propostas de pagamento não significam propostas aceitas, e vendas dependem de registro confirmado.</p><p>'+esc((f.caveats||[]).join(' '))+'</p></details>'+
  (f.recommendations?.length?'<div style="margin-top:12px"><strong>Próxima análise sugerida</strong><p>'+esc(f.recommendations[0])+'</p></div>':'')+'</section>';
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
  '<div class="kanban-board-title"><h3>Kanban de oportunidades</h3><small>Acompanhe cada etapa e abra a conversa pelo cartão.</small></div>'+
  '<div class="kanban-columns" aria-label="Kanban comercial">'+definition.map(([key,label,description])=>
   '<section class="kanban-column kanban-'+key+'"><header><div class="kanban-column-head"><strong>'+esc(label)+'</strong><span>'+esc(k.counts?.[key]||0)+'</span></div><small>'+esc(description)+'</small></header><div class="kanban-column-items">'+
   ((k.columns?.[key]||[]).length?k.columns[key].map(x=>item(x,key)).join(''):'<div class="kanban-empty">Nenhuma empresa nesta etapa.</div>')+'</div></section>').join('')+
  '</div>'+
  commercialFunnelCard()+
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
   let sessionListChanged=false;
   if(view==='connections'||Date.now()-waAccountsLastCheck>45000){
    const beforeAccounts=waAccounts.map(x=>x.session_id+':'+Boolean(x.connected)).sort().join('|');
    const pool=await api('/api/whatsapp/sessions').catch(()=>null);
    if(pool?.items){waAccounts=Array.isArray(pool.items)?pool.items:[];waAccountsLastCheck=Date.now();}
    sessionListChanged=beforeAccounts!==waAccounts.map(x=>x.session_id+':'+Boolean(x.connected)).sort().join('|');
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
   if(redraw&&(changed||sessionListChanged||(view==="connections"&&oldQr!==(qrResult?.qr||null))))render();
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
async function loadKanban(){try{kanban=await api('/api/kanban');[salesResults,salesFunnel]=await Promise.all([api('/api/sales/outcomes').catch(()=>null),api('/api/sales/funnel').catch(()=>null)]);if(view==='overview')render();}catch(e){if(view==='overview')render();n('Não foi possível carregar o Kanban: '+e.message);}}
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
  if(!trainingState)await loadTraining();
  if(!creditState)await loadCredits();
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
  if(action==='natural-preview-clear'){naturalPreviewHistory=[];render();return;}
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
 if(ev.target.id==='natural-preview-form'){
  if(naturalPreviewBusy||!trainingState?.internalAccount)return;
  const input=q('#natural-preview-text')?.value.trim()||'';
  if(!input)return;
  const prior=naturalPreviewHistory.slice(-10);
  naturalPreviewHistory.push({role:'user',text:input});
  naturalPreviewBusy=true;render();
  try{
   const reply=await post('/api/ai/natural-preview',{text:input,history:prior});
   if(!reply.ok||!reply.answer)throw Error(reply.code||'A Francisca não respondeu.');
   naturalPreviewHistory.push({role:'assistant',text:String(reply.answer).slice(0,1600)});
  }catch(error){
   naturalPreviewHistory.push({role:'assistant',text:'Não consegui responder neste teste: '+String(error.message||'erro').slice(0,120)});
  }finally{
   naturalPreviewHistory=naturalPreviewHistory.slice(-20);
   naturalPreviewBusy=false;render();
   const feed=q('[aria-label="Simulação da conversa natural"]');
   if(feed)feed.scrollTop=feed.scrollHeight;
  }
  return;
 }
 
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
 if(ev.target.id==='master-recovery'){
  const input=Object.fromEntries(new FormData(ev.target));
  if(input.password!==input.confirmPassword){n('A confirmação da nova senha não corresponde.');return;}
  try{
   await post('/api/platform/master-recovery',{email:input.email,password:input.password});
   ev.target.reset();
   n('Senha da conta Master redefinida. Todas as sessões antigas foram encerradas. Abra Entrar para acessar o Master.');
  }catch(error){n(error.message);}
  return;
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
 if(e.target.id==='training-review-search'){
  trainingReviewSearch=e.target.value;const pos=e.target.selectionStart;
  render();const replacement=q('#training-review-search');
  if(replacement){replacement.focus();replacement.setSelectionRange(pos,pos);}return;
 }
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
 if(platformContext.role!=='master'&&Date.now()-billingLastChecked>(billingCheckoutReturn?6000:30000))await loadCredits();
 if(view!=="training"&&trainingState?.runs?.some(x=>x.status==='RUNNING'))await loadTraining();
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
