// Prospector: five focused views. Deliberately no legacy campaign modules.
const q=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const stamp=d=>d?new Date(d).toLocaleString("pt-BR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
const tabs={overview:"Visão geral",conversations:"Conversas",prospects:"Prospecção",connections:"Conexões",settings:"Configurações"};
const icons={overview:"▦",conversations:"◉",prospects:"⌕",connections:"◫",settings:"⚙"};
let view=["overview","conversations","prospects","connections","settings"].includes(location.hash.split("/")[1])?location.hash.split("/")[1]:"overview";
let state=null,wa=null,ai=null,groqModels=null,groqOwner=null,remoteChats=[],selectedThread=null,messages=[],prospects=null,mapsJob=null,mapsTimer=null,prospectFilter="all",niche="",city="",busy=false,notice="",qrResult=null,chatFilter="",lastRefresh=0,searchSource="osm",prospectError="",prospectLoading=false;
const root=q("#app");
function n(msg){notice=String(msg||"");const el=q("#notice");if(el){el.textContent=notice;el.classList.toggle("hidden",!notice);el.setAttribute("role",notice?"status":"none")}}
async function api(path,opts={}){
 const r=await fetch(path,{credentials:"same-origin",cache:"no-store",...opts,headers:{"Accept":"application/json",...(opts.body?{"Content-Type":"application/json"}:{}),...(opts.headers||{})}});
 let data=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(data.error||data.message||"Servidor indisponível (HTTP "+r.status+")");
 return data;
}
const post=(path,data)=>api(path,{method:"POST",body:JSON.stringify(data||{})});
function nav(viewName){if(!tabs[viewName])viewName="overview";view=viewName;location.hash="/"+view;render();if(view==="connections"){refreshWa();refreshGroq();}if(view==="prospects")loadProspects();if(view==="conversations")loadChats();if(view==="settings")refreshAI();}

function glyph(key){
 const paths={
 overview:'<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
 prospects:'<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5M8 11h6M11 8v6"/>',
 conversations:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.5A9 9 0 1 1 21 11.5Z"/><path d="M8 11.5h9M8 14.5h5"/>',
 connections:'<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 8h.01M12 8h4M8 12h8M8 16h8"/>',
 settings:'<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.2 1.7-2 2-1.7-1.2a8 8 0 0 1-2 .8l-.4 2.1h-2.8l-.4-2.1a8 8 0 0 1-2-.8L7.7 18.8l-2-2L6.9 15a8 8 0 0 1-.8-2l-2.1-.4V9.8l2.1-.4a8 8 0 0 1 .8-2L5.7 5.7l2-2 1.7 1.2a8 8 0 0 1 2-.8l.4-2.1h2.8l.4 2.1a8 8 0 0 1 2 .8l1.7-1.2 2 2-1.2 1.7a8 8 0 0 1 .8 2l2.1.4v2.8l-2.1.4a8 8 0 0 1-.9 2Z"/>',
 refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.8 9a7 7 0 0 1 12-2L20 12M4 12l2.2 5a7 7 0 0 0 12-2"/>',
 arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
 search:'<circle cx="10.7" cy="10.7" r="6.7"/><path d="m15.7 15.7 5 5"/>',
 menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
 close:'<path d="M5 5l14 14M19 5 5 19"/>',
 check:'<path d="m5 12 4 4L19 6"/>'
 };
 return '<svg class="icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[key]||paths.check)+'</svg>';
}
function shell(){
 const active=tabs[view]||tabs.overview,connected=!!wa?.connected;
 root.innerHTML='<div class="shell"><div class="scrim" data-action="close-menu"></div><aside id="side" class="side" aria-label="Menu principal"><div class="brand"><span class="brand-mark">p<span>.</span></span><div><strong>prospector<span class="accent">.</span></strong><small>BY CONSECOM BRASIL</small></div><button class="side-close" data-action="close-menu" aria-label="Fechar menu">'+glyph('close')+'</button></div><div class="side-label">WORKSPACE</div><nav aria-label="Navegação principal">'+Object.entries(tabs).map(([key,label])=>'<button type="button" class="nav '+(view===key?'active':'')+'" data-tab="'+key+'" '+(view===key?'aria-current="page"':'')+'>'+glyph(key)+'<span>'+label+'</span>'+(view===key?'<span class="nav-indicator"></span>':'')+'</button>').join('')+'</nav><div class="side-spacer"></div><div class="side-panel"><span class="side-panel-label">STATUS DA OPERAÇÃO</span><div class="side-status"><span class="pulse '+(connected?'ok':'')+'"></span><div><strong>'+(connected?'WhatsApp conectado':'WhatsApp pendente')+'</strong><small>'+(connected?'Sessão sincronizada':'Confira em Conexões')+'</small></div></div><p>Campanhas permanecem sob aprovação humana.</p></div><div class="side-footer"><span class="brand-min">C.</span><div><strong>Consecom Brasil</strong><small>Publicidade & tecnologia</small></div></div></aside><div class="body"><header class="top"><div class="top-left"><button class="hamburger icon-button" data-action="menu" aria-label="Abrir menu">'+glyph('menu')+'</button><div class="top-title"><span class="eyebrow">WORKSPACE / '+esc(active.toUpperCase())+'</span><h1>'+esc(active)+'</h1></div></div><div class="top-right"><span class="status-chip '+(connected?'online':'')+'"><span class="pulse '+(connected?'ok':'')+'"></span><span>'+(connected?'WhatsApp online':'WhatsApp offline')+'</span></span><button class="icon-button refresh-button" data-action="refresh" title="Atualizar dados" aria-label="Atualizar dados">'+glyph('refresh')+'</button><span class="useravatar">C</span></div></header><div class="main-wrap"><div id="notice" class="notice '+(notice?'':'hidden')+'" role="status">'+esc(notice)+'</div><main class="content" id="view" aria-label="'+esc(active)+'"></main><footer class="main-footer"><span>PROSPECTOR / CONSECOM BRASIL</span><span>Ambiente privado · Dados sob sua gestão</span></footer></div></div></div>';
}


function cards(values){
 return '<div class="stats">'+values.map((x,i)=>'<div class="metric"><div class="metric-top"><span class="metric-label">'+esc(x[0])+'</span><span class="metric-index">0'+(i+1)+'</span></div><div class="metric-value">'+esc(x[1])+'</div><div class="metric-help">'+esc(x[2]||'')+'</div></div>').join('')+'</div>';
}
function overview(){
 const stats=state?.stats||{},allLeads=state?.leads||[],ths=state?.threads||[];
 const uncontacted=allLeads.filter(x=>x.stage==='DISCOVERED').length;
 const paused=state?.settings?.paused!==false;
 return '<section class="welcome"><div class="welcome-copy"><span class="kicker">CENTRAL DE OPERAÇÕES <span class="kicker-line"></span> AO VIVO</span><h2>Suas oportunidades,<br><em>sob controle.</em></h2><p>Encontre empresas, organize seus contatos e acompanhe conversas. Uma visão clara da sua operação comercial.</p><div class="actions"><button class="primary" data-tab="prospects">Explorar empresas '+glyph('arrow')+'</button><button class="secondary" data-tab="conversations">Ver conversas</button></div></div><div class="welcome-art"><div class="hero-grid"></div><div class="hero-graphic"><span class="hero-graphic-caption">OPERAÇÃO</span><span class="hero-graphic-number">'+esc(stats.found??allLeads.length)+'</span><span class="hero-graphic-label">empresas na base</span><div class="hero-graphic-track"><span></span></div><span class="hero-graphic-bottom">PROSPECTOR <b>↗</b></span></div></div></section>'+
 '<div class="section-heading"><div><span class="kicker">VISÃO GERAL</span><h2>Indicadores da operação</h2></div><span class="section-aside">Dados da sua base</span></div>'+
 cards([['Empresas encontradas',stats.found??allLeads.length,'Registros cadastrados'],['Em descoberta',uncontacted,'Ainda não abordadas'],['Conversas',ths.length,'Histórico no painel'],['Operação',paused?'Pausada':'Ativa',paused?'Sem envios automáticos':'Conforme as permissões']])+
 '<div class="overview-grid"><section class="panel activity-panel"><div class="heading"><div><span class="kicker">MOVIMENTAÇÃO</span><h3>Empresas recentes</h3><p>Acompanhe as últimas oportunidades registradas</p></div><button class="link" data-tab="prospects">Ver todas '+glyph('arrow')+'</button></div><div class="activity">'+(allLeads.length?allLeads.slice(0,6).map(x=>'<div class="activity-line"><span class="avatar">'+esc((x.business||'?')[0])+'</span><span><strong>'+esc(x.business)+'</strong><small>'+esc(x.city||'Local não informado')+' · '+esc(x.segment||'Sem segmento')+'</small></span><span class="tag">'+esc(x.stage==='DISCOVERED'?'Na base':'Em andamento')+'</span></div>').join(''):'<div class="empty"><span class="empty-mark">'+glyph('prospects')+'</span><strong>Pronto para encontrar oportunidades?</strong><p>Vá até Prospecção e faça sua primeira pesquisa.</p><button class="secondary compact" data-tab="prospects">Abrir Prospecção</button></div>')+'</div></section>'+
 '<section class="panel health-panel"><div class="heading"><div><span class="kicker">PAINEL DE CONTROLE</span><h3>Saúde da operação</h3><p>Serviços essenciais</p></div></div><div class="health-row"><span><i class="health-dot ok"></i> Plataforma</span><strong>Operacional</strong></div><div class="health-row"><span><i class="health-dot '+(wa?.connected?'ok':'warn')+'"></i> WhatsApp</span><strong>'+(wa?.connected?'Conectado':'Verificar conexão')+'</strong></div><div class="health-row"><span><i class="health-dot '+(paused?'warn':'ok')+'"></i> Campanhas</span><strong>'+(paused?'Pausadas':'Habilitadas')+'</strong></div><div class="health-note">A busca de empresas e as campanhas são independentes. Nenhum contato recebe mensagens apenas por ter sido encontrado.</div><button class="secondary block" data-tab="connections">Ver integrações '+glyph('arrow')+'</button></section></div>';
}

function conversations(){
 const local=state?.threads||[];const ids=new Set(remoteChats.map(t=>t.phone));const threads=[...remoteChats,...local.filter(t=>!ids.has(t.phone))].filter(t=>!chatFilter||[t.name,t.business,t.phone].some(v=>String(v||"").toLowerCase().includes(chatFilter.toLowerCase())));
 if((!selectedThread||!threads.some(t=>t.id===selectedThread))&&threads.length)selectedThread=threads[0].id;
 const chosen=threads.find(t=>t.id===selectedThread)||null;
 const bubble=messages.map(m=>'<div class="bubble-wrap '+(m.direction==="out"?"out":"in")+'"><div class="bubble">'+esc(m.body||"[Mídia]")+'<small>'+stamp(m.at)+' · '+esc(m.direction==="out"?"Enviada":"Recebida")+'</small></div></div>').join("");
 return '<section class="chats"><div class="chat-list"><div class="chats-title"><div><h3>Mensagens</h3><p>'+threads.length+' conversas</p></div><span class="small-pill">WhatsApp</span></div><input id="chat-search" class="field" placeholder="Buscar conversa..." value="'+esc(chatFilter)+'">'+(threads.length?threads.map(t=>'<button data-thread="'+esc(t.id)+'" class="chat-person '+(selectedThread===t.id?"selected":"")+'"><span class="avatar">'+esc((t.name||t.business||"?")[0])+'</span><span class="info"><strong>'+esc(t.name||t.business||t.phone)+'</strong><small>'+esc(t.phone||"")+'</small></span><time>'+stamp(t.last_message_at)+'</time></button>').join(""):'<div class="empty">Suas conversas aparecerão aqui quando chegarem mensagens.</div>')+'</div><div class="chat-panel">'+(chosen?'<div class="chat-heading"><span class="avatar">'+esc((chosen.name||chosen.business)[0])+'</span><div><strong>'+esc(chosen.name||chosen.business)+'</strong><small>'+esc(chosen.phone||"")+'</small></div><span class="message-status">'+(wa?.connected?"Conectado":"WhatsApp offline")+'</span></div><div class="message-feed" id="messages">'+(bubble||'<p class="empty">Carregando mensagens...</p>')+'</div><form class="composer" id="send-form"><input id="chat-text" autocomplete="off" maxlength="1500" placeholder="Escreva uma mensagem..." aria-label="Mensagem"><button class="primary" type="submit">Enviar ↗</button></form><p class="under-chat">Envio manual. Mensagens não são repetidas automaticamente se houver erro.</p>':'<div class="chat-blank"><div class="big-icon">◉</div><h3>Suas conversas, organizadas.</h3><p>Conecte o WhatsApp e receba mensagens para começar.</p><button class="primary" data-tab="connections">Conectar WhatsApp</button></div>')+'</div></section>';
}
function prospecting(){
 const d=prospects||{results:[],total:0,uncontacted:0,contacted:0},arr=d.results||[];
 return '<section class="panel searchpanel"><div class="heading"><div><span class="kicker">DESCOBERTA DE EMPRESAS</span><h2>Encontre seus próximos clientes.</h2><p>Escolha qualquer nicho e cidade brasileira. Veja quem ainda não foi contatado pelo Prospector.</p></div></div><form id="search-form" class="search-form"><label>Nicho ou tipo de empresa<input id="niche" class="field" value="'+esc(niche)+'" placeholder="Ex.: oficinas mecânicas" maxlength="85" required></label><label>Cidade / localização<input id="city" class="field" value="'+esc(city)+'" placeholder="Ex.: Sorocaba" maxlength="85" required></label><button class="primary" type="submit" '+(busy?"disabled":"")+'>'+(busy?"Pesquisando...":"Pesquisar empresas ↗")+'</button></form><div class="source-info">Fonte: Gosom Google Maps (em processamento por tarefa). A cobertura pode ser parcial, e o uso dos dados deve respeitar os termos aplicáveis. Nenhum disparo automático.</div></section>'+ (mapsJob?'<section class="panel" id="maps-job"><div class="heading"><div><h3>Pesquisa no Google Maps</h3><p>'+esc(mapsJob.error?'Última consulta: '+mapsJob.error:mapsJob.status==='COMPLETED'?'Pesquisa concluída. Confira e importe as empresas.':mapsJob.status==='IMPORTED'?'Empresas importadas na base.':'O scraper está processando sua busca.')+'</p></div><span class="tag">'+esc(mapsJob.status)+'</span></div><div class="actions">'+(mapsJob.status==='COMPLETED'?'<button class="primary" data-action="maps-import">Importar empresas encontradas</button>':mapsJob.status==='IMPORTED'?'<span class="tag green">'+esc(mapsJob.added||0)+' novos leads</span>':'<button class="secondary" data-action="maps-poll">Atualizar situação</button>')+'</div></section>':'')+
 '<section class="panel results"><div class="heading"><div><h3>Resultados da prospecção</h3><p>'+esc(d.total)+' empresas identificadas para esses filtros</p></div><span class="hint">Dados sem envio automático</span></div><div class="filter-tabs"><button data-filter="uncontacted" class="'+(prospectFilter==="uncontacted"?"chosen":"")+'">Não contatadas <b>'+esc(d.uncontacted)+'</b></button><button data-filter="contacted" class="'+(prospectFilter==="contacted"?"chosen":"")+'">Já contatadas <b>'+esc(d.contacted)+'</b></button><button data-filter="all" class="'+(prospectFilter==="all"?"chosen":"")+'">Todas <b>'+esc(d.total)+'</b></button></div><div class="table-wrap"><table class="result-table"><thead><tr><th>Empresa</th><th>Nicho / cidade</th><th>Telefone</th><th>Situação</th></tr></thead><tbody>'+(arr.length?arr.map(p=>'<tr><td><strong>'+esc(p.business)+'</strong><small>'+esc(p.website||"Site não informado")+'</small></td><td>'+esc(p.segment||"—")+'<small>'+esc(p.city||"—")+'</small></td><td>'+esc(p.phone||"Não encontrado")+'</td><td><span class="tag '+(p.contacted?"muted":"green")+'">'+(p.contacted?"Já contatada":"Não contatada")+'</span></td></tr>').join(""):'<tr><td colspan="4"><div class="empty">Nenhuma empresa nessa categoria. Faça uma pesquisa acima ou ajuste seus filtros.</div></td></tr>')+'</tbody></table></div><p class="footnote">Não contatada = sem registro de envio neste sistema. A ferramenta não sabe se alguém já contatou a empresa fora do Prospector. Resultados podem ser parciais.</p></section><details class="panel csv-import"><summary>Importar empresas de um extrator open source (CSV)</summary><p>Também é possível usar o <a href="https://github.com/severoads3/apex-gmaps-extractor" rel="noopener noreferrer" target="_blank">Apex Leads Extractor no GitHub ↗</a> e importar os resultados aqui, sem chave paga. A importação não autoriza envio de mensagens.</p><div class="csv-inline"><input id="maps-csv" type="file" accept=".csv,text/csv" aria-label="Arquivo CSV de empresas"><button class="secondary" type="button" data-action="import-csv">Importar CSV</button></div></details>';
}
function connections(){
 const connected=!!wa?.connected,status=wa?.status||"DISCONNECTED",qr=qrResult?.qr;
 return '<section class="connect-layout"><div class="panel connect-info"><span class="kicker">INTEGRAÇÃO WHATSAPP</span><h2>Conecte seu WhatsApp em segundos.</h2><p>Você não precisa acessar outro sistema. O Prospector gera o QR Code aqui e cuida da integração com o gateway.</p><div class="connection-status '+(connected?"connected":"")+'"><span class="pulse '+(connected?"ok":"")+'"></span><span><strong>'+(connected?"WhatsApp conectado":"WhatsApp não conectado")+'</strong><small>'+esc(status==="ERROR"?(wa?.message||"Falha de comunicação"):connected?"Pronto para receber conversas":"Clique em Conectar para iniciar a sessão")+'</small></span></div><div class="actions">'+(connected?'<button class="secondary" data-action="disconnect">Desconectar</button>':'<button class="primary" data-action="connect" '+(busy?"disabled":"")+'>'+(busy?"Conectando...":"Conectar WhatsApp")+'</button>')+'</div><div class="steps"><strong>Como conectar</strong><p>1. Abra o WhatsApp no celular.</p><p>2. Vá em <b>Aparelhos conectados</b> e toque em <b>Conectar aparelho</b>.</p><p>3. Escaneie o QR Code mostrado ao lado.</p></div></div><div class="panel qr-panel"><div class="qr-frame">'+(connected?'<div class="qr-placeholder"><span>✓</span><h3>WhatsApp conectado!</h3><p>Suas conversas aparecerão na aba Conversas.</p></div>':qr?'<img class="qr-image" src="'+esc(qr)+'" alt="QR Code de conexão do WhatsApp"><p>Escaneie com a câmera do WhatsApp</p>':'<div class="qr-placeholder"><span>▦</span><h3>'+esc(wa?.hasSession?"Aguardando QR Code":"Pronto para conectar")+'</h3><p>'+esc(qrResult?.message||"Clique em Conectar WhatsApp para gerar seu código.")+'</p></div>')+'</div><p class="footnote">QR temporário e protegido. O WhatsApp não começa a enviar mensagens sozinho.</p></div></section>'+'<section class="panel" style="margin-top:20px"><div class="heading"><div><h3>Groq Cloud · modelos inteligentes</h3><p>O Prospector escolhe automaticamente entre os modelos disponíveis.</p></div><span class="tag '+(groqOwner?.active?'green':'')+'">'+(groqOwner?.active?'Assistente configurado':'IA em configuração')+'</span></div><p class="footnote">Assistente autorizado somente para o número final '+esc(groqOwner?.ownerSuffix||'—')+'. Operações sensíveis exigem confirmação.</p>'+(groqModels?.selection?'<div class="model-grid">'+Object.entries(groqModels.selection).map(([task,model])=>'<div class="model-cell"><small>'+esc({conversation:'Conversa',actions:'Operações do sistema',quick:'Respostas rápidas',summarization:'Resumos',complex:'Análises complexas',transcription:'Transcrição (preparado)'}[task]||task)+'</small><strong>'+esc(model||'Indisponível')+'</strong></div>').join('')+'</div>':'<p class="footnote">Consultando os modelos da sua conta…</p>')+'</section>';
}
function settings(){
 const s=state?.settings||{};
 return '<section class="panel settings"><span class="kicker">PREFERÊNCIAS</span><h2>Configurações</h2><p class="intro">Opções essenciais da operação, sem ferramentas extras.</p><div class="setting-line"><div><strong>Prospecção pausada</strong><small>Não iniciar campanhas ou envios automaticamente.</small></div><label class="switch"><input id="s-paused" type="checkbox" '+(s.paused?"checked":"")+'><span></span></label></div><div class="setting-line"><div><strong>Descoberta automática</strong><small>Pesquisa pública programada no OpenStreetMap.</small></div><label class="switch"><input id="s-discovery" type="checkbox" '+(s.discovery_auto_enabled?"checked":"")+'><span></span></label></div><div class="setting-line"><div><strong>IA de conversação</strong><small>Groq gera rascunhos; não envia mensagens sem intervenção humana.</small></div><span class="tag '+(ai?.configured?"green":"")+'">'+(ai?.configured?"Configurada":"Não configurada")+'</span></div><div class="setting-line"><div><strong>Integração WhatsApp</strong><small>Conexão via WA-AKG administrada pelo Prospector.</small></div><button class="secondary compact" data-tab="connections">Gerenciar conexão</button></div><p class="footnote">O envio automático permanece desativado por segurança até a integração de mensagens ser validada.</p></section>';
}
function render(){
 shell();
 const el=q("#view");
 el.innerHTML={overview,conversations,prospects,connections,settings}[view]();
 if(view==="conversations"&&selectedThread)loadMessages(selectedThread);
 if(view==="connections")refreshWa(false);
}
async function refreshWa(redraw=true){
 try{
  const w=await api("/api/whatsapp/status");const wasConnected=!!wa?.connected;const changed=wa?.connected!==w.connected||wa?.status!==w.status;wa=w;
  if(view==="conversations"&&w.connected&&(!wasConnected||!remoteChats.length)){await loadChats();return;}
  if(view==="connections"&&w.hasSession&&!w.connected){qrResult=await api("/api/whatsapp/qr");}
  if(redraw&&(view==="connections"||changed))render();
 }catch(e){wa={ok:false,status:"ERROR",message:e.message,connected:false};if(redraw&&view==="connections")render();}
}
async function refreshGroq(){
 try{
  const [models,owner]=await Promise.all([api('/api/groq/models'),api('/api/groq/owner')]);
  groqModels=models;groqOwner=owner;
  if(view==='connections')render();
 }catch(e){n('Não foi possível consultar os modelos Groq: '+e.message);}
}
async function refreshAI(){try{ai=await api("/api/ai/status");if(view==="settings")render();}catch{}}
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
 if(!mapsJob?.id||["IMPORTED","FAILED"].includes(mapsJob.status))return;
 try{const updated=await api("/api/maps/job?id="+encodeURIComponent(mapsJob.id));mapsJob=updated;if(updated.status==="FAILED")n("O scraper não concluiu esta pesquisa.");if(view==="prospects")render();}catch(e){n("Scraper: "+e.message);}
}
function startMapsPolling(){
 if(mapsTimer)clearInterval(mapsTimer);
 mapsTimer=setInterval(async()=>{if(!mapsJob||["IMPORTED","FAILED","COMPLETED"].includes(mapsJob.status)){clearInterval(mapsTimer);mapsTimer=null;return;}await updateMapsJob();},12000);
}
async function loadProspects(){
 try{
  const params=new URLSearchParams({niche,city,status:prospectFilter});
  const [base,remote]=await Promise.all([api("/api/prospecting?"+params.toString()),api("/api/maps/status").catch(()=>null)]);
  prospects=base;
  if(remote?.jobs?.length&&!mapsJob){
   const previous=remote.jobs.find(j=>j.niche===niche&&j.city===city);
   if(previous){mapsJob=previous;if(["PENDING","RUNNING"].includes(previous.status))startMapsPolling();}
  }
  if(view==="prospects")render();
 }catch(e){n(e.message);}
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
async function reload(){
 try{
  state=await api("/api/state");lastRefresh=Date.now();
  if(view==="prospects")await loadProspects();else if(view==="conversations")await loadChats();else render();
 }catch(e){if(!state)root.innerHTML='<main class="load-error"><h2>Não foi possível abrir o Prospector</h2><p>'+esc(e.message)+'</p><button onclick="location.reload()">Tentar novamente</button></main>';else n(e.message);}
}
document.addEventListener("click",async ev=>{
 const el=ev.target.closest("[data-tab],[data-action],[data-thread],[data-filter]");if(!el)return;
 if(el.dataset.tab){nav(el.dataset.tab);return;}
 if(el.dataset.thread){selectedThread=el.dataset.thread;messages=[];render();return;}
 if(el.dataset.filter){prospectFilter=el.dataset.filter;await loadProspects();return;}
 const action=el.dataset.action;
 try{
  if(action==="menu"){q("#side")?.classList.toggle("mobile-open");return;}
  if(action==="maps-import"){if(!mapsJob?.id)return;const out=await post("/api/maps/import",{id:mapsJob.id});mapsJob={...mapsJob,status:"IMPORTED",added:out.added};n(out.added+" empresas novas importadas e deduplicadas.");await loadProspects();return;}
  if(action==="maps-poll"){await updateMapsJob();return;}
  if(action==="import-csv"){await importMapsCSV();return;}
  if(action==="connect"){busy=true;render();await post("/api/whatsapp/connect",{});busy=false;await refreshWa();n("Sessão iniciada. Escaneie o QR Code para conectar.");return;}
  if(action==="disconnect"){if(!confirm("Desconectar a sessão de WhatsApp?"))return;busy=true;await post("/api/whatsapp/disconnect",{});busy=false;qrResult=null;await refreshWa();n("Sessão interrompida.");return;}
 }catch(e){busy=false;n(e.message);render();}
});
document.addEventListener("submit",async ev=>{
 if(ev.target.id==="search-form"){
  ev.preventDefault();const a=q("#niche")?.value.trim(),b=q("#city")?.value.trim();if(!a||!b)return;
  niche=a;city=b;busy=true;render();n("Pesquisando empresas nas fontes públicas. A consulta pode levar algum tempo...");
  try{mapsJob=await post("/api/maps/search",{niche,city});prospectFilter="uncontacted";n("Pesquisa enviada ao Gosom. Acompanhe o andamento sem sair do Prospector.");startMapsPolling();}
  catch(e){n(e.message);await loadProspects();}
  busy=false;if(view==="prospects")await loadProspects();return;
 }
 if(ev.target.id==="send-form"){
  ev.preventDefault();const text=q("#chat-text")?.value.trim();if(!text||!selectedThread)return;
  const btn=q('#send-form button');if(btn)btn.disabled=true;
  try{const endpoint=selectedThread.startsWith("wa:")?"/api/whatsapp/reply-remote":"/api/whatsapp/reply";const data=selectedThread.startsWith("wa:")?{jid:selectedThread.slice(3),text,requestId:crypto.randomUUID()}:{threadId:selectedThread,text,requestId:crypto.randomUUID()};await post(endpoint,data);q("#chat-text").value="";await loadMessages(selectedThread);n("Mensagem enviada.");}
  catch(e){n(e.message);}finally{if(btn)btn.disabled=false;}
 }
});
document.addEventListener("change",async e=>{
 const t=e.target;
 if(t.id==="s-paused"||t.id==="s-discovery"){
  const key=t.id==="s-paused"?"paused":"discovery_auto_enabled";
  try{await post("/api/settings",{[key]:t.checked});n("Configuração salva.");await reload();}
  catch(err){t.checked=!t.checked;n(err.message);}
 }
});
document.addEventListener("input",e=>{if(e.target.id==="chat-search"){chatFilter=e.target.value;const cursor=e.target.selectionStart;render();const input=q("#chat-search");if(input){input.focus();input.setSelectionRange(cursor,cursor);}}});
window.addEventListener("hashchange",()=>{const tab=location.hash.split("/")[1];if(tabs[tab]&&tab!==view)nav(tab);});
setInterval(async()=>{if(view==="connections"){await refreshWa();}else if(view==="conversations"&&Date.now()-lastRefresh>16000){await refreshWa(false);await reload();}else if(Date.now()-lastRefresh>20000&&state){await reload();}},5000);
await reload();
await refreshWa();
