const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate=s=>s?new Date(s).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const labelStage={DISCOVERED:'Descoberto',CONTACTED:'Abordado',REPLIED:'Respondeu',NO_INTEREST:'Sem interesse',INTERESTED:'Interessado'};
const stages=[['CONTACTED','Abordados','blue'],['REPLIED','Responderam / fluxo','yellow'],['NO_INTEREST','Sem interesse','red'],['INTERESTED','Interessados / sua resposta','green']];
let state=null,page=location.hash.split('/')[1]||'overview',selectedThread=location.hash.split('/')[2]||null,mediaTab='video',workflowId='default',editing=null,dirty=false,loading=false,chatSearch='',kanbanSearch='';
let toastTimer=null;
const icons={video:'▣',audio:'♫',image:'▧',message:'✉',wait_reply:'◌',delay:'◷',end:'✓'};
function showToast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4200);}
async function request(path,data,method='POST'){
 const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data||{})});
 const text=await r.text();let parsed;try{parsed=JSON.parse(text);}catch{throw Error('Resposta inválida do servidor');}
 if(!r.ok)throw Error(parsed.error||'Falha de comunicação');
 return parsed;
}
async function load(shouldDraw=true){
 if(loading)return;loading=true;
 try{const r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)throw Error('API indisponível');state=await r.json();if(shouldDraw)draw();}
 catch(e){$('#sync-status').textContent='Offline';if(!state)$('#screen').innerHTML='<div class="empty"><strong>Não foi possível conectar ao backend</strong><p>'+esc(e.message)+'</p></div>';}
 finally{loading=false;}
}
function navigate(to,thread=null){
 page=to;selectedThread=thread||null;location.hash='/'+to+(thread?'/'+thread:'');
 draw();
}
const titles={overview:['Visão geral','Acompanhe o funcionamento da operação'],conversations:['Conversas','Mensagens reais, tudo em um só lugar'],prospects:['Prospecção','Acompanhe cada empresa ao longo do funil'],workflows:['Workflows','Configure o que será enviado após cada resposta'],discovery:['Descoberta','Encontre empresas e organize oportunidades'],connections:['Conexões','Gerencie sua sessão do WhatsApp'],settings:['Configurações','Controle o funcionamento da prospecção']};
function draw(){
 if(!state)return;
 document.querySelectorAll('[data-route]').forEach(b=>b.classList.toggle('active',b.dataset.route===page));
 const t=titles[page]||titles.overview;
 $('#heading').innerHTML='<h1>'+t[0]+'</h1><p>'+t[1]+'</p>';
 $('#dot').classList.toggle('on',!state.settings.paused);
 $('#service-status').textContent=state.settings.paused?'Prospecção pausada':'Prospecção habilitada';
 $('#pause-btn').textContent=state.settings.paused?'Retomar prospecção':'Pausar prospecção';
 $('#nav-unread').textContent=state.threads.reduce((sum,t)=>sum+t.unread_count,0)||'';
 $('#sync-status').textContent=state.connection.status==='CONNECTED'?'WhatsApp conectado':'WhatsApp: '+state.connection.status.toLowerCase();
 const views={overview,conversations,prospects,workflows,discovery,connections,settings};
 $('#screen').innerHTML=(views[page]||overview)();
 if(page==='conversations'&&selectedThread)loadMessages();
 if(page==='workflows')bindWorkflowInputs();
}
function overview(){
 const counts=[['Perfis analisados',state.stats.profiles_analyzed||0],['Encontrados',state.stats.found],['Sem site',state.stats.without_site],['Qualificados',state.stats.qualified||0],['Abordados',state.stats.contacted],['Responderam',state.stats.responded],['Interessados',state.stats.interested],['Reuniões',state.stats.meetings||0]];
 return '<div class="metrics">'+counts.map(([title,n])=>'<div class="panel metric"><small>'+title+'</small><strong>'+n+'</strong><span class="tag">Dados do banco</span></div>').join('')+'</div>'+
 '<div class="content-grid"><section class="panel"><div class="between"><h3>Últimas oportunidades</h3><button class="btn small secondary" data-action="route" data-to="prospects">Ver Kanban →</button></div>'+
 (state.leads.length?state.leads.slice(0,7).map(l=>'<div class="activity"><span class="dotmini">◉</span><div style="flex:1"><strong>'+esc(l.business)+'</strong><small>'+esc(l.instagram?'@'+l.instagram:l.phone||'Sem contato')+' · '+esc((l.origins||[l.source]).join(', '))+'</small></div><span class="tag '+(l.stage==='INTERESTED'?'green':'')+'">'+esc(labelStage[l.stage]||l.stage)+'</span></div>').join(''):'<div class="empty">Nenhum lead encontrado. Use a página Descoberta para começar.</div>')+'</section>'+
 '<section class="panel"><h3>Central operacional</h3><div class="activity"><span class="dotmini">◎</span><div><strong>WhatsApp</strong><small>'+esc(state.connection.status)+'</small></div></div>'+
 '<div class="activity"><span class="dotmini">⌁</span><div><strong>Workflows</strong><small>'+state.workflows.length+' configurado(s)</small></div></div>'+
 '<div class="activity"><span class="dotmini">◷</span><div><strong>Fila de mensagens</strong><small>'+state.jobs.filter(x=>x.status==='PENDING').length+' aguardando · '+state.jobs.filter(x=>x.status==='UNKNOWN').length+' com estado desconhecido</small></div></div>'+
 '<div class="activity"><span class="dotmini">⌕</span><div><strong>Pesquisa externa</strong><small>'+(state.searchConfigured?'Brave API configurada':'Aguardando BRAVE_SEARCH_API_KEY')+'</small></div></div>'+
 '<p class="subtle" style="font-size:12px;line-height:1.7;margin-top:24px">O painel não executa campanhas sem permissão configurada. Mensagens ambíguas exigem revisão humana.</p></section></div>'+
 '<section class="panel" style="margin-top:18px"><div class="between"><h3>Próximas reuniões</h3><button class="btn small" data-action="new-meeting">+ Agendar reunião</button></div>'+
 ((state.meetings||[]).filter(m=>m.status==='SCHEDULED'&&new Date(m.start_at)>new Date()).slice(0,10).map(m=>'<div class="activity"><span class="dotmini">◷</span><div style="flex:1"><strong>'+esc(m.business)+'</strong><small>'+fmtDate(m.start_at)+' · '+esc(m.notes||'')+'</small></div><button class="btn small ghost" data-action="cancel-meeting" data-id="'+m.id+'">Cancelar</button></div>').join('')||'<div class="empty">Nenhuma reunião agendada.</div>')+'</section>';
}
function prospects(){
 const filtered=state.leads.filter(l=>!kanbanSearch||[l.business,l.name,l.phone,l.instagram].some(x=>String(x||'').toLowerCase().includes(kanbanSearch)));
 let markup='<div class="between section-head"><div><h2>Pipeline comercial</h2><p>Clique em um card para abrir a conversa, ou altere a etapa.</p></div><div class="actionsrow"><button class="btn secondary" data-action="import">Importar JSON</button><button class="btn" data-action="new-lead">+ Adicionar lead</button></div></div>';
 markup+='<div class="toolbar"><input class="searchbox" placeholder="Buscar por empresa, telefone ou Instagram..." id="kanban-search" value="'+esc(kanbanSearch)+'"></div>';
 markup+='<div class="board">'+stages.map(([stage,title,color])=>{
  const arr=filtered.filter(l=>l.stage===stage);
  return '<div class="column" data-dropstage="'+stage+'"><div class="column-header"><strong>'+title+'</strong><span class="count">'+arr.length+'</span></div>'+
  (arr.length?arr.map(l=>'<div class="leadcard" draggable="true" data-dragid="'+l.id+'" data-action="open-lead" data-lead="'+l.id+'"><strong>'+esc(l.name||l.business)+'</strong><div class="phone">'+esc(l.phone||'WhatsApp não identificado')+'</div><footer><small>'+esc(l.business)+' · '+(l.score??0)+' pts</small><span class="tag '+color+'">'+esc(labelStage[stage])+'</span></footer></div>').join(''):'<div class="empty" style="padding:25px 4px;font-size:12px">Nenhum lead</div>')+'</div>';
 }).join('')+'</div>';
 const fresh=filtered.filter(l=>l.stage==='DISCOVERED');
 markup+='<section class="panel" style="margin-top:12px"><div class="between"><h3>Novos leads para qualificação ('+fresh.length+')</h3><span class="tag">Não abordados</span></div>'+
 (fresh.length?fresh.slice(0,80).map(l=>'<div class="activity"><span class="dotmini">⌕</span><div style="flex:1"><strong>'+esc(l.business)+'</strong><small>'+esc(l.instagram?'@'+l.instagram:'')+' · '+esc(l.city||'Cidade não informada')+' · '+esc(l.website_status)+'</small></div><button class="btn small secondary" data-action="review-lead" data-lead="'+l.id+'">Detalhes</button><button class="btn small" data-action="start-lead" data-lead="'+l.id+'">Iniciar fluxo</button></div>').join(''):'<div class="empty">Sem leads novos</div>')+'</section>';
 return markup;
}
function conversations(){
 const list=state.threads.filter(x=>(x.business+' '+(x.phone||'')).toLowerCase().includes(chatSearch));
 const current=state.threads.find(t=>t.id===selectedThread);
 return '<div class="panel chat-shell '+(current?'mobile-open':'')+'"><div class="chat-left"><div class="pad"><input id="chat-search" placeholder="Pesquisar conversa..." value="'+esc(chatSearch)+'"></div><div class="chat-list">'+
 (list.length?list.map(t=>'<button class="chatitem '+(t.id===selectedThread?'selected':'')+'" data-action="open-thread" data-thread="'+t.id+'"><span class="avatar">'+esc((t.name||t.business).slice(0,1).toUpperCase())+'</span><span class="info"><strong>'+esc(t.name||t.business)+'</strong><small>'+esc(t.business)+' · '+esc(labelStage[t.stage]||t.stage)+'</small></span><span style="text-align:right"><small>'+fmtDate(t.last_message_at).split(' ').pop()+'</small>'+(t.unread_count?'<span class="unread">'+t.unread_count+'</span>':'')+'</span></button>').join(''):'<div class="empty"><strong>Nenhuma conversa</strong><p>As conversas aparecem quando houver mensagens.</p></div>')+'</div></div>'+
 '<div class="chat-right">'+(current?'<div class="chathead"><div class="row"><button class="btn small ghost" data-action="back-chat">‹</button><span class="avatar">'+esc(current.business[0].toUpperCase())+'</span><div><strong>'+esc(current.name||current.business)+'</strong><br><small>'+esc(current.phone||'')+'</small></div></div><button class="btn small '+(current.manual_takeover?'secondary':'')+'" data-action="takeover" data-thread="'+current.id+'" data-value="'+(current.manual_takeover?0:1)+'">'+(current.manual_takeover?'Devolver para automação':'Assumir conversa')+'</button></div>'+
 '<div id="messages" class="chatmessages"><div class="loader">Carregando mensagens…</div></div><form id="composer" class="composer"><input id="message-text" placeholder="Digite uma mensagem..." autocomplete="off" required><button class="btn" type="submit">Enviar ↗</button></form>':
 '<div class="empty" style="margin:auto"><div class="symbol">◉</div><strong>Selecione uma conversa</strong><p>Atenda os interessados e acompanhe o histórico.</p></div>')+'</div></div>';
}
async function loadMessages(){
 const current=selectedThread;if(!current)return;
 try{
  const r=await fetch('/api/threads/'+encodeURIComponent(current)+'/messages');
  const messages=await r.json();if(current!==selectedThread)return;
  const out=$('#messages');if(!out)return;
  out.innerHTML=messages.length?messages.map(m=>'<div class="bubble '+(m.direction==='out'?'out':'')+'">'+(m.type==='text'?'<p>'+esc(m.body)+'</p>':('<strong>'+esc(m.type.toUpperCase())+'</strong><p>'+esc(m.body||'Mídia recebida/enviada')+'</p>'+(m.media_id?'<a href="/api/media/'+esc(m.media_id)+'" target="_blank">Abrir mídia ↗</a>':'')))+'<small>'+fmtDate(m.at)+' · '+esc(m.status)+'</small></div>').join(''):'<div class="empty">Sem mensagens registradas</div>';
  out.scrollTop=out.scrollHeight;
  if(state.threads.find(t=>t.id===current)?.unread_count)await request('/api/threads/'+current+'/read',{});
 }catch(e){showToast(e.message);}
}
function getCurrentWorkflow(){
 if(editing&&(editing.id===workflowId||(workflowId==='new'&&editing.id===null)))return editing;
 const w=state.workflows.find(w=>w.id===workflowId)||state.workflows[0];
 if(!w)return null;workflowId=w.id;editing=structuredClone(w);dirty=false;return editing;
}
function workflows(){
 const wf=getCurrentWorkflow();if(!wf)return '<div class="empty">Nenhum workflow</div>';
 const assets=state.media.filter(x=>x.kind===mediaTab);
 let body='<div class="between section-head"><div><h2>Editor de fluxo</h2><p>Crie blocos verticais de mensagens, espera e mídias. Sem IA no runtime.</p></div><div class="actionsrow"><button class="btn secondary" data-action="new-workflow">+ Novo</button><button class="btn" data-action="save-workflow">Salvar workflow'+(dirty?' •':'')+'</button></div></div>';
 body+='<div class="toolbar"><select id="workflow-select" style="max-width:310px">'+state.workflows.map(x=>'<option value="'+x.id+'" '+(x.id===wf.id?'selected':'')+'>'+esc(x.name)+(x.is_default?' • padrão':'')+'</option>').join('')+'</select><button class="btn small secondary" data-action="default-workflow">Definir como padrão</button><span class="tag">Versão '+esc(wf.version)+'</span></div>';
 body+='<div class="workflow-layout"><section class="panel"><h3>Biblioteca de mídias</h3><div class="toolbar"><button class="btn small '+(mediaTab==='video'?'':'secondary')+'" data-action="media-tab" data-kind="video">Vídeos</button><button class="btn small '+(mediaTab==='audio'?'':'secondary')+'" data-action="media-tab" data-kind="audio">Áudios</button><button class="btn small '+(mediaTab==='image'?'':'secondary')+'" data-action="media-tab" data-kind="image">Imagens</button></div><div class="field"><input id="upload-input" type="file" accept="'+(mediaTab==='video'?'video/mp4':mediaTab==='audio'?'audio/*':'image/png,image/jpeg,image/webp')+'"></div>'+
 (assets.length?assets.map(a=>'<div class="asset"><span>'+icons[a.kind]+'</span><div style="flex:1;min-width:0"><strong>'+esc(a.name)+'</strong><small>'+Math.round(a.bytes/1024)+' KB'+(a.duration?' · '+Math.ceil(a.duration)+'s':'')+'</small></div><a href="/api/media/'+a.id+'" target="_blank">↗</a></div>').join(''):'<div class="empty" style="padding:34px 0">Nenhum arquivo enviado</div>')+
 '<div class="spacer"></div><p class="subtle" style="font-size:11px;line-height:1.8">Vídeos de até 60 segundos. Validação no servidor requer FFmpeg/ffprobe instalado.</p></section>';
 body+='<section class="panel"><div class="between"><h3>Blocos do workflow</h3><span class="tag green">'+wf.steps.length+' etapas</span></div><div class="field"><label>Nome do workflow</label><input id="workflow-name" value="'+esc(wf.name)+'"></div><div class="editor">';
 body+=wf.steps.map((step,i)=>'<div class="step"><div class="stepname"><div class="row"><span class="tag '+(step.type==='end'?'green':'blue')+'">'+(i+1)+'</span><strong>'+esc(({message:'Mensagem',wait_reply:'Aguardar resposta',delay:'Esperar',video:'Enviar vídeo',audio:'Enviar áudio',image:'Enviar imagem',end:'Fim do fluxo'})[step.type]||step.type)+'</strong></div><div class="controls">'+(step.type!=='end'?'<button class="btn small ghost" data-action="step-up" data-index="'+i+'">↑</button><button class="btn small ghost" data-action="step-down" data-index="'+i+'">↓</button><button class="btn small danger" data-action="step-delete" data-index="'+i+'">×</button>':'')+'</div></div>'+
 (step.type==='message'?'<textarea data-step-field="text" data-index="'+i+'" rows="3" placeholder="Olá, {{business_name}}!">'+esc(step.text||'')+'</textarea><small>Variáveis: {{first_name}}, {{person_name}}, {{business_name}}, {{city}}, {{segment}}</small>':
 step.type==='delay'?'<div class="row"><input type="number" min="1" max="86400" data-step-field="seconds" data-index="'+i+'" value="'+esc(step.seconds||10)+'" style="max-width:145px"><small>segundos</small></div>':
 ['audio','video','image'].includes(step.type)?'<select data-step-field="media_id" data-index="'+i+'"><option value="">Selecione a mídia…</option>'+state.media.filter(a=>a.kind===step.type).map(a=>'<option value="'+a.id+'" '+(a.id===step.media_id?'selected':'')+'>'+esc(a.name)+'</option>').join('')+'</select>':
 step.type==='wait_reply'?'<small>O fluxo fica parado até chegar uma resposta real. Recusas e pedidos de parada interrompem automaticamente.</small>':
 '<small>Não há outras etapas.</small>')+'</div>'+(i<wf.steps.length-1?'<div class="step-arrow">↓</div>':'')).join('');
 body+='</div><div class="toolbar">'+['message','wait_reply','delay','video','audio','image'].map(type=>'<button class="btn small secondary" data-action="add-step" data-type="'+type+'">+ '+({message:'Mensagem',wait_reply:'Resposta',delay:'Espera',video:'Vídeo',audio:'Áudio',image:'Imagem'})[type]+'</button>').join('')+'</div></section></div>';
 return body;
}
function bindWorkflowInputs(){
 $('#workflow-name')?.addEventListener('input',e=>{getCurrentWorkflow().name=e.target.value;dirty=true;});
 document.querySelectorAll('[data-step-field]').forEach(el=>el.addEventListener('input',e=>{
  const x=getCurrentWorkflow().steps[Number(el.dataset.index)],k=el.dataset.stepField;
  x[k]=k==='seconds'?Number(el.value):el.value;dirty=true;
 }));
}
function discovery(){
 const providers=state.providers||[];
 return '<div class="section-head"><h2>Fontes de descoberta</h2><p>Descubra oportunidades de diferentes origens com transparência sobre as integrações.</p></div>'+
 '<div class="cards"><section class="panel"><h3>Pesquisar perfis indexados</h3><div class="field"><label>Segmento e cidade</label><input id="discover-query" placeholder="Ex.: psicóloga Sorocaba ou clínica estética Campinas"></div><button class="btn" data-action="discover" '+(!state.searchConfigured?'disabled':'')+'>Pesquisar perfis</button><p class="subtle" style="line-height:1.8;font-size:12px;margin-top:18px">'+(state.searchConfigured?'Pesquisa web configurada. A ausência de link não comprova ausência de site.':'Configure BRAVE_SEARCH_API_KEY no ambiente do servidor. Não há busca pública ativa sem chave.')+'</p></section>'+
 '<section class="panel"><h3>Últimas pesquisas</h3>'+(state.discoveries.length?state.discoveries.slice(0,6).map(d=>'<div class="activity"><span class="dotmini">⌕</span><div><strong>'+esc(d.query)+'</strong><small>'+d.found+' novo(s) · '+fmtDate(d.at)+'</small></div></div>').join(''):'<div class="empty">Nenhuma pesquisa registrada.</div>')+'</section></div>'+
 '<section class="panel" style="margin-top:18px"><h3>Provedores de prospecção</h3>'+providers.map(p=>'<div class="activity"><span class="dotmini">⌕</span><div style="flex:1"><strong>'+esc(p.label)+'</strong><small>'+esc(p.note)+'</small></div><span class="tag '+(p.status==='READY'?'green':p.status==='NEEDS_API_KEY'?'yellow':'')+'">'+esc(p.status==='READY'?'Pronto':p.status==='NEEDS_API_KEY'?'Sem chave':'Não integrado')+'</span></div>').join('')+'</section>'+
 '<section class="panel" style="margin-top:18px"><h3>Qualificação e descoberta</h3><p class="subtle" style="line-height:1.8">Resultados entram como site incerto até verificação. A busca pode encontrar empresas com site. A deduplicação compartilha o mesmo banco entre fontes, sem reenviar abordagens iniciais. Fontes ainda não implementadas não executam pesquisas fictícias.</p></section>';
}
function connections(){
 const c=state.connection,connected=c.status==='CONNECTED';
 return '<div class="cards"><section class="panel"><div class="between"><div><h3>WhatsApp</h3><span class="tag '+(connected?'green':'yellow')+'">'+esc(c.status)+'</span></div><div class="avatar" style="background:#dff5ed;color:#108f70">◉</div></div>'+
 '<p class="subtle">Conexão por Baileys. Apenas um processo deve usar a sessão de cada vez.</p>'+
 (c.qr?'<img class="qr" src="'+esc(c.qr)+'" alt="QR Code WhatsApp"><p>WhatsApp → Aparelhos conectados → Conectar aparelho.</p>':'')+
 '<div class="spacer"></div><div class="actionsrow"><button class="btn" data-action="connect" '+(connected?'disabled':'')+'>Conectar / gerar QR</button><button class="btn secondary" data-action="disconnect">Desconectar</button></div>'+
 (c.user?'<p class="subtle">Conta: '+esc(c.user)+'</p>':'')+(c.error?'<p class="tag red">'+esc(c.error)+'</p>':'')+'</section>'+
 '<section class="panel"><h3>Integrações de descoberta</h3><div class="activity"><span class="dotmini">⌕</span><div><strong>Brave Search API</strong><small>'+(state.searchConfigured?'Configurada':'Credencial não configurada')+'</small></div></div><p class="subtle" style="line-height:1.8;font-size:12px">A conexão com Instagram autenticado e a Biblioteca de Anúncios ainda não está configurada. Não existe endpoint oficial para pesquisar irrestritamente todos os perfis do Instagram.</p><h3 style="margin-top:25px">Obsidian</h3><p class="subtle" style="line-height:1.8;font-size:12px">A integração direta com o vault não está instalada neste pacote. O motor funciona sem IA e sem Obsidian.</p></section></div>';
}
function settings(){
 const s=state.settings;
 return '<div class="narrow"><section class="panel"><h3>Controle de automação</h3>'+[
 ['paused','Prospecção pausada','Quando ativo, novas abordagens de workflow não são enviadas.',true],
 ['automation_enabled','Continuação de workflows','Permite avançar blocos após respostas recebidas.',true],
 ['auto_initial','Contato inicial automático','Reservado para futuros provedores com permissão verificada.',true]
 ].map(([key,title,description])=>'<div class="switchrow"><div><strong>'+title+'</strong><small>'+description+'</small></div><input type="checkbox" data-setting="'+key+'" '+(s[key]?'checked':'')+'></div>').join('')+
 '<div class="spacer"></div><h3>Fontes de descoberta</h3>'+
 (state.providers||[]).map(p=>'<div class="switchrow"><div><strong>'+esc(p.label)+'</strong><small>'+esc(p.status==='NOT_IMPLEMENTED'?'Ainda não integrado — não poderá executar buscas':p.note)+'</small></div><input type="checkbox" data-source="'+p.id+'" '+((s.discovery_sources||{})[p.id]?'checked':'')+' '+(p.status==='NOT_IMPLEMENTED'?'disabled':'')+'></div>').join('')+
 '<div class="spacer"></div><h3>Prioridade</h3><div class="field"><label>Busca prioritária</label><select id="discovery-priority">'+
 ['no_website','ads_only','selected_segments'].map((v,i)=>'<option value="'+v+'" '+(s.discovery_priority===v?'selected':'')+'>'+['Qualquer empresa sem site','Apenas anunciantes (fonte pendente)','Somente segmentos selecionados'][i]+'</option>').join('')+'</select></div>'+
 '<div class="switchrow"><div><strong>Brasil inteiro</strong><small>Permitir resultados fora das cidades selecionadas quando a fonte permitir.</small></div><input type="checkbox" id="discovery-brazil" '+(s.discovery_brazil_wide?'checked':'')+'></div>'+
 '<h3 style="margin-top:22px">Pontuação dos leads</h3><div class="score-grid">'+
 Object.entries(s.score_weights||{}).map(([k,v])=>'<label class="score-weight"><span>'+esc(({noWebsite:'Sem site',activeAd:'Anúncio confirmado',publicWhatsapp:'WhatsApp comercial',activeBusiness:'Perfil comercial',prioritySegment:'Segmento prioritário',location:'Localização',businessName:'Nome comercial'})[k]||k)+'</span><input type="number" min="0" max="30" data-weight="'+k+'" value="'+Number(v)+'"></label>').join('')+'</div>'+
 '<div class="spacer"></div><div class="two"><div class="field"><label>Intervalo entre primeiras abordagens (minutos)</label><input type="number" data-setting-number="min_minutes" min="5" max="1440" value="'+esc(s.min_minutes)+'"></div><div class="field"><label>Máximo por dia</label><input type="number" data-setting-number="daily_limit" min="1" max="1000" value="'+esc(s.daily_limit)+'"></div></div>'+
 '<div class="two"><div class="field"><label>Horário inicial (Brasília)</label><input type="number" data-setting-number="business_start" min="0" max="23" value="'+esc(s.business_start)+'"></div><div class="field"><label>Horário final (Brasília)</label><input type="number" data-setting-number="business_end" min="1" max="24" value="'+esc(s.business_end)+'"></div></div>'+
 '<div class="two"><div class="field"><label>Segmentos de pesquisa</label><textarea data-setting-text="segments">'+esc(s.segments||'')+'</textarea></div><div class="field"><label>Cidades</label><textarea data-setting-text="cities">'+esc(s.cities||'')+'</textarea></div></div><button class="btn" data-action="save-settings">Salvar configurações</button></section>'+
 '<section class="panel" style="margin-top:18px"><h3>Proteção de dados</h3><p class="subtle" style="line-height:1.8">O servidor escuta apenas em 127.0.0.1. Histórico de mensagens, mídia e sessão ficam no computador e não devem ser enviados ao GitHub. Resultados de envio desconhecidos não são reenviados automaticamente.</p></section></div>';
}
function modal(html){$('#modal').innerHTML='<div class="modal">'+html+'</div>';$('#modal').classList.remove('hidden');}
function closeModal(){$('#modal').classList.add('hidden');$('#modal').innerHTML='';}
function openLeadModal(lead=null){
 modal('<div class="between"><h2>'+(lead?'Detalhes da oportunidade':'Adicionar lead')+'</h2><button class="btn ghost small" data-action="close-modal">×</button></div>'+
 (lead?'<p class="tag">'+esc(labelStage[lead.stage]||lead.stage)+'</p><p>'+esc(lead.business)+'</p><p class="subtle">'+esc(lead.instagram?'@'+lead.instagram:'')+' · '+esc(lead.phone||'Sem WhatsApp')+'</p><p class="subtle">Site: '+esc(lead.website||'Não identificado')+' · '+esc(lead.website_status)+'</p>'+
 '<p class="subtle">Origem: '+esc((lead.origins||[lead.source]).join(', '))+' · '+(lead.score??0)+' pontos</p><div class="field"><button class="btn small secondary" data-action="verify-site" data-lead="'+lead.id+'">Pesquisar possíveis sites ↗</button></div><div class="field"><label>Site identificado</label><input id="edit-website" value="'+esc(lead.website||'')+'"></div><div class="field"><label>Status do site</label><select id="edit-website-status">'+['UNCERTAIN','NO_WEBSITE','HAS_WEBSITE','SOCIAL_ONLY','LINK_AGGREGATOR_ONLY','BROKEN_WEBSITE'].map(x=>'<option value="'+x+'" '+(x===lead.website_status?'selected':'')+'>'+x+'</option>').join('')+'</select></div><div class="field"><label>WhatsApp</label><input id="edit-phone" value="'+esc(lead.phone||'')+'"></div><div class="switchrow"><div><strong>Contato comercial autorizado</strong><small>Habilite apenas quando houver base apropriada para contato.</small></div><input id="permission" type="checkbox" '+(lead.contact_permission?'checked':'')+'></div><div class="footer"><button class="btn secondary" data-action="close-modal">Fechar</button><button class="btn" data-action="save-permission" data-lead="'+lead.id+'">Salvar</button></div>':
 '<form id="lead-form"><div class="field"><label>Empresa ou profissional</label><input name="business" required placeholder="Clínica Souza"></div><div class="two"><div class="field"><label>Nome do contato</label><input name="name"></div><div class="field"><label>WhatsApp</label><input name="phone" placeholder="5515999999999"></div></div><div class="two"><div class="field"><label>Instagram</label><input name="instagram" placeholder="@clinicasouza"></div><div class="field"><label>Cidade</label><input name="city"></div></div><div class="field"><label>Site</label><input name="website" placeholder="https://..."></div><div class="field"><label>Presença de site</label><select name="website_status"><option value="UNCERTAIN">Ainda não verificado</option><option value="NO_WEBSITE">Sem site confirmado</option><option value="HAS_WEBSITE">Possui site</option></select></div><div class="switchrow"><label for="lead-permission">Canal de contato autorizado</label><input id="lead-permission" name="contact_permission" type="checkbox"></div><div class="footer"><button type="button" class="btn secondary" data-action="close-modal">Cancelar</button><button class="btn" type="submit">Salvar lead</button></div></form>'));
}
async function openLead(leadId){
 let thread=state.threads.find(t=>t.lead_id===leadId);
 if(!thread){const r=await request('/api/threads/ensure/'+leadId,{});thread={id:r.id};}
 navigate('conversations',thread.id);
}
document.addEventListener('click',async event=>{
 const el=event.target.closest('[data-route],[data-action]');
 if(!el)return;
 if(el.dataset.route){navigate(el.dataset.route);return;}
 const action=el.dataset.action;
 try{
  if(action==='route')return navigate(el.dataset.to);
  if(action==='close-modal')return closeModal();
  if(action==='new-lead')return openLeadModal();
  if(action==='review-lead')return openLeadModal(state.leads.find(l=>l.id===el.dataset.lead));
  if(action==='open-lead')return openLead(el.dataset.lead);
  if(action==='open-thread')return navigate('conversations',el.dataset.thread);
  if(action==='back-chat')return navigate('conversations');
  if(action==='takeover'){await request('/api/threads/'+el.dataset.thread+'/takeover',{value:el.dataset.value==='1'});await load();showToast('Modo de atendimento atualizado.');return;}
  if(action==='verify-site'){const result=await request('/api/leads/'+el.dataset.lead+'/verify-site',{});modal('<h2>Possíveis sites da empresa</h2><p class="subtle">Confirme manualmente se pertencem ao mesmo negócio; ausência de resultados não comprova ausência de site.</p>'+(result.candidates?.length?result.candidates.map(x=>'<div class="activity"><div style="flex:1"><strong>'+esc(x.title||x.domain)+'</strong><small>'+esc(x.domain)+'</small></div><a href="'+esc(x.url)+'" target="_blank" rel="noopener noreferrer">Abrir ↗</a></div>').join(''):'<div class="empty">Nenhum site identificado. Mantenha a classificação incerta.</div>')+'<div class="footer"><button class="btn" data-action="close-modal">Fechar</button></div>');return;}
  if(action==='save-permission'){await request('/api/leads/'+el.dataset.lead+'/update',{website:$('#edit-website').value,website_status:$('#edit-website-status').value,phone:$('#edit-phone').value});await request('/api/leads/'+el.dataset.lead+'/permission',{value:$('#permission').checked});closeModal();await load();showToast('Lead atualizado.');return;}
  if(action==='start-lead'){await request('/api/workflows/start/'+el.dataset.lead,{});showToast('Workflow iniciado.');await load();return;}
  if(action==='connect'){await request('/api/connect',{});await load();return;}
  if(action==='disconnect'){await request('/api/disconnect',{});await load();return;}
  if(action==='new-workflow'){workflowId='new';editing={id:null,name:'Novo workflow',version:1,steps:[{id:crypto.randomUUID(),type:'message',text:'Olá, {{business_name}}! Tudo bem?'},{id:crypto.randomUUID(),type:'wait_reply'},{id:crypto.randomUUID(),type:'end'}]};dirty=true;draw();return;}
  if(action==='media-tab'){mediaTab=el.dataset.kind;draw();return;}
  if(action==='add-step'){const a=getCurrentWorkflow();a.steps.splice(a.steps.length-1,0,{id:crypto.randomUUID(),type:el.dataset.type,text:el.dataset.type==='message'?'Olá, {{business_name}}! Tudo bem?':undefined,seconds:10});dirty=true;draw();return;}
  if(action.startsWith('step-')){
   const wf=getCurrentWorkflow(),steps=wf.steps,i=Number(el.dataset.index);
   if(action==='step-delete')steps.splice(i,1);
   if(action==='step-up'&&i>0)[steps[i-1],steps[i]]=[steps[i],steps[i-1]];
   if(action==='step-down'&&i<steps.length-2)[steps[i],steps[i+1]]=[steps[i+1],steps[i]];
   dirty=true;draw();return;
  }
  if(action==='save-workflow'){const wf=getCurrentWorkflow();const r=await request('/api/workflows',{id:wf.id||undefined,name:wf.name,steps:wf.steps});editing=null;workflowId=r.id;dirty=false;await load();showToast('Workflow salvo e versionado.');return;}
  if(action==='default-workflow'){await request('/api/workflows/default',{id:getCurrentWorkflow().id});await load();showToast('Workflow padrão atualizado.');return;}
  if(action==='save-settings'){
   const data={};document.querySelectorAll('[data-setting]').forEach(x=>data[x.dataset.setting]=x.checked);
   document.querySelectorAll('[data-setting-number]').forEach(x=>data[x.dataset.settingNumber]=Number(x.value));
   document.querySelectorAll('[data-setting-text]').forEach(x=>data[x.dataset.settingText]=x.value);
   data.discovery_sources={...(state.settings.discovery_sources||{})};document.querySelectorAll('[data-source]').forEach(x=>data.discovery_sources[x.dataset.source]=x.checked);
   data.discovery_priority=$('#discovery-priority').value;data.discovery_brazil_wide=$('#discovery-brazil').checked;
   data.score_weights={};document.querySelectorAll('[data-weight]').forEach(x=>data.score_weights[x.dataset.weight]=Number(x.value));
   await request('/api/settings',data);await load();showToast('Configurações salvas.');return;
  }
  if(action==='discover'){const q=$('#discover-query').value;el.disabled=true;try{const r=await request('/api/discover',{query:q});showToast(r.added+' novo(s) perfil(is) encontrado(s).');await load();}finally{el.disabled=false;}return;}
  if(action==='new-meeting')return modal('<h2>Agendar reunião</h2><form id="meeting-form"><div class="field"><label>Lead</label><select name="lead_id" required>'+state.leads.map(l=>'<option value="'+l.id+'">'+esc(l.business)+'</option>').join('')+'</select></div><div class="field"><label>Data e hora</label><input type="datetime-local" name="start_at" required></div><div class="field"><label>Observações</label><textarea name="notes" placeholder="Assunto da reunião"></textarea></div><div class="footer"><button type="button" class="btn secondary" data-action="close-modal">Cancelar</button><button type="submit" class="btn">Agendar</button></div></form>');
  if(action==='cancel-meeting'){await request('/api/meetings/'+el.dataset.id+'/cancel',{});await load();return;}
  if(action==='import')return modal('<h2>Importar prospects JSON</h2><p class="subtle">Arquivo JSON contendo uma lista de leads ou arquivo JSONL. Telefone ou Instagram são obrigatórios.</p><input type="file" id="import-file" accept=".json,.jsonl"><div class="footer"><button class="btn secondary" data-action="close-modal">Cancelar</button><button class="btn" data-action="import-submit">Importar</button></div>');
  if(action==='import-submit'){
   const file=$('#import-file').files[0];if(!file)throw Error('Selecione um arquivo');
   const txt=await file.text();const leads=file.name.endsWith('.jsonl')?txt.split(/\r?\n/).filter(Boolean).map(JSON.parse):JSON.parse(txt);
   const r=await request('/api/import',{leads:Array.isArray(leads)?leads:leads.leads});closeModal();await load();showToast(r.created+' leads importados.');return;
  }
 }catch(e){showToast(e.message);}
});
document.addEventListener('change',async e=>{
 const el=e.target;
 if(el.id==='workflow-select'){editing=null;workflowId=el.value;dirty=false;draw();}
 if(el.id==='upload-input'){
  const file=el.files?.[0];if(!file)return;
  try{
   if(mediaTab==='video'){
    const duration=await new Promise((resolve,reject)=>{const v=document.createElement('video');v.preload='metadata';v.onloadedmetadata=()=>{const n=v.duration;URL.revokeObjectURL(v.src);resolve(n);};v.onerror=()=>reject(Error('Vídeo inválido'));v.src=URL.createObjectURL(file);});
    if(!Number.isFinite(duration)||duration>60)throw Error('O vídeo deve ter no máximo 60 segundos');
   }
   const r=await fetch('/api/media?kind='+encodeURIComponent(mediaTab)+'&name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});
   const v=await r.json();if(!r.ok)throw Error(v.error);await load();showToast('Mídia adicionada.'); 
  }catch(err){showToast(err.message);}
 }
});
document.addEventListener('input',e=>{
 if(e.target.id==='chat-search'){chatSearch=e.target.value.toLowerCase();const p=e.target.selectionStart;draw();const x=$('#chat-search');x?.focus();x?.setSelectionRange(p,p);}
 if(e.target.id==='kanban-search'){kanbanSearch=e.target.value.toLowerCase();const p=e.target.selectionStart;draw();const x=$('#kanban-search');x?.focus();x?.setSelectionRange(p,p);}
});
document.addEventListener('submit',async e=>{
 if(e.target.id==='meeting-form'){e.preventDefault();const v=Object.fromEntries(new FormData(e.target));try{v.start_at=new Date(v.start_at).toISOString();await request('/api/meetings',v);closeModal();await load();showToast('Reunião agendada.');}catch(err){showToast(err.message);} }
 if(e.target.id==='lead-form'){
  e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.contact_permission=e.target.elements.contact_permission.checked;
  try{await request('/api/leads',data);closeModal();await load();showToast('Lead salvo.');}catch(err){showToast(err.message);}
 }
 if(e.target.id==='composer'){
  e.preventDefault();const text=$('#message-text').value.trim();if(!text||!selectedThread)return;
  const t=state.threads.find(x=>x.id===selectedThread);if(!t)return;
  try{await request('/api/leads/'+t.lead_id+'/messages',{text});$('#message-text').value='';showToast('Mensagem adicionada à fila.');await load();}catch(err){showToast(err.message);}
 }
});
$('#pause-btn').addEventListener('click',async()=>{if(!state)return;try{await request('/api/settings',{paused:!state.settings.paused});await load();}catch(e){showToast(e.message);}});
document.addEventListener('dragstart',e=>{const card=e.target.closest('[data-dragid]');if(card)e.dataTransfer.setData('text/plain',card.dataset.dragid);});
document.addEventListener('dragover',e=>{if(e.target.closest('[data-dropstage]'))e.preventDefault();});
document.addEventListener('drop',async e=>{const col=e.target.closest('[data-dropstage]');if(!col)return;e.preventDefault();const id=e.dataTransfer.getData('text/plain');if(!id)return;try{await request('/api/leads/'+id+'/stage',{stage:col.dataset.dropstage});await load();}catch(err){showToast(err.message);}});
window.addEventListener('hashchange',()=>{page=location.hash.split('/')[1]||'overview';selectedThread=location.hash.split('/')[2]||null;draw();});
const feed=new EventSource('/api/events');let debounce=null;
feed.addEventListener('update',()=>{clearTimeout(debounce);debounce=setTimeout(()=>load(page!=='workflows'&&page!=='settings'),650);});
feed.onerror=()=>$('#sync-status').textContent='Reconectando atualizações…';
setInterval(()=>load(page!=='workflows'&&page!=='settings'&&page!=='discovery'),20000);
load();
