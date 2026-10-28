// Prospector: five focused views. Deliberately no legacy campaign modules.
const q=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const stamp=d=>d?new Date(d).toLocaleString("pt-BR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
const tabs={overview:"Visão geral",conversations:"Conversas",prospects:"Prospecção",connections:"Conexões",settings:"Configurações"};
const icons={overview:"▦",conversations:"◉",prospects:"⌕",connections:"◫",settings:"⚙"};
let view=["overview","conversations","prospects","connections","settings"].includes(location.hash.split("/")[1])?location.hash.split("/")[1]:"overview";
let state=null,wa=null,ai=null,remoteChats=[],selectedThread=null,messages=[],prospects=null,prospectFilter="uncontacted",niche="oficinas mecânicas",city="Sorocaba",busy=false,notice="",qrResult=null,chatFilter="",lastRefresh=0;
const root=q("#app");
function n(msg){notice=msg;const el=q("#notice");if(el){el.textContent=msg;el.classList.toggle("hidden",!msg)}}
async function api(path,opts={}){
 const r=await fetch(path,{credentials:"same-origin",cache:"no-store",...opts,headers:{"Accept":"application/json",...(opts.body?{"Content-Type":"application/json"}:{}),...(opts.headers||{})}});
 let data=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(data.error||data.message||"Servidor indisponível (HTTP "+r.status+")");
 return data;
}
const post=(path,data)=>api(path,{method:"POST",body:JSON.stringify(data||{})});
function nav(viewName){if(!tabs[viewName])viewName="overview";view=viewName;location.hash="/"+view;render();if(view==="connections")refreshWa();if(view==="prospects")loadProspects();if(view==="conversations")loadChats();if(view==="settings")refreshAI();}
function shell(){
 root.innerHTML='<div class="shell"><aside id="side" class="side"><div class="logo"><span class="logo-mark">P<span>.</span></span><div><strong>prospector<span class="accent">.</span></strong><small>CONSECOM BRASIL</small></div></div><div class="smalltitle">MENU PRINCIPAL</div><nav>'+Object.entries(tabs).map(([key,label])=>'<button type="button" class="nav '+(view===key?'active':'')+'" data-tab="'+key+'"><span class="navico">'+icons[key]+'</span>'+label+'</button>').join('')+'</nav><div class="sidefoot"><span class="pulse '+(wa?.connected?"ok":"")+'"></span><span>'+(wa?.connected?"WhatsApp conectado":"WhatsApp desconectado")+'</span></div></aside><div class="body"><header class="top"><button class="hamburger" data-action="menu" aria-label="Abrir menu">☰</button><div class="top-title"><span class="eyebrow">CONSECOM / PROSPECTOR</span><h1>'+tabs[view]+'</h1></div><div class="top-right"><span class="status-chip '+(wa?.connected?"online":"")+'">● '+(wa?.connected?"Conectado":"Aguardando conexão")+'</span><span class="useravatar">C</span></div></header><div id="notice" class="notice '+(notice?"":"hidden")+'">'+esc(notice)+'</div><main class="content" id="view"></main></div></div>';
}
function cards(values){return '<div class="stats">'+values.map(x=>'<div class="metric"><div class="metric-label">'+esc(x[0])+'</div><div class="metric-value">'+esc(x[1])+'</div><div class="metric-help">'+esc(x[2]||"")+'</div></div>').join('')+'</div>';}
function overview(){
 const stats=state?.stats||{},allLeads=state?.leads||[],ths=state?.threads||[];
 const uncontacted=allLeads.filter(x=>x.stage==="DISCOVERED").length;
 return '<section class="welcome"><div><span class="kicker">SEU PAINEL DE CONTROLE</span><h2>Seu negócio, em um só lugar.</h2><p>Acompanhe suas oportunidades, conversas e conexão com o WhatsApp, sem excesso de ferramentas.</p><div class="actions"><button class="primary" data-tab="prospects">Buscar empresas ↗</button><button class="secondary" data-tab="connections">Conectar WhatsApp</button></div></div><div class="welcome-art"><div class="orbit one"></div><div class="orbit two"></div><div class="glow">P</div></div></section>'+
 cards([["Empresas encontradas",stats.found??allLeads.length,"Registradas no Prospector"],["Ainda não abordadas",uncontacted,"Na amostra carregada"],["Conversas",ths.length,"Histórico do painel"],["WhatsApp",wa?.connected?"Ativo":"Pendente",wa?.connected?"Sessão pronta":"Aguardando QR Code"]])+
 '<section class="panel"><div class="heading"><div><h3>Atividade recente</h3><p>Últimas empresas na sua base</p></div><button class="link" data-tab="prospects">Ver prospecção ↗</button></div><div class="activity">'+(allLeads.length?allLeads.slice(0,7).map(x=>'<div class="activity-line"><span class="avatar">'+esc((x.business||"?")[0])+'</span><span><strong>'+esc(x.business)+'</strong><small>'+esc(x.city||"Localidade não informada")+' · '+esc(x.segment||"Sem nicho")+'</small></span><span class="tag">'+esc(x.stage==="DISCOVERED"?"Não abordada":"Acompanhar")+'</span></div>').join(""):'<div class="empty">Nenhuma empresa na base ainda. Vá até Prospecção e faça sua primeira pesquisa.</div>')+'</div></section>';
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
 return '<section class="panel searchpanel"><div class="heading"><div><span class="kicker">DESCOBERTA DE EMPRESAS</span><h2>Encontre seus próximos clientes.</h2><p>Escolha qualquer nicho e cidade brasileira. Veja quem ainda não foi contatado pelo Prospector.</p></div></div><form id="search-form" class="search-form"><label>Nicho ou tipo de empresa<input id="niche" class="field" value="'+esc(niche)+'" placeholder="Ex.: oficinas mecânicas" maxlength="85" required></label><label>Cidade / localização<input id="city" class="field" value="'+esc(city)+'" placeholder="Ex.: Sorocaba" maxlength="85" required></label><button class="primary" type="submit" '+(busy?"disabled":"")+'>'+(busy?"Pesquisando...":"Pesquisar empresas ↗")+'</button></form><div class="source-info">Fonte gratuita: OpenStreetMap/Overpass. A busca é limitada à cobertura da fonte, ao raio pesquisado e aos limites de uso. Não representa todas as empresas da cidade.</div></section>'+
 '<section class="panel results"><div class="heading"><div><h3>Resultados da prospecção</h3><p>'+esc(d.total)+' empresas identificadas para esses filtros</p></div><span class="hint">Dados sem envio automático</span></div><div class="filter-tabs"><button data-filter="uncontacted" class="'+(prospectFilter==="uncontacted"?"chosen":"")+'">Não contatadas <b>'+esc(d.uncontacted)+'</b></button><button data-filter="contacted" class="'+(prospectFilter==="contacted"?"chosen":"")+'">Já contatadas <b>'+esc(d.contacted)+'</b></button><button data-filter="all" class="'+(prospectFilter==="all"?"chosen":"")+'">Todas <b>'+esc(d.total)+'</b></button></div><div class="table-wrap"><table class="result-table"><thead><tr><th>Empresa</th><th>Nicho / cidade</th><th>Telefone</th><th>Situação</th></tr></thead><tbody>'+(arr.length?arr.map(p=>'<tr><td><strong>'+esc(p.business)+'</strong><small>'+esc(p.website||"Site não informado")+'</small></td><td>'+esc(p.segment||"—")+'<small>'+esc(p.city||"—")+'</small></td><td>'+esc(p.phone||"Não encontrado")+'</td><td><span class="tag '+(p.contacted?"muted":"green")+'">'+(p.contacted?"Já contatada":"Não contatada")+'</span></td></tr>').join(""):'<tr><td colspan="4"><div class="empty">Nenhuma empresa nessa categoria. Faça uma pesquisa acima ou ajuste seus filtros.</div></td></tr>')+'</tbody></table></div><p class="footnote">Não contatada = sem registro de envio neste sistema. A ferramenta não sabe se alguém já contatou a empresa fora do Prospector. Resultados podem ser parciais.</p></section>';
}
function connections(){
 const connected=!!wa?.connected,status=wa?.status||"DISCONNECTED",qr=qrResult?.qr;
 return '<section class="connect-layout"><div class="panel connect-info"><span class="kicker">INTEGRAÇÃO WHATSAPP</span><h2>Conecte seu WhatsApp em segundos.</h2><p>Você não precisa acessar outro sistema. O Prospector gera o QR Code aqui e cuida da integração com o gateway.</p><div class="connection-status '+(connected?"connected":"")+'"><span class="pulse '+(connected?"ok":"")+'"></span><span><strong>'+(connected?"WhatsApp conectado":"WhatsApp não conectado")+'</strong><small>'+esc(status==="ERROR"?(wa?.message||"Falha de comunicação"):connected?"Pronto para receber conversas":"Clique em Conectar para iniciar a sessão")+'</small></span></div><div class="actions">'+(connected?'<button class="secondary" data-action="disconnect">Desconectar</button>':'<button class="primary" data-action="connect" '+(busy?"disabled":"")+'>'+(busy?"Conectando...":"Conectar WhatsApp")+'</button>')+'</div><div class="steps"><strong>Como conectar</strong><p>1. Abra o WhatsApp no celular.</p><p>2. Vá em <b>Aparelhos conectados</b> e toque em <b>Conectar aparelho</b>.</p><p>3. Escaneie o QR Code mostrado ao lado.</p></div></div><div class="panel qr-panel"><div class="qr-frame">'+(connected?'<div class="qr-placeholder"><span>✓</span><h3>WhatsApp conectado!</h3><p>Suas conversas aparecerão na aba Conversas.</p></div>':qr?'<img class="qr-image" src="'+esc(qr)+'" alt="QR Code de conexão do WhatsApp"><p>Escaneie com a câmera do WhatsApp</p>':'<div class="qr-placeholder"><span>▦</span><h3>'+esc(wa?.hasSession?"Aguardando QR Code":"Pronto para conectar")+'</h3><p>'+esc(qrResult?.message||"Clique em Conectar WhatsApp para gerar seu código.")+'</p></div>')+'</div><p class="footnote">QR temporário e protegido. O WhatsApp não começa a enviar mensagens sozinho.</p></div></section>';
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
  const w=await api("/api/whatsapp/status");const changed=wa?.connected!==w.connected||wa?.status!==w.status;wa=w;
  if(view==="connections"&&w.hasSession&&!w.connected){qrResult=await api("/api/whatsapp/qr");}
  if(redraw&&(view==="connections"||changed))render();
 }catch(e){wa={ok:false,status:"ERROR",message:e.message,connected:false};if(redraw&&view==="connections")render();}
}
async function refreshAI(){try{ai=await api("/api/ai/status");if(view==="settings")render();}catch{}}
async function loadChats(){
 if(!wa?.connected){remoteChats=[];if(view==="conversations")render();return;}
 try{const r=await api("/api/whatsapp/chats");remoteChats=Array.isArray(r.items)?r.items:[];if(view==="conversations")render();}
 catch(e){n("Não foi possível sincronizar o histórico do WhatsApp: "+e.message);}
}
async function loadProspects(){
 try{
  const params=new URLSearchParams({niche,city,status:prospectFilter});
  prospects=await api("/api/prospecting?"+params.toString());
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
  if(action==="connect"){busy=true;render();await post("/api/whatsapp/connect",{});busy=false;await refreshWa();n("Sessão iniciada. Escaneie o QR Code para conectar.");return;}
  if(action==="disconnect"){if(!confirm("Desconectar a sessão de WhatsApp?"))return;busy=true;await post("/api/whatsapp/disconnect",{});busy=false;qrResult=null;await refreshWa();n("Sessão interrompida.");return;}
 }catch(e){busy=false;n(e.message);render();}
});
document.addEventListener("submit",async ev=>{
 if(ev.target.id==="search-form"){
  ev.preventDefault();const a=q("#niche")?.value.trim(),b=q("#city")?.value.trim();if(!a||!b)return;
  niche=a;city=b;busy=true;render();n("Pesquisando empresas nas fontes públicas. A consulta pode levar algum tempo...");
  try{prospects=await post("/api/prospecting/search",{niche,city});prospectFilter="uncontacted";n((prospects.added||0)+" empresas novas adicionadas. "+(prospects.note||""));}
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
setInterval(async()=>{if(view==="connections"){await refreshWa();}else if(Date.now()-lastRefresh>20000&&state){await reload();}},5000);
await reload();
await refreshWa();
