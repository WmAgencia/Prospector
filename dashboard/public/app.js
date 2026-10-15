const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate=s=>s?new Date(s).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const labelStage={DISCOVERED:'Encontrado',CONTACTED:'Em abordagem',REPLIED:'Respondeu',NO_INTEREST:'Sem interesse',INTERESTED:'Interessado',CLOSED_WON:'Fechado'};
const websiteLabel={UNCERTAIN:'Verificação inconclusiva',NOT_FOUND_AFTER_CHECK:'Site não encontrado na pesquisa',NO_WEBSITE:'Sem site após revisão humana',HAS_WEBSITE:'Site próprio confirmado',SOCIAL_ONLY:'Somente redes sociais',LINK_AGGREGATOR_ONLY:'Página agregadora',BROKEN_WEBSITE:'Site indisponível'};
const stages=[['DISCOVERED','Encontrados','blue'],['CONTACTED','Em abordagem','blue'],['REPLIED','Responderam','yellow'],['INTERESTED','Interessados','green'],['NO_INTEREST','Sem interesse','red'],['CLOSED_WON','Fechados','green']];
let state=null,page=location.hash.split('/')[1]||'overview',selectedThread=location.hash.split('/')[2]||null,mediaTab='video',workflowId='default',editing=null,dirty=false,loading=false,chatSearch='',kanbanSearch='';
let toastTimer=null,kanbanStage='ALL';
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
 try{const r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)throw Error('API indisponível');state=await r.json();if(shouldDraw)draw();else window.dispatchEvent(new CustomEvent('prospector:data',{detail:{page,state}}));}
 catch(e){$('#sync-status').textContent='Offline';if(!state)$('#screen').innerHTML='<div class="empty"><strong>Não foi possível conectar ao backend</strong><p>'+esc(e.message)+'</p></div>';}
 finally{loading=false;}
}
function navigate(to,thread=null){
 page=to;selectedThread=thread||null;location.hash='/'+to+(thread?'/'+thread:'');
 draw();
}
const titles={radar:['Radar de prospecção','Buscas e limites reais, atualizados pelo backend'],overview:['Visão geral','Acompanhe o funcionamento da operação'],conversations:['Conversas','Mensagens reais, tudo em um só lugar'],prospects:['Prospecção','Acompanhe cada empresa ao longo do funil'],workflows:['Automações','Acompanhe e selecione suas campanhas'],discovery:['Descoberta','Encontre empresas e organize oportunidades'],production:['Produção','Pedidos de exemplo e entregas'],studio:['Site Studio','Propostas visuais exclusivas para apresentar aos clientes'],connections:['Conexões','Gerencie sua sessão do WhatsApp'],settings:['Configurações','Controle o funcionamento da prospecção'],campaign:['Campanha R$350','Mensagem, áudio, vídeo e prazo da oferta'],recontacts:['Recontatos','Histórico e revisão após 90 dias']};
function draw(){
 if(!state)return;
 document.querySelectorAll('[data-route]').forEach(b=>b.classList.toggle('active',b.dataset.route===page));
 const t=titles[page]||titles.overview;
 $('#heading').innerHTML='<div class="eyebrow">CONSECOM <span> / </span> PROSPECTOR</div><h1>'+esc(t[0])+'</h1><p>'+esc(t[1])+'</p>';
 $('#dot').classList.toggle('on',!state.settings.paused);
 $('#service-status').textContent=state.settings.paused?'Prospecção pausada':'Prospecção habilitada';
 $('#pause-btn').textContent=state.settings.paused?'Retomar prospecção':'Pausar prospecção';
 $('#nav-unread').textContent=state.threads.reduce((sum,t)=>sum+t.unread_count,0)||'';
 $('#sync-status').textContent='Atualizado agora';
 const connected=state.connection.status==='CONNECTED';
 const quick=$('#wa-pill');
 if(quick){quick.className='top-wa '+(connected?'online':'offline');quick.innerHTML='<span class="live-dot"></span>'+esc(connected?'WhatsApp conectado':state.connection.status==='QR_READY'?'QR aguardando leitura':'WhatsApp desconectado');}
 const pa=$('#pause-btn');if(pa)pa.classList.toggle('is-running',!state.settings.paused);
 const views={overview,radar:radarPage,conversations,prospects,workflows:location.hash.includes('/classic')?workflows:()=>'<div id="campaign-app"></div>',discovery,production,studio,connections,campaign:campaignPage,recontacts,settings};
 $('#screen').innerHTML=(views[page]||overview)();
 if(page==='conversations'&&selectedThread)loadMessages();
 if(page==='workflows'&&location.hash.includes('/classic'))bindWorkflowInputs();
 if(page==='studio')loadStudio();
 if(page==='production'&&selectedThread){const id=selectedThread;selectedThread=null;prodModal(id);}
 window.dispatchEvent(new CustomEvent('prospector:draw',{detail:{page,state}}));
}

function radarView(){
 const r=state.radar||{},limit=200,used=Number(r.counted||0),confirmed=Number(r.confirmed||0),found=Number(r.foundToday||0);
 const recent=Array.isArray(r.recentFinds)?r.recentFinds:[];
 const spot=(lead)=>{
  const id=String(lead.id||'');
  let n=2166136261;for(const char of id){n=Math.imul(n^char.charCodeAt(0),16777619)>>>0;}
  const angle=(n%360)*Math.PI/180,dist=12+((n>>>9)%34);
  const x=50+Math.cos(angle)*dist,y=50+Math.sin(angle)*dist;
  return '<span class="radar-spot" style="left:'+x.toFixed(2)+'%;top:'+y.toFixed(2)+'%" title="'+esc(lead.name)+' · '+esc(lead.city||'Cidade não informada')+'"></span>';
 };
 const budget=Math.min(100,Math.round(used/limit*1000)/10);
 const last=r.lastSearch||null;
 const lastLabel=last?esc(last.query)+' · '+fmtDate(last.at):'Nenhuma pesquisa registrada';
 const scanning=Boolean(r.searchInProgress);
 return '<section class="panel radar-panel"><div class="radar-heading"><div><div class="panel-eyebrow">RADAR DE OPORTUNIDADES</div><h3>Central de descoberta <span class="tag '+(scanning?'green':'')+'">'+(scanning?'Busca em execução':'Monitoramento')+'</span></h3><p class="subtle">Pontos representam negócios encontrados hoje no banco real. Posição ilustrativa, não localização geográfica.</p></div><button class="btn small secondary" data-action="route" data-to="discovery">Nova pesquisa ↗</button></div>'+
 '<div class="radar-layout"><div class="radar-circle-wrap"><div class="radar-circle" aria-label="'+found+' negócios novos descobertos hoje"><div class="radar-gridline radar-gridline-x"></div><div class="radar-gridline radar-gridline-y"></div><div class="radar-ring ring-a"></div><div class="radar-ring ring-b"></div><div class="radar-ring ring-c"></div><div class="radar-sweep"></div>'+recent.map(spot).join('')+'<div class="radar-core"></div></div><div class="radar-bottom-label">'+(scanning?'VARREDURA EM ANDAMENTO':'ÚLTIMA BUSCA REGISTRADA')+'</div></div>'+
 '<div class="radar-side"><div class="radar-side-kicker"><span class="live-dot"></span> DADOS DO PROSPECTOR</div><div class="radar-big">'+Number(r.foundTotal||0).toLocaleString('pt-BR')+'</div><div class="radar-big-sub">oportunidades cadastradas</div><div class="radar-mini-grid"><div><strong>+'+found+'</strong><span>descobertas hoje</span></div><div><strong>'+Number(r.examinedToday||0).toLocaleString('pt-BR')+'</strong><span>registros examinados hoje</span></div><div><strong>'+Number(r.searchesToday||0)+'</strong><span>pesquisas hoje</span></div><div><strong>'+Number(r.approvedForContact||0)+'</strong><span>contatos autorizados em descoberta</span></div></div><div class="radar-latest">Última consulta: '+lastLabel+'</div></div></div>'+
 '<div class="radar-quota"><div class="between"><div><div class="panel-eyebrow">ABORDAGENS INICIAIS · HOJE</div><h3><strong>'+confirmed+'</strong> <span class="subtle">/ 200 confirmadas</span></h3></div><div class="radar-quota-info">12h–18h · mínimo 108 s de intervalo<br><small>'+Number(r.uncertain||0)+' com entrega incerta · '+Math.max(0,limit-used)+' posições restantes</small></div></div><div class="radar-meter" role="progressbar" aria-label="Limite de primeiras abordagens" aria-valuemin="0" aria-valuemax="200" aria-valuenow="'+Math.min(200,used)+'"><span style="width:'+budget+'%"></span></div><div class="radar-ticks"><span>0</span><span>50</span><span>100</span><span>150</span><span>200</span></div><p class="helper-text">O preenchimento considera envios confirmados e os de resultado incerto, evitando exceder o teto. Descobertas sem consentimento não são abordadas. O radar não representa mensagens de acompanhamento.</p></div></section>';
}
function radarPage(){
 const r=state.radar||{};
 const cohort=r.pilot||{};
 return radarView()+'<div class="dashboard-grid" style="margin-top:18px"><section class="panel"><div class="panel-eyebrow">PILOTO DE VALIDAÇÃO</div><h3>Primeiras 200 oportunidades</h3><div class="status-line"><span>Amostra identificada</span><strong>'+Number(cohort.total||0)+' / 200</strong></div><div class="status-line"><span>Sites revisados</span><strong>'+Number(cohort.siteReviewed||0)+'</strong></div><div class="status-line"><span>Contatos autorizados</span><strong>'+Number(cohort.authorized||0)+'</strong></div><div class="status-line"><span>Abordados</span><strong>'+Number(cohort.contacted||0)+'</strong></div><div class="status-line"><span>Interessados</span><strong>'+Number(cohort.interested||0)+'</strong></div><p class="helper-text">Amostra real, sem taxas de conversão projetadas.</p></section><section class="panel"><div class="panel-eyebrow">SEGURANÇA OPERACIONAL</div><h3>Regras aplicadas no backend</h3><div class="status-line"><span>Teto de primeiras abordagens</span><strong>200/dia</strong></div><div class="status-line"><span>Horário (São Paulo)</span><strong>12h–18h</strong></div><div class="status-line"><span>Intervalo alvo</span><strong>108 segundos</strong></div><div class="status-line"><span>Envio para contatos sem autorização</span><strong>Bloqueado</strong></div><p class="helper-text">O teto não é uma meta de disparos: caso não haja 200 contatos consentidos, serão realizadas menos abordagens.</p></section></div>';
}

function overview(){
 const stats=state.stats||{},s=state.settings||{},c=state.connection||{};
 const wa=c.status==='CONNECTED',active=state.activeCampaign||null;
 const running=!s.paused&&wa&&s.auto_initial&&!!active;
 const pending=state.jobs.filter(x=>x.status==='PENDING').length;
 const uncertain=state.jobs.filter(x=>x.status==='UNKNOWN').length;
 const interested=state.leads.filter(x=>x.stage==='INTERESTED').length;
 const counts=[
  ['◎','Encontrados',stats.found||0,'prospects'],
  ['↗','Abordagens',stats.contacted||0,'conversations'],
  ['◉','Respostas',stats.responded||0,'conversations'],
  ['✳','Interessados',interested,'prospects']
 ];
 const latest=state.leads.slice(0,5);
 return '<section class="simple-hero"><div><span class="simple-kicker">VISÃO GERAL · CONSECOM</span><h2>Tudo sob controle.</h2><p>Veja a descoberta, a campanha selecionada e o que precisa da sua atenção — sem configurações desnecessárias.</p><div class="simple-hero-actions"><button class="btn" data-action="route" data-to="prospects">Ver oportunidades ↗</button><button class="btn secondary" data-action="route" data-to="discovery">Buscar empresas</button></div></div>'+
 '<div class="simple-hero-side"><span class="simple-kicker">CAMPANHA SELECIONADA</span><strong>'+esc(active?.name||'Nenhuma campanha escolhida')+'</strong><p>'+esc(!active?'Selecione uma campanha para novas abordagens.':running?'Operação habilitada · contatos autorizados':s.paused?'Campanha preparada · operação pausada':!wa?'Aguardando conexão com WhatsApp':'Aguardando início automático')+'</p><button class="simple-link" data-action="route" data-to="workflows">Gerenciar campanhas →</button></div></section>'+
 '<div class="simple-stats">'+counts.map(([icon,label,count,to])=>'<button class="simple-stat" data-action="route" data-to="'+to+'"><span>'+icon+' '+label+'</span><strong>'+Number(count).toLocaleString('pt-BR')+'</strong><span class="simple-stat-arrow">↗</span></button>').join('')+'</div>'+
 radarView()+
 '<div class="simple-overview-grid"><section class="panel simple-health"><div class="between"><div><span class="simple-kicker">AGORA</span><h3>Operação</h3></div><button class="btn small secondary" data-action="route" data-to="settings">Configurar</button></div>'+
 '<div class="status-line"><span>WhatsApp</span><strong class="'+(wa?'text-good':'text-warn')+'">'+(wa?'Conectado':'Verificar conexão')+'</strong></div>'+
 '<div class="status-line"><span>Prospecção</span><strong>'+(!s.paused?'Habilitada':'Pausada')+'</strong></div>'+
 '<div class="status-line"><span>Campanha</span><strong>'+esc(active?'Selecionada':'Não selecionada')+'</strong></div>'+
 '<div class="status-line"><span>Fila de mensagens</span><strong>'+pending+'</strong></div>'+
 '<div class="status-line"><span>Entregas incertas</span><strong class="'+(uncertain?'text-warn':'')+'">'+uncertain+'</strong></div>'+
 '<p class="helper-text">A prospecção não autoriza automaticamente contatos descobertos na internet.</p></section>'+
 '<section class="panel simple-recent"><div class="between"><div><span class="simple-kicker">ACOMPANHAMENTO</span><h3>Oportunidades recentes</h3></div><button class="btn small secondary" data-action="route" data-to="prospects">Abrir Kanban ↗</button></div>'+
 (latest.length?latest.map(l=>'<div class="simple-lead"><div class="simple-lead-avatar">'+esc((l.business||'E')[0].toUpperCase())+'</div><div><strong>'+esc(l.business)+'</strong><small>'+esc(l.city||'Cidade não informada')+' · '+esc(labelStage[l.stage]||l.stage)+'</small></div></div>').join(''):'<div class="cm-empty">As empresas encontradas aparecerão aqui. Inicie pela Descoberta.</div>')+'</section></div>';
}
function prospects(){
 const filtered=state.leads.filter(l=>!kanbanSearch||[l.business,l.name,l.phone,l.instagram].some(x=>String(x||'').toLowerCase().includes(kanbanSearch)));
 let markup='<div class="between section-head"><div><h2>Suas oportunidades</h2><p>Encontre, acompanhe e converse com os profissionais selecionados.</p></div><div class="actionsrow"><button class="btn secondary" data-action="route" data-to="discovery">⌕ Buscar empresas</button><button class="btn" data-action="new-lead">+ Adicionar</button></div></div>';
 markup+='<div class="toolbar"><input class="searchbox" placeholder="Buscar empresa, telefone ou Instagram..." id="kanban-search" value="'+esc(kanbanSearch)+'"></div>';
 markup+='<div class="simple-stage-tabs">'+[['ALL','Todas'],...stages.map(x=>[x[0],x[1]])].map(([key,title])=>'<button class="simple-stage-tab '+(kanbanStage===key?'selected':'')+'" data-action="kanban-filter" data-stage="'+key+'">'+esc(title)+' <span>'+filtered.filter(x=>key==='ALL'||x.stage===key).length+'</span></button>').join('')+'</div>';
 markup+='<div class="board '+(kanbanStage==='ALL'?'':'simple-board-focus')+'">'+stages.filter(x=>kanbanStage==='ALL'||x[0]===kanbanStage).map(([stage,title,color])=>{
  const arr=filtered.filter(l=>l.stage===stage);
  return '<div class="column" data-dropstage="'+stage+'"><div class="column-header"><strong>'+title+'</strong><span class="count">'+arr.length+'</span></div>'+
  (arr.length?arr.map(l=>'<div class="leadcard" draggable="true" data-dragid="'+l.id+'" data-action="open-lead" data-lead="'+l.id+'"><strong>'+esc(l.name||l.business)+'</strong><div class="phone">'+esc(l.phone||'WhatsApp não identificado')+'</div><footer><small>'+esc(l.business)+' · '+(l.score??0)+' pts</small><span class="tag '+color+'">'+esc(labelStage[stage])+'</span></footer><div class="actionsrow" style="margin-top:10px"><button class="btn small secondary" data-action="review-lead" data-lead="'+l.id+'">Revisar</button>'+(stage==='DISCOVERED'?'<button class="btn small" data-action="start-lead" data-lead="'+l.id+'">Iniciar</button>':'')+'</div></div>').join(''):'<div class="empty" style="padding:25px 4px;font-size:12px">Nenhum lead</div>')+'</div>';
 }).join('')+'</div>';
 const fresh=filtered.filter(l=>l.stage==='DISCOVERED');
 markup+='<details class="panel simple-lead-extras" style="margin-top:12px"><summary>Lista de encontrados para revisão ('+fresh.length+')</summary><div class="between"><h3>Novos leads para qualificação ('+fresh.length+')</h3><span class="tag">Não abordados</span></div>'+
 (fresh.length?fresh.slice(0,80).map(l=>'<div class="activity"><span class="dotmini">⌕</span><div style="flex:1"><strong>'+esc(l.business)+'</strong><small>'+esc(l.instagram?'@'+l.instagram:'')+' · '+esc(l.city||'Cidade não informada')+' · '+esc(websiteLabel[l.website_status]||l.website_status)+'</small></div><button class="btn small secondary" data-action="review-lead" data-lead="'+l.id+'">Detalhes</button><button class="btn small" data-action="start-lead" data-lead="'+l.id+'">Iniciar fluxo</button></div>').join('') :'<div class="empty">Sem leads novos</div>')+'</details>';
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
 const wf=getCurrentWorkflow();if(!wf)return '<div class="empty">Nenhuma automação cadastrada</div>';
 const assets=(state.media||[]).filter(x=>x.kind===mediaTab);
 const option=(values,current)=>values.map(([value,label])=>'<option value="'+value+'" '+(value===current?'selected':'')+'>'+label+'</option>').join('');
 const stepField=(i,key,value,placeholder='',rows=2)=>'<textarea data-step-field="'+key+'" data-index="'+i+'" rows="'+rows+'" placeholder="'+esc(placeholder)+'">'+esc(value||'')+'</textarea>';
 const mediaSelect=(i,key,kind,current)=>'<select data-step-field="'+key+'" data-index="'+i+'"><option value="">Selecione '+kind+'…</option>'+(state.media||[]).filter(a=>a.kind===kind).map(a=>'<option value="'+esc(a.id)+'" '+(a.id===current?'selected':'')+'>'+esc(a.name)+'</option>').join('')+'</select>';
 const renderDecision=(step,i)=>{
  const side=(p,title,shade)=>{
   const isAudio=step[p+'_type']==='audio';
   return '<div class="branch-choice '+shade+'"><h4>'+title+'</h4>'+
   '<div class="two"><div class="field"><label>Formato da resposta</label><select data-step-field="'+p+'_type" data-index="'+i+'">'+option([['message','Texto'],['audio','Áudio gravado']],step[p+'_type']||'message')+'</select></div>'+
   '<div class="field"><label>Próximo movimento</label><select data-step-field="'+p+'_action" data-index="'+i+'">'+option(p==='yes'?[['request_sample','Criar pedido de exemplo'],['continue','Continuar automação'],['end','Encerrar']]:[['end','Encerrar'],['continue','Continuar automação']],step[p+'_action']||(p==='no'?'end':'request_sample'))+'</select></div></div>'+
   (isAudio?'<div class="field"><label>Áudio que será enviado</label>'+mediaSelect(i,p+'_media_id','audio',step[p+'_media_id'])+'</div><div class="field"><label>Descrição exata do conteúdo do áudio</label>'+stepField(i,p+'_audio_description',step[p+'_audio_description'],'Explique o que este áudio diz e seu objetivo')+'</div>':
   '<div class="field"><label>Mensagem enviada ao cliente</label>'+stepField(i,p+'_text',step[p+'_text'],p==='yes'?'Perfeito! Vou preparar sua prévia em cerca de 10 minutos.':'Tudo bem! Agradeço seu retorno. Se precisar, estou à disposição.')+'</div>')+'</div>';
  };
  return '<div class="field"><label>O que a mensagem ou áudio anterior perguntou?</label>'+stepField(i,'context_description',step.context_description,'Ex.: Perguntei se quer receber uma demonstração visual')+'<small>A descrição documenta o áudio/pergunta, mas não é interpretada por IA.</small></div>'+
  '<div class="field"><label>Tipo de interesse avaliado</label><select data-step-field="context" data-index="'+i+'">'+option([['sample_offer','Aceitou exemplo de site'],['general_interest','Aceitou continuar a conversa']],step.context||'sample_offer')+'</select></div>'+
  '<div class="branch-split">'+side('yes','✓ Se respondeu SIM','yes')+side('no','× Se respondeu NÃO','no')+'</div>'+
  '<div class="branch-fallback"><strong>Resposta indefinida:</strong> pausar para revisão humana; nunca disparar vídeo, áudio ou pedido de site por suposição.</div>'+
  '<div class="field"><label>Testar texto de resposta</label><div class="row"><input id="test-reply-'+i+'" placeholder="Ex.: pode sim / não tenho interesse / talvez depois"><button class="btn small secondary" data-action="decision-test" data-index="'+i+'">Testar</button></div></div>';
 };
 let body='<div class="between section-head"><div><h2>Automações</h2><p>Mensagens e áudios por segmento, com decisões determinísticas e aprovação humana quando necessário.</p></div>'+
 '<div class="actionsrow"><button class="btn secondary" data-action="new-workflow">+ Nova automação</button><button class="btn" data-action="save-workflow">Salvar automação'+(dirty?' •':'')+'</button></div></div>';
 body+='<div class="toolbar"><select id="workflow-select" style="max-width:370px">'+state.workflows.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===wf.id?'selected':'')+'>'+esc(x.name)+(x.is_default?' • padrão':'')+(x.enabled===false?' • pausada':'')+'</option>').join('')+'</select><button class="btn small secondary" data-action="default-workflow">Usar como padrão geral</button><span class="tag">Versão '+esc(wf.version)+'</span></div>';
 body+='<div class="workflow-layout"><section class="panel"><h3>Biblioteca de mídias</h3><div class="toolbar">'+['video','audio','image'].map(k=>'<button class="btn small '+(k===mediaTab?'':'secondary')+'" data-action="media-tab" data-kind="'+k+'">'+({video:'Vídeos',audio:'Áudios',image:'Imagens'})[k]+'</button>').join('')+'</div>'+
 '<div class="field"><input id="upload-input" type="file" accept="'+(mediaTab==='video'?'video/mp4':mediaTab==='audio'?'audio/*':'image/png,image/jpeg,image/webp')+'"></div>'+
 (assets.length?assets.map(a=>'<div class="asset"><span>'+icons[a.kind]+'</span><div style="flex:1"><strong>'+esc(a.name)+'</strong><small>'+Math.round(a.bytes/1024)+' KB'+(a.duration?' · '+Math.ceil(a.duration)+'s':'')+'</small></div><a href="/api/media/'+a.id+'" target="_blank" rel="noopener noreferrer">↗</a></div>').join(''):'<div class="empty">Envie seu primeiro áudio ou vídeo</div>')+
 '<div class="spacer"></div><p class="subtle" style="font-size:11px;line-height:1.8">Grave o áudio e descreva o conteúdo no bloco em que ele será utilizado. Esse texto é uma instrução humana, não transcrição automática.</p>'+
 '<div class="spacer"></div><h3>Como funciona a decisão?</h3><p class="subtle" style="line-height:1.8">Depois de <strong>Aguardar resposta</strong>, use <strong>Decisão</strong> para separar respostas afirmativas, negativas ou ambíguas. O classificador lê apenas texto e expressões programadas, com prioridade para recusas e bloqueios.</p></section>';
 body+='<section class="panel"><div class="between"><h3>Montar automação</h3><span class="tag green">'+wf.steps.length+' blocos</span></div>'+
 '<div class="field"><label>Nome da automação</label><input id="workflow-name" value="'+esc(wf.name)+'"></div>'+
 '<div class="field"><label>Segmentos atendidos (separados por vírgula)</label><input id="workflow-segments" placeholder="Ex.: Psicologia, Estética, Odontologia" value="'+esc((wf.segments||[]).join(', '))+'"><small>Se o segmento corresponder, esta automação será selecionada. Sem correspondência, será usada a automação padrão.</small></div>'+
 '<div class="switchrow"><div><strong>Automação ativada</strong><small>Desativar impede novas execuções, sem alterar execuções já iniciadas.</small></div><input id="workflow-enabled" type="checkbox" '+(wf.enabled!==false?'checked':'')+'></div>'+
 '<div class="editor">'+wf.steps.map((step,i)=>{
  const titles={message:'Mensagem de texto',wait_reply:'Aguardar resposta',delay:'Tempo de espera',video:'Enviar vídeo',audio:'Enviar áudio',image:'Enviar imagem',decision:'Decisão por resposta',end:'Finalizar'};
  let fields='';
  if(step.type==='message')fields=stepField(i,'text',step.text,'Olá, {{business_name}}! Tudo bem?',3)+'<small>Variáveis: {{first_name}}, {{person_name}}, {{business_name}}, {{city}}, {{segment}}</small>';
  else if(step.type==='delay')fields='<div class="row"><input type="number" min="1" max="86400" data-step-field="seconds" data-index="'+i+'" value="'+esc(step.seconds||10)+'"><small>segundos</small></div>';
  else if(['audio','video','image'].includes(step.type))fields=mediaSelect(i,'media_id',step.type,step.media_id)+(step.type==='audio'?'<div class="field"><label>Descrição do áudio gravado (obrigatória)</label>'+stepField(i,'description',step.description,'O que é dito neste áudio e qual pergunta faz?',3)+'</div>':'');
  else if(step.type==='wait_reply')fields='<small>O fluxo aguarda a mensagem do contato. Coloque um bloco Decisão logo depois para configurar as respostas.</small>';
  else if(step.type==='decision')fields=renderDecision(step,i);
  else fields='<small>Fim desta sequência.</small>';
  return '<div class="step '+(step.type==='decision'?'decision-step':'')+'"><div class="stepname"><div class="row"><span class="tag '+(step.type==='end'?'green':step.type==='decision'?'yellow':'blue')+'">'+(i+1)+'</span><strong>'+titles[step.type]+'</strong></div>'+
  '<div class="controls">'+(step.type!=='end'?'<button class="btn small ghost" data-action="step-up" data-index="'+i+'">↑</button><button class="btn small ghost" data-action="step-down" data-index="'+i+'">↓</button><button class="btn small danger" data-action="step-delete" data-index="'+i+'">×</button>':'')+'</div></div>'+fields+'</div>'+(i<wf.steps.length-1?'<div class="step-arrow">↓</div>':'');
 }).join('')+'</div><div class="toolbar">'+['message','wait_reply','decision','delay','audio','video','image'].map(type=>'<button class="btn small secondary" data-action="add-step" data-type="'+type+'">+ '+({message:'Mensagem',wait_reply:'Resposta',decision:'Decisão',delay:'Espera',audio:'Áudio',video:'Vídeo',image:'Imagem'})[type]+'</button>').join('')+'</div>'+
 '<p class="subtle" style="font-size:11px;margin-top:17px;line-height:1.7">Após o aceite do exemplo, a automação é finalizada e o lead vai para Produção, com notificação e briefing copiável. Entrega ao cliente só após sua aprovação.</p></section></div>';
 return body;
}
function bindWorkflowInputs(){
 $('#workflow-name')?.addEventListener('input',e=>{getCurrentWorkflow().name=e.target.value;dirty=true;});
 $('#workflow-segments')?.addEventListener('input',e=>{getCurrentWorkflow().segments=e.target.value.split(',').map(x=>x.trim()).filter(Boolean);dirty=true;});
 $('#workflow-enabled')?.addEventListener('change',e=>{getCurrentWorkflow().enabled=e.target.checked;dirty=true;});
 document.querySelectorAll('[data-step-field]').forEach(el=>{
  el.addEventListener('input',()=>{
   const obj=getCurrentWorkflow().steps[Number(el.dataset.index)],key=el.dataset.stepField;
   obj[key]=key==='seconds'?Number(el.value):el.value;dirty=true;
  });
  if(['yes_type','no_type','context'].includes(el.dataset.stepField))el.addEventListener('change',()=>draw());
 });
}

function production(){
 const prod=state.production||[],met=state.report||{},lanes=[['REQUESTED','Pedido recebido'],['IN_PROGRESS','Em produção'],['READY','Aprovar'],['SEND_QUEUED','Envio pendente'],['DELIVERED','Entregue'],['NEEDS_REVIEW','Revisão']];
 return '<div class="between section-head"><h2>Kanban de produção</h2><button class="btn secondary" data-action="route" data-to="studio">Site Studio ↗</button></div><div class="production-board">'+lanes.map(([id,title])=>'<div class="production-column"><div class="production-head"><strong>'+title+'</strong><span class="count">'+prod.filter(x=>x.status===id).length+'</span></div>'+prod.filter(x=>x.status===id).map(x=>'<button class="production-card" data-action="prod-open" data-lead="'+esc(x.lead_id)+'"><strong>'+esc(x.business)+'</strong><small>'+esc(x.instagram?'@'+x.instagram:x.city||'')+'</small><span class="tag">'+(x.due_at&&Date.now()>Date.parse(x.due_at)&&['REQUESTED','IN_PROGRESS'].includes(x.status)?'Meta 10 min ultrapassada':'Abrir demanda →')+'</span></button>').join('')+'</div>').join('')+'</div><section class="panel"><h3>Apuração de hoje · relatório WhatsApp às 20h</h3><div class="report-pills">'+[['Abordagens',met.approached],['Respostas',met.responded],['Interessados',met.interested],['Sem interesse',met.notInterested],['Exemplos',met.requested],['Fechamentos',met.closed]].map(([k,v])=>'<span><strong>'+Number(v||0)+'</strong>'+k+'</span>').join('')+'</div></section>';
}
function prodModal(leadId){
 const x=(state.production||[]).find(v=>v.lead_id===leadId);if(!x)return;
 let h='<h2>'+esc(x.business)+'</h2><p class="subtle">'+esc(x.status)+' · '+esc(x.instagram?'@'+x.instagram:'Sem Instagram')+' · '+esc(x.city||'')+'</p><div class="actionsrow"><button class="btn small" data-action="prod-copy" data-lead="'+esc(leadId)+'">Copiar prompt</button><a href="https://chatgpt.com/" class="btn small secondary" target="_blank" rel="noopener noreferrer">Abrir ChatGPT ↗</a></div>';
 if(x.status==='REQUESTED')h+='<p class="subtle">O cliente solicitou a prévia. Você pode criar em qualquer chat.</p><button class="btn" data-action="prod-move" data-status="IN_PROGRESS" data-lead="'+esc(leadId)+'">Iniciar produção</button>';
 if(x.status==='IN_PROGRESS')h+='<div class="field"><label>URL do site publicado</label><input id="prod-url" placeholder="https://prospector-ui-production.up.railway.app/studio/sites/empresa.html"></div><button class="btn" data-action="prod-move" data-status="READY" data-lead="'+esc(leadId)+'">Pronto para minha aprovação</button>';
 if(x.status==='READY')h+='<p><a target="_blank" rel="noopener noreferrer" href="'+esc(x.site_url)+'">Visualizar prévia ↗</a> · <a target="_blank" rel="noopener noreferrer" href="'+esc(x.site_url)+'?print=1">PDF ↗</a></p><button class="btn" data-action="prod-confirm" data-lead="'+esc(leadId)+'">Aprovar e enviar no WhatsApp</button>';
 if(x.status==='DELIVERED')h+='<p class="subtle">Enviado com confirmação.</p><button class="btn" data-action="prod-won" data-lead="'+esc(leadId)+'">Registrar fechamento confirmado</button>';
 if(['NEEDS_REVIEW','OFFER_SENT'].includes(x.status))h+='<p class="subtle">Revise a resposta do cliente antes de confirmar o aceite.</p><button class="btn secondary" data-action="prod-accept" data-lead="'+esc(leadId)+'">Confirmar aceite revisado</button>';
 if(x.status==='SEND_QUEUED')h+='<p class="subtle">Enfileirado, aguardando envio pela sessão WhatsApp.</p>';
 modal(h+'<div class="footer"><button class="btn secondary" data-action="close-modal">Fechar</button></div>');
}
async function prodCopy(leadId){
 const r=await fetch('/api/production/brief/'+encodeURIComponent(leadId)),v=await r.json();if(!r.ok)throw Error(v.error||'Briefing indisponível');
 const prompt='CRIAR LANDING PAGE NO SITE STUDIO — PROSPECTOR\n\n'+JSON.stringify(v,null,2)+'\n\nCrie página autoral e refinada, sem estética genérica. Pesquise fontes públicas, não invente portfólio e publique em WmAgencia/Prospector no studio/sites/<slug>.html e registre no studio/projects.json com production_ref=job_reference. NÃO envie ao cliente; o painel fará a aprovação.';
 try{await navigator.clipboard.writeText(prompt);showToast('Prompt copiado para colar em qualquer chat!');}
 catch{modal('<h2>Copiar prompt</h2><textarea readonly rows="12">'+esc(prompt)+'</textarea><button class="btn" data-action="close-modal">Fechar</button>');}
}

function studio(){
 return '<div class="between section-head" style="align-items:start"><div><span class="tag green">Novo · conectado ao ChatGPT</span><h2 style="margin-top:12px">Seu estúdio de propostas</h2><p>Landing pages comerciais criadas aqui na conversa, organizadas para você apresentar e vender.</p></div><button class="btn" data-action="studio-copy">+ Preparar pedido no ChatGPT</button></div>'+
 '<div class="panel" style="margin-bottom:19px"><div class="row wrap" style="justify-content:space-between"><div><h3 style="margin:0 0 6px">Do Instagram à proposta profissional</h3><p class="subtle" style="margin:0;font-size:12px;max-width:690px;line-height:1.75">Você envia a empresa neste chat. O ChatGPT pesquisa fontes públicas, cria uma identidade visual exclusiva e salva os arquivos no GitHub. Aqui você encontra o link compartilhável e a versão para PDF.</p></div><span class="tag">Sem API de IA adicional</span></div></div>'+
 '<div class="between" style="margin:25px 0 12px"><h3 style="font-size:15px;margin:0">Propostas publicadas</h3><span class="tag">Visualização pública apenas após publicação</span></div>'+
 '<div id="studio-list" class="studio-projects"><div class="panel empty">Buscando propostas salvas...</div></div>'+
 '<p class="subtle" style="margin-top:19px;font-size:11px;line-height:1.7">Esta área publica somente páginas autorizadas no repositório. Não inclua dados confidenciais de clientes. Os formulários e CTAs nas prévias são ilustrativos; a exportação PDF abre a opção “Salvar como PDF” do navegador.</p>';
}
async function loadStudio(){
 const target=document.getElementById('studio-list');if(!target)return;
 try{
  const response=await fetch('/studio/projects.json',{cache:'no-store'});
  if(!response.ok)throw Error('Catálogo de propostas indisponível');
  const data=await response.json();if(page!=='studio')return;
  const projects=Array.isArray(data.projects)?data.projects.filter(p=>/^[a-z0-9-]{2,80}$/.test(String(p.slug))):[];
  if(!projects.length){target.innerHTML='<div class="panel empty"><strong>Nenhuma proposta publicada</strong><p>Envie o primeiro Instagram nesta conversa para começarmos.</p></div>';return;}
  target.innerHTML=projects.map(p=>{
   const link='/studio/sites/'+encodeURIComponent(p.slug)+'.html';
   const image=p.cover&&/^https:\/\/images\.unsplash\.com\//.test(p.cover)?'<img src="'+esc(p.cover)+'" alt="" loading="lazy">':'<div class="studio-no-cover">CONCECOM / SITE STUDIO</div>';
   return '<article class="studio-project"><a href="'+link+'" target="_blank" rel="noopener noreferrer" class="studio-cover">'+image+'<span class="studio-demo">'+esc(p.status==='DEMO'?'Exemplo fictício':'Proposta visual')+'</span></a><div class="studio-meta"><span>'+esc(p.category||'Landing page')+'</span><span>'+esc(p.location||'')+'</span></div><h3>'+esc(p.name||'Projeto sem nome')+'</h3><p>'+esc(p.description||'Proposta visual personalizada')+'</p><div class="studio-actions"><a class="btn small" target="_blank" rel="noopener noreferrer" href="'+link+'">Ver landing page ↗</a><a class="btn small secondary" target="_blank" rel="noopener noreferrer" href="'+link+'?print=1">Exportar PDF ↗</a><button class="btn small secondary" data-action="studio-whatsapp" data-slug="'+esc(p.slug)+'">WhatsApp ↗</button></div></article>';
  }).join('');
 }catch(e){target.innerHTML='<div class="panel empty"><strong>Não foi possível consultar o catálogo.</strong><p>'+esc(e.message)+'</p></div>';}
}

function discovery(){
 const providers=state.providers||[];
 const local=state.localDiscovery||{cities:['Sorocaba','Votorantim','Campinas'],segments:[{id:'dentista',label:'Dentistas'}]};
 return '<div class="section-head"><h2>Descoberta de empresas</h2><p>Encontre empresas locais com dados públicos e qualifique as oportunidades sem depender de serviços pagos.</p></div>'+
 '<div class="cards"><section class="panel"><h3>Buscar empresas locais · OpenStreetMap</h3><p class="subtle">Consulta real a empresas cadastradas publicamente, sem chave de API. Os resultados entram no Kanban para revisão.</p>'+
 '<div class="two"><div class="field"><label>Cidade</label><select id="local-city">'+local.cities.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('')+'</select></div>'+
 '<div class="field"><label>Segmento</label><select id="local-segment">'+local.segments.map(o=>'<option value="'+esc(o.id)+'">'+esc(o.label)+'</option>').join('')+'</select></div></div>'+
 '<div class="actionsrow"><button class="btn" data-action="discover-osm">Pesquisar empresas</button><span class="tag green">Sem chave de API</span></div>'+
 '<p class="subtle" style="line-height:1.6;font-size:12px;margin-top:15px">A consulta pode levar até 40 segundos. Apenas informações publicadas na fonte são importadas; não presume que uma empresa não possui site ou autorizou mensagens.</p>'+
 '<p class="subtle" style="font-size:11px"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors · ODbL</a></p></section>'+
 '<section class="panel"><h3>Últimas pesquisas</h3>'+(state.discoveries.length?state.discoveries.slice(0,7).map(d=>'<div class="activity"><span class="dotmini">⌕</span><div><strong>'+esc(d.query)+'</strong><small>'+d.found+' novo(s) · '+fmtDate(d.at)+' · '+esc(d.status)+'</small></div></div>').join(''):'<div class="empty">Nenhuma pesquisa registrada.</div>')+'</section></div>'+
 '<details class="simple-discovery-extra"><summary>Outras fontes e importações <span aria-hidden="true">⌄</span></summary>'+ 
 '<section class="panel" style="margin-top:18px"><div class="between"><h3>Busca web complementar (Brave)</h3><span class="tag">'+(state.searchConfigured?'Configurada':'Opcional')+'</span></div>'+
 '<div class="two"><div class="field"><label>Consulta livre</label><input id="discover-query" placeholder="Ex.: psicóloga Sorocaba ou clínica Campinas"></div><button class="btn secondary" data-action="discover" '+(!state.searchConfigured?'disabled':'')+'>Pesquisar perfis indexados</button></div>'+
 '<p class="subtle">Brave requer chave válida do provedor. Bibliotecas no GitHub não fornecem chaves de serviços externos.</p></section>'+
 '<section class="panel" style="margin-top:18px"><div class="between"><h3>Diretórios empresariais complementares</h3><span class="tag">APIs oficiais</span></div><p class="subtle">Google Places e Foursquare oferecem informações adicionais de sites e empresas quando você configura suas próprias chaves na Railway. Podem existir custos e limitações de armazenamento. Resultados são exibidos para revisão e não são copiados automaticamente ao banco.</p><div class="two"><div class="field"><label>Fonte</label><select id="external-provider"><option value="google_places">Google Places</option><option value="foursquare">Foursquare Places</option></select></div><div class="field"><label>Segmento</label><input id="external-query" placeholder="Ex.: clínica odontológica"></div></div><div class="two"><div class="field"><label>Cidade</label><input id="external-city" value="Sorocaba"></div><button class="btn secondary" data-action="external-search">Pesquisar nesta fonte</button></div></section>'+
 '<section class="panel" style="margin-top:18px"><h3>Importar CNPJ / CNES · fontes oficiais</h3><p class="subtle">Use um arquivo CSV ou JSON obtido legitimamente na fonte original. O sistema registra a procedência, cruza duplicados e cria oportunidades sem permissão de contato. O download massivo dessas bases não é realizado pelo servidor.</p><div class="two"><div class="field"><label>Fonte</label><select id="official-source"><option value="cnpj">CNPJ / Receita Federal</option><option value="cnes">CNES / Ministério da Saúde</option></select></div><div class="field"><label>Arquivo (até 200 registros)</label><input type="file" id="official-file" accept=".csv,.json"></div></div><div class="actionsrow"><button class="btn secondary" data-action="import-official">Importar lote verificado</button><span class="tag">Sem envio de mensagens</span></div><small class="subtle">CSV com colunas cnpj ou cnes, nome_fantasia ou nome, municipio, telefone (opcional). CNES e CNPJ devem conter seus códigos completos.</small></section>'+
 '<section class="panel" style="margin-top:18px"><h3>Provedores de prospecção</h3>'+providers.map(p=>'<div class="activity"><span class="dotmini">⌕</span><div style="flex:1"><strong>'+esc(p.label)+'</strong><small>'+esc(p.note)+'</small></div><span class="tag '+(p.status==='READY'?'green':p.status==='NEEDS_API_KEY'?'yellow':'')+'">'+esc(p.status==='READY'?'Pronto':p.status==='NEEDS_API_KEY'?'Sem chave':p.status==='IMPORT_READY'?'Importação pronta':'Não integrado')+'</span></div>').join('')+'</section>'+
 '</details>'+ 
 '<section class="panel" style="margin-top:18px"><h3>Segurança das abordagens</h3><p class="subtle">Empresas descobertas entram com contato não autorizado. A plataforma não envia campanhas para números coletados sem permissão. Fonte pública não equivale a autorização para WhatsApp. Empresas sem tag de site continuam como site incerto.</p></section>';
}
function connections(){
 const c=state.connection||{},connected=c.status==='CONNECTED',waiting=c.status==='QR_READY',working=c.status==='CONNECTING';
 const fail=c.status==='LOGGED_OUT'||c.status==='ERROR',restarting=c.status==='RESTARTING',inProgress=working||waiting||restarting;
 const desc=connected?'Sessão autenticada e pronta para receber mensagens.':restarting?'Pareamento recebido. Concluindo a autenticação automaticamente — não gere outro QR.':waiting?'Escaneie o código com o WhatsApp do celular.':working?'Conectando ao servidor do WhatsApp…':fail?'A sessão anterior não foi aceita. Você pode iniciar um pareamento novo sem perder o backup.':'Clique em conectar para gerar seu QR Code.';
 return '<div class="connection-header"><div><span class="panel-eyebrow">CANAIS · INTEGRAÇÃO</span><h2>Seu WhatsApp, pronto para trabalhar.</h2><p>Conexão segura pelo aparelho. Uma sessão de cada vez, sem enviar mensagens automaticamente.</p></div><div class="connection-indicator '+(connected?'ok':waiting?'ready':'needs')+'"><span class="live-dot"></span>'+esc(connected?'Conectado':waiting?'Aguardando leitura':'Não conectado')+'</div></div>'+
 '<div class="connection-layout"><section class="panel wa-panel"><div class="wa-top"><div class="wa-logo">◎</div><div><h3>WhatsApp Business</h3><p>'+esc(desc)+'</p></div></div>'+
 (c.qr?'<div class="qr-frame"><img class="qr" src="'+esc(c.qr)+'" alt="QR Code para conectar WhatsApp"><span class="qr-caption">QR temporário · mantenha esta tela aberta</span></div>':'<div class="qr-placeholder"><span class="qr-placeholder-icon">'+(connected?'✓':inProgress?'◌':'▦')+'</span><strong>'+esc(connected?'Canal conectado':restarting?'Finalizando autenticação…':working?'Preparando QR Code':'QR Code indisponível')+'</strong><small>'+esc(connected?'Seu canal está ativo.':restarting?'Não desconecte nem gere outro QR.':working?'Pode levar alguns segundos.':'Gere um novo código para conectar o celular.')+'</small></div>')+
 (fail?'<div class="wa-error" role="alert"><strong>Conexão recusada pelo WhatsApp</strong><span>'+esc(c.error||'Sessão expirada')+(c.closeCode?' · código '+esc(c.closeCode):'')+'</span><small>O reparo guarda a autenticação anterior em backup e solicita um QR novo.</small></div>':'')+
 '<div class="wa-buttons"><button class="btn" data-action="'+(fail?'relink':'connect')+'" '+(connected||inProgress?'disabled':'')+'>'+esc(fail?'↻  Reparar e gerar novo QR':restarting?'Finalizando pareamento…':working?'Conectando…':waiting?'Aguardando leitura…':connected?'✓ Conectado':'◎  Conectar WhatsApp')+'</button>'+
 (connected||waiting||restarting?'<button class="btn secondary" data-action="disconnect">Desconectar</button>':'')+'</div>'+
 (c.lastEventAt?'<p class="helper-text">Última atualização: '+fmtDate(c.lastEventAt)+'</p>':'')+'</section>'+
 '<section class="connection-guide"><div class="panel"><div class="panel-eyebrow">COMECE AQUI</div><h3>Como conectar</h3><ol class="guide-steps"><li><span>01</span><div><strong>Abra o WhatsApp no celular</strong><small>Use o aparelho que administra o número.</small></div></li><li><span>02</span><div><strong>Entre em Aparelhos conectados</strong><small>Toque em “Conectar aparelho”.</small></div></li><li><span>03</span><div><strong>Leia o QR Code ao lado</strong><small>Aguarde o status mudar para “Conectado”.</small></div></li></ol></div>'+
 '<div class="panel"><div class="panel-eyebrow">OUTRAS INTEGRAÇÕES</div><h3>Descoberta comercial</h3><div class="status-line"><span>OpenStreetMap</span><strong class="text-good">Disponível</strong></div><div class="status-line"><span>Brave Search</span><strong>'+(state.searchConfigured?'Configurado':'Opcional')+'</strong></div><p class="helper-text">Pesquisar empresas é independente da conexão WhatsApp. Nenhuma fonte de dados concede permissão automática para envio de mensagens.</p><button class="btn secondary panel-action" data-action="route" data-to="discovery">Ver fontes →</button></div></section></div>';
}
function campaignPage(){
 const media=state.media||[],s=state.settings||{};
 const select=(kind)=>'<option value="">Selecione '+kind+'…</option>'+media.filter(x=>x.kind===kind).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');
 return '<div class="section-head"><h2>Campanha de site · R$350</h2><p>O funil começa apenas com contatos autorizados. O cliente responde, aguarda 60 segundos, recebe o áudio e depois o vídeo.</p></div>'+
 '<section class="panel"><h3>Montar campanha automática</h3><p class="subtle">Grave o áudio explicando a oferta de R$350 e a entrega em até três dias. Faça upload do áudio e do vídeo pela biblioteca na página Automações.</p>'+
 '<div class="two"><div class="field"><label>Áudio gravado da campanha</label><select id="offer-audio">'+select('audio')+'</select></div><div class="field"><label>Vídeo demonstrativo</label><select id="offer-video">'+select('video')+'</select></div></div>'+
 '<div class="field"><label>Primeira mensagem</label><textarea id="offer-intro" rows="3">Olá, {{business_name}}! Posso te apresentar uma proposta de criação de site da Consecom? Se não quiser receber mensagens, é só avisar.</textarea></div>'+
 '<div class="two"><div class="field"><label>Preço anunciado</label><input readonly value="R$ 350"></div><div class="field"><label>Data final real da promoção</label><input type="date" id="offer-expiry" value="'+esc(s.campaign_offer_expiry||'')+'"></div></div>'+
 '<label class="campaign-confirm"><input id="offer-confirm" type="checkbox"> Confirmo que preço, validade da promoção e entrega em até 3 dias são reais.</label>'+
 '<div class="actionsrow"><button class="btn" data-action="campaign-save">Salvar e definir fluxo padrão</button><button class="btn secondary" data-action="route" data-to="workflows">Abrir biblioteca de mídia ↗</button></div><p class="helper-text">Salvar não despausa envios. Promoções vencidas não iniciam novas abordagens. Recusas e opt-outs são respeitados.</p></section>'+
 '<section class="panel" style="margin-top:18px"><h3>Fluxo configurado</h3><div class="campaign-steps">① Mensagem inicial &nbsp; → &nbsp; ② Cliente responde &nbsp; → &nbsp; ③ Espera 60 s &nbsp; → &nbsp; ④ Áudio &nbsp; → &nbsp; ⑤ Vídeo &nbsp; → &nbsp; ⑥ Interesse → Kanban + aviso</div></section>';
}
function recontacts(){
 const rows=state.recontacts||[];
 return '<div class="section-head"><h2>Recontatos em 90 dias</h2><p>Um registro enxuto por telefone, com data da última abordagem e data elegível. Leads não precisam ser pesquisados novamente.</p></div>'+
 '<section class="panel"><h3>Disponíveis para revisão · '+rows.length+'</h3>'+
 (rows.length?rows.map(x=>'<div class="activity"><span class="dotmini">↺</span><div style="flex:1"><strong>'+esc(x.business)+'</strong><small>'+esc(x.phone)+' · Último contato '+fmtDate(x.last_contact_at)+'</small></div><button class="btn small secondary" data-action="recontact-open" data-lead="'+esc(x.lead_id)+'">Revisar →</button></div>').join(''):'<div class="empty">Nenhum lead elegível neste momento.</div>')+
 '<p class="helper-text">Somente contatos que continuam autorizados e não solicitaram interrupção. Cada recontato requer revisão e aprovação.</p></section>';
}
function settings(){
 const s=state.settings||{},providers=state.providers||[];
 const checked=x=>x?' checked':'';
 const toggle=(key,title,help)=>'<label class="simple-switch"><span><strong>'+title+'</strong><small>'+help+'</small></span><input type="checkbox" data-setting="'+key+'"'+checked(s[key])+'></label>';
 const num=(key,label,min,max,fallback)=>'<div class="field"><label>'+label+'</label><input type="number" min="'+min+'" max="'+max+'" data-setting-number="'+key+'" value="'+esc(s[key]??fallback)+'"></div>';
 return '<div class="simple-settings"><section class="panel"><span class="simple-kicker">CONTROLE</span><h2>Configurações essenciais</h2><p class="simple-intro">O básico para operar. Configurações técnicas ficam recolhidas abaixo.</p>'+
 toggle('paused','Operação pausada','Quando ligado, não são iniciadas novas abordagens.')+
 toggle('automation_enabled','Continuar respostas automaticamente','Avança a campanha após respostas reconhecidas.')+
 toggle('auto_initial','Iniciar campanha com contatos autorizados','Requer campanha selecionada e autorização registrada.')+
 toggle('discovery_auto_enabled','Buscar empresas automaticamente','Pesquisa progressiva, respeitando a meta e as cotas das fontes.')+
 '<h3 class="simple-subheading">Limites e horários</h3><div class="simple-fields-grid">'+
 num('daily_limit','Máximo de abordagens por dia',1,150,150)+
 num('discovery_target_daily','Meta de novas empresas por dia',1,150,150)+
 num('initial_interval_seconds','Intervalo entre abordagens (segundos)',144,3600,240)+
 num('business_start','Início (hora de Brasília)',0,23,8)+
 num('business_end','Término (hora de Brasília)',1,24,18)+'</div>'+
 '<div class="cm-actions"><button class="btn" data-action="save-settings">Salvar alterações</button></div></section>'+
 '<details class="panel simple-settings-extra"><summary>Locais e fontes de descoberta <span aria-hidden="true">⌄</span></summary><div class="simple-settings-inner">'+
 '<div class="simple-fields-grid"><div class="field"><label>Segmentos</label><textarea data-setting-text="segments">'+esc(s.segments||'')+'</textarea></div><div class="field"><label>Cidades</label><textarea data-setting-text="cities">'+esc(s.cities||'')+'</textarea></div></div>'+
 '<div class="field"><label>Prioridade</label><select id="discovery-priority">'+[['no_website','Empresas sem site confirmado'],['ads_only','Anunciantes (fonte opcional)'],['selected_segments','Segmentos selecionados']].map(([k,v])=>'<option value="'+k+'"'+(s.discovery_priority===k?' selected':'')+'>'+v+'</option>').join('')+'</select></div>'+
 '<label class="simple-switch"><span><strong>Permitir buscas no Brasil todo</strong><small>Depende da disponibilidade do provedor.</small></span><input id="discovery-brazil" type="checkbox"'+checked(s.discovery_brazil_wide)+'></label>'+
 '<h3>Fontes disponíveis</h3>'+providers.map(p=>'<label class="simple-switch"><span><strong>'+esc(p.label)+'</strong><small>'+esc(p.note||p.status)+'</small></span><input type="checkbox" data-source="'+esc(p.id)+'"'+checked((s.discovery_sources||{})[p.id]??['cnpj','cnes'].includes(p.id))+(p.status==='NOT_IMPLEMENTED'?' disabled':'')+'></label>').join('')+
 '</div></details>'+
 '<details class="panel simple-settings-extra"><summary>Notificações e critérios avançados <span aria-hidden="true">⌄</span></summary><div class="simple-settings-inner"><h3>Notificações no seu WhatsApp</h3><div class="simple-fields-grid"><div class="field"><label>Número A</label><input id="owner-a" value="'+esc(s.owner_phone_a||'')+'" placeholder="5515999999999"></div><div class="field"><label>Número B</label><input id="owner-b" value="'+esc(s.owner_phone_b||'')+'" placeholder="5515999999999"></div></div><label class="simple-switch"><span><strong>Ativar avisos</strong><small>Notificações e resumo diário, sem habilitar prospecção.</small></span><input id="owner-notices" type="checkbox"'+checked(s.owner_notifications_enabled)+'></label>'+
 '<h3>Pontuação de oportunidades</h3><div class="score-grid">'+Object.entries(s.score_weights||{}).map(([k,v])=>'<label class="score-weight"><span>'+esc(({noWebsite:'Sem site',activeAd:'Anúncio confirmado',publicWhatsapp:'WhatsApp comercial',activeBusiness:'Perfil comercial',prioritySegment:'Segmento prioritário',location:'Localização',businessName:'Nome comercial'})[k]||k)+'</span><input data-weight="'+k+'" type="number" min="0" max="30" value="'+Number(v)+'"></label>').join('')+'</div>'+
 '<p class="helper-text">Credenciais, leads e sessões continuam protegidos no servidor. Dados públicos não significam permissão de contato.</p></div></details></div>';
}
function modal(html){$('#modal').innerHTML='<div class="modal">'+html+'</div>';$('#modal').classList.remove('hidden');}
function closeModal(){$('#modal').classList.add('hidden');$('#modal').innerHTML='';}
function openLeadModal(lead=null){
 modal('<div class="between"><h2>'+(lead?'Detalhes da oportunidade':'Adicionar lead')+'</h2><button class="btn ghost small" data-action="close-modal">×</button></div>'+
 (lead?'<p class="tag">'+esc(labelStage[lead.stage]||lead.stage)+'</p><p>'+esc(lead.business)+'</p><p class="subtle">'+esc(lead.instagram?'@'+lead.instagram:'')+' · '+esc(lead.phone||'Sem WhatsApp')+'</p><p class="subtle">Site: '+esc(lead.website||'Não identificado')+' · '+esc(websiteLabel[lead.website_status]||lead.website_status)+'</p>'+
 '<p class="subtle">Origem: '+esc((lead.origins||[lead.source]).join(', '))+' · '+(lead.score??0)+' pontos</p>'+(lead.siteEvidence?'<p class="subtle">Verificação: '+esc(lead.siteEvidence.sources.join(', '))+' · confiança '+esc(lead.siteEvidence.confidence)+' · '+esc(lead.siteEvidence.note)+'</p>':'<p class="subtle">Sem revisão de site documentada. Falta de URL não é comprovação.</p>')+'<div class="field"><button class="btn small secondary" data-action="verify-site" data-lead="'+lead.id+'">Pesquisar possíveis sites ↗</button> <button class="btn small secondary" data-action="site-audit" data-lead="'+lead.id+'">Auditar site (PageSpeed)</button></div><div class="field"><label>Site identificado</label><input id="edit-website" value="'+esc(lead.website||'')+'"></div><div class="field"><label>Status do site</label><select id="edit-website-status">'+['UNCERTAIN','NOT_FOUND_AFTER_CHECK','NO_WEBSITE','HAS_WEBSITE','SOCIAL_ONLY','LINK_AGGREGATOR_ONLY','BROKEN_WEBSITE'].map(x=>'<option value="'+x+'" '+(x===lead.website_status?'selected':'')+'>'+esc(websiteLabel[x])+'</option>').join('')+'</select></div><div class="field"><label>Fontes consultadas (separadas por vírgula)</label><input id="site-review-sources" placeholder="OPENSTREETMAP, GOOGLE"><small>OPENSTREETMAP, BRAVE, GOOGLE, BING, REGISTRO_PUBLICO, DIRETORIO, REDES_SOCIAIS, CONTATO_DIRETO</small></div><div class="field"><label>Justificativa da verificação</label><textarea id="site-review-note" placeholder="Descreva o cruzamento de nome, cidade, telefone e domínios."></textarea></div><div class="switchrow"><label>Confirmo que revisei pessoalmente as fontes</label><input id="site-reviewed" type="checkbox"></div><div class="field"><label>WhatsApp</label><input id="edit-phone" value="'+esc(lead.phone||'')+'"></div><div class="field"><button class="btn small secondary" data-action="prod-offer" data-lead="'+lead.id+'">♫ Oferecer exemplo</button></div><div class="switchrow"><div><strong>Contato comercial autorizado</strong><small>Só marque se o destinatário autorizou mensagens da Consecom pelo WhatsApp.</small></div><input id="permission" type="checkbox" '+(lead.contact_permission?'checked':'')+'></div><div class="field"><label>Comprovação de consentimento</label><input id="permission-proof" placeholder="Ex.: autorizou pelo formulário de contato em DD/MM" value=""></div><div class="footer"><button class="btn secondary" data-action="close-modal">Fechar</button><button class="btn" data-action="save-permission" data-lead="'+lead.id+'">Salvar</button></div>':
 '<form id="lead-form"><div class="field"><label>Empresa ou profissional</label><input name="business" required placeholder="Clínica Souza"></div><div class="two"><div class="field"><label>Nome do contato</label><input name="name"></div><div class="field"><label>WhatsApp</label><input name="phone" placeholder="5515999999999"></div></div><div class="two"><div class="field"><label>Instagram</label><input name="instagram" placeholder="@clinicasouza"></div><div class="field"><label>Cidade</label><input name="city"></div></div><div class="field"><label>Site</label><input name="website" placeholder="https://..."></div><div class="field"><label>Presença de site</label><select name="website_status"><option value="UNCERTAIN">Ainda não verificado</option><option value="NO_WEBSITE">Sem site confirmado</option><option value="HAS_WEBSITE">Possui site</option></select></div><div class="switchrow"><label for="lead-permission">Canal de contato autorizado</label><input id="lead-permission" name="contact_permission" type="checkbox"></div><div class="field"><label>Comprovante de consentimento (se autorizado)</label><input name="permission_proof" placeholder="Como, quando e por qual canal a pessoa autorizou"></div><div class="footer"><button type="button" class="btn secondary" data-action="close-modal">Cancelar</button><button class="btn" type="submit">Salvar lead</button></div></form>'));
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
  if(action==='kanban-filter'){kanbanStage=el.dataset.stage||'ALL';draw();return;}
  if(action==='prod-open')return navigate('production',el.dataset.lead);
  if(action==='prod-copy'){await prodCopy(el.dataset.lead);return;}
  if(action==='prod-move'){await request('/api/production/move',{lead_id:el.dataset.lead,status:el.dataset.status,site_url:$('#prod-url')?.value});closeModal();await load();return;}
  if(action==='prod-accept'){await request('/api/production/accept',{lead_id:el.dataset.lead});closeModal();await load();return;}
  if(action==='prod-won'){await request('/api/production/close',{lead_id:el.dataset.lead});closeModal();await load();return;}
  if(action==='prod-confirm'){const x=state.production.find(v=>v.lead_id===el.dataset.lead);return modal('<h2>Aprovar envio real?</h2><p>Confira a prévia antes de autorizar sua entrega pelo WhatsApp.</p><p><a href="'+esc(x.site_url)+'" target="_blank" rel="noopener noreferrer">Visualizar ↗</a></p><button class="btn" data-action="prod-approve" data-lead="'+esc(x.lead_id)+'">Confirmar aprovação e enviar</button><button class="btn secondary" data-action="close-modal">Cancelar</button>');}
  if(action==='prod-approve'){await request('/api/production/approve',{lead_id:el.dataset.lead});closeModal();await load();showToast('Aprovado e enfileirado.');return;}
  if(action==='prod-offer'){const a=state.media.filter(x=>x.kind==='audio');return modal('<h2>Oferecer exemplo por áudio</h2><p class="subtle">Apenas contatos que já responderam e autorizaram a conversa.</p><select id="prod-audio">'+a.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('')+'</select><div class="footer"><button class="btn" '+(!a.length?'disabled':'')+' data-action="prod-offer-send" data-lead="'+esc(el.dataset.lead)+'">Enfileirar áudio</button><button class="btn secondary" data-action="close-modal">Cancelar</button></div>');}
  if(action==='prod-offer-send'){await request('/api/production/offer',{lead_id:el.dataset.lead,media_id:$('#prod-audio').value});closeModal();await load();return;}
  if(action==='studio-whatsapp'){const a=state.production?.find(x=>x.status==='READY'&&x.site_url?.endsWith('/'+el.dataset.slug+'.html'));if(a)return navigate('production',a.lead_id);navigate('production');showToast('Vincule a prévia a uma solicitação antes de enviar.');return;}
  if(action==='studio-copy'){const prompt='Crie uma landing page demonstrativa para esta empresa: [COLE AQUI O INSTAGRAM OU GOOGLE MAPS]. Faça uma pesquisa com fontes públicas, direção de arte individual, versão mobile e desktop, publique no Site Studio do Prospector e me entregue o link compartilhável e uma forma de exportar PDF. Sem backend funcional e sem inventar dados da empresa.';try{await navigator.clipboard.writeText(prompt);showToast('Pedido copiado! Cole no ChatGPT e substitua o link.');}catch{modal('<h2>Pedido para o ChatGPT</h2><textarea readonly style="min-height:160px">'+esc(prompt)+'</textarea><div class="footer"><button class="btn" data-action="close-modal">Fechar</button></div>');}return;}
  if(action==='close-modal')return closeModal();
  if(action==='new-lead')return openLeadModal();
  if(action==='review-lead')return openLeadModal(state.leads.find(l=>l.id===el.dataset.lead));
  if(action==='open-lead')return openLead(el.dataset.lead);
  if(action==='open-thread')return navigate('conversations',el.dataset.thread);
  if(action==='back-chat')return navigate('conversations');
  if(action==='takeover'){await request('/api/threads/'+el.dataset.thread+'/takeover',{value:el.dataset.value==='1'});await load();showToast('Modo de atendimento atualizado.');return;}
  if(action==='site-audit'){
   const r=await request('/api/leads/'+el.dataset.lead+'/site-audit',{});
   const vals=Object.entries(r.scores||{}).map(([key,v])=>'<div class="status-line"><span>'+esc(key)+'</span><strong>'+(v===null?'Indisponível':v+'/100')+'</strong></div>').join('');
   modal('<h2>Auditoria real de site · mobile</h2><p class="subtle">'+esc(r.website)+'</p>'+vals+'<p class="helper-text">Pontuações retornadas pelo Google PageSpeed Insights. Não alteram automaticamente a classificação do site.</p><div class="footer"><button class="btn" data-action="close-modal">Fechar</button></div>');return;
  }
  if(action==='verify-site'){const result=await request('/api/leads/'+el.dataset.lead+'/verify-site',{});modal('<h2>Possíveis sites da empresa</h2><p class="subtle">Confirme manualmente se pertencem ao mesmo negócio; ausência de resultados não comprova ausência de site.</p>'+(result.searchLinks?.length?'<div class="actionsrow">'+result.searchLinks.map(x=>'<a class="btn small secondary" href="'+esc(x.url)+'" target="_blank" rel="noopener noreferrer">Pesquisar no '+esc(x.label)+' ↗</a>').join('')+'</div>':'')+(result.candidates?.length?result.candidates.map(x=>'<div class="activity"><div style="flex:1"><strong>'+esc(x.title||x.domain)+'</strong><small>'+esc(x.domain)+'</small></div><a href="'+esc(x.url)+'" target="_blank" rel="noopener noreferrer">Abrir ↗</a></div>').join(''):'<div class="empty">Nenhum site identificado. Mantenha a classificação incerta.</div>')+'<div class="footer"><button class="btn" data-action="close-modal">Fechar</button></div>');return;}
  if(action==='save-permission'){await request('/api/leads/'+el.dataset.lead+'/update',{website:$('#edit-website').value,website_status:$('#edit-website-status').value,phone:$('#edit-phone').value,site_review_sources:$('#site-review-sources').value,site_review_note:$('#site-review-note').value,site_reviewed:$('#site-reviewed').checked});await request('/api/leads/'+el.dataset.lead+'/permission',{value:$('#permission').checked,proof:$('#permission-proof').value});closeModal();await load();showToast('Lead atualizado.');return;}
  if(action==='start-lead'){const lead=state.leads.find(x=>x.id===el.dataset.lead);if(!lead)return;
    const automationOptions=(state.workflows||[]).filter(w=>w.enabled!==false);
    modal('<h2>Iniciar automação</h2><p class="subtle">Empresa: <strong>'+esc(lead.business)+'</strong> · Segmento: '+esc(lead.segment||'Não informado')+'</p><p class="subtle">Selecione o fluxo indicado para o cliente. A primeira abordagem só será enviada quando houver permissão e sessão conectada.</p><div class="field"><label>Automação</label><select id="lead-automation"><option value="">Selecionar automaticamente pelo segmento</option>'+automationOptions.map(w=>'<option value="'+esc(w.id)+'">'+esc(w.name)+' • '+esc((w.segments||[]).join(', ')||'Geral')+'</option>').join('')+'</select></div><div class="footer"><button class="btn secondary" data-action="close-modal">Cancelar</button><button class="btn" data-action="start-lead-confirm" data-lead="'+esc(lead.id)+'">Iniciar automação</button></div>');return;}
  if(action==='start-lead-confirm'){await request('/api/workflows/start/'+el.dataset.lead,{workflow_id:$('#lead-automation')?.value||null});closeModal();showToast('Automação iniciada.');await load();return;}
  if(action==='connect'){await request('/api/connect',{});await load();showToast('Solicitação de conexão enviada. Aguarde o QR.');return;}
  if(action==='relink'){
   if(!window.confirm('Iniciar uma sessão WhatsApp nova? As credenciais atuais serão guardadas em backup no servidor.'))return;
   await request('/api/connect',{fresh:true});await load();showToast('Repareamento iniciado. Aguarde o QR Code.');return;
  }
  if(action==='disconnect'){await request('/api/disconnect',{});await load();return;}
  if(action==='new-workflow'){workflowId='new';editing={id:null,name:'Nova automação · Oferta de site',version:1,segments:[],enabled:true,steps:[
 {id:crypto.randomUUID(),type:'message',text:'Olá, {{business_name}}! Vi o seu trabalho e queria apresentar uma ideia para sua presença digital. Posso enviar uma prévia visual de como poderia ficar seu site?'},
 {id:crypto.randomUUID(),type:'wait_reply'},
 {id:crypto.randomUUID(),type:'decision',context:'sample_offer',context_description:'Perguntei ao cliente se deseja receber um exemplo visual do site.',yes_type:'message',yes_text:'Ótimo! Vou preparar um exemplo visual. A meta é te apresentar em cerca de 10 minutos e te aviso quando estiver pronto.',yes_action:'request_sample',no_type:'message',no_text:'Tudo bem! Agradeço seu retorno. Se precisar futuramente, fico à disposição.',no_action:'end'},
 {id:crypto.randomUUID(),type:'end'}]};dirty=true;draw();return;}
  if(action==='media-tab'){mediaTab=el.dataset.kind;draw();return;}
  if(action==='add-step'){const a=getCurrentWorkflow();a.steps.splice(a.steps.length-1,0,{id:crypto.randomUUID(),type:el.dataset.type,text:el.dataset.type==='message'?'Olá, {{business_name}}! Tudo bem?':undefined,seconds:10,...(el.dataset.type==='decision'?{context:'sample_offer',context_description:'Perguntei se a pessoa quer ver uma prévia do site',yes_type:'message',yes_text:'Perfeito! Vou preparar um exemplo visual para você.',yes_action:'request_sample',no_type:'message',no_text:'Sem problemas. Obrigado pelo retorno!',no_action:'end'}:{})});dirty=true;draw();return;}
  if(action.startsWith('step-')){
   const wf=getCurrentWorkflow(),steps=wf.steps,i=Number(el.dataset.index);
   if(action==='step-delete')steps.splice(i,1);
   if(action==='step-up'&&i>0)[steps[i-1],steps[i]]=[steps[i],steps[i-1]];
   if(action==='step-down'&&i<steps.length-2)[steps[i],steps[i+1]]=[steps[i+1],steps[i]];
   dirty=true;draw();return;
  }
  if(action==='decision-test'){const i=Number(el.dataset.index),wf=getCurrentWorkflow(),v=$('#test-reply-'+i)?.value||'';const r=await request('/api/automations/test',{text:v,context:wf.steps[i].context});showToast(r.decision==='YES'?'SIM — seguir caminho de aceite':r.decision==='NO'?'NÃO — seguir caminho de recusa':'INDEFINIDO — revisão humana');return;}
  if(action==='campaign-save'){
    const r=await request('/api/campaign/configure',{audio_id:$('#offer-audio').value,video_id:$('#offer-video').value,intro:$('#offer-intro').value,price:350,expires_on:$('#offer-expiry').value,confirm_offer:$('#offer-confirm').checked});
    editing=null;workflowId=r.workflowId;dirty=false;await load();showToast('Campanha salva. Prospecção permanece pausada até autorização.');return;
  }
  if(action==='recontact-open'){
    const lead=(state.recontacts||[]).find(x=>x.lead_id===el.dataset.lead);if(!lead)return;
    modal('<h2>Recontato de 90 dias</h2><p>Verifique se o consentimento de '+esc(lead.business)+' continua válido.</p><textarea rows="4" id="recontact-message">Olá! Já conversamos sobre a possibilidade de criar um site para sua empresa. Gostaria de saber se ainda faz sentido conversarmos. Caso prefira, não enviaremos novas mensagens.</textarea><div class="footer"><button class="btn secondary" data-action="close-modal">Cancelar</button><button class="btn" data-action="recontact-send" data-lead="'+esc(lead.lead_id)+'">Aprovar mensagem</button></div>');return;
  }
  if(action==='recontact-send'){
    await request('/api/recontacts/approve',{lead_id:el.dataset.lead,text:$('#recontact-message').value});closeModal();await load();showToast('Recontato enfileirado após aprovação.');return;
  }
  if(action==='save-workflow'){const wf=getCurrentWorkflow();const r=await request('/api/workflows',{id:wf.id||undefined,name:wf.name,steps:wf.steps,segments:wf.segments||[],enabled:wf.enabled!==false});editing=null;workflowId=r.id;dirty=false;await load();showToast('Automação salva e versionada.');return;}
  if(action==='default-workflow'){await request('/api/workflows/default',{id:getCurrentWorkflow().id});await load();showToast('Automação padrão atualizada.');return;}
  if(action==='save-settings'){
   const data={};document.querySelectorAll('[data-setting]').forEach(x=>data[x.dataset.setting]=x.checked);
   document.querySelectorAll('[data-setting-number]').forEach(x=>data[x.dataset.settingNumber]=Number(x.value));
   document.querySelectorAll('[data-setting-text]').forEach(x=>data[x.dataset.settingText]=x.value);
   data.owner_phone_a=$('#owner-a')?.value||'';data.owner_phone_b=$('#owner-b')?.value||'';data.owner_notifications_enabled=!!$('#owner-notices')?.checked;data.owner_report_hour=20;
   data.discovery_sources={...(state.settings.discovery_sources||{})};document.querySelectorAll('[data-source]').forEach(x=>data.discovery_sources[x.dataset.source]=x.checked);
   data.discovery_priority=$('#discovery-priority').value;data.discovery_brazil_wide=$('#discovery-brazil').checked;
   data.score_weights={};document.querySelectorAll('[data-weight]').forEach(x=>data.score_weights[x.dataset.weight]=Number(x.value));
   await request('/api/settings',data);await load();showToast('Configurações salvas.');return;
  }
  if(action==='external-search'){
    el.disabled=true;
    try{
     const result=await request('/api/research/external',{provider:$('#external-provider').value,query:$('#external-query').value,city:$('#external-city').value});
     const html=result.results.length?result.results.map(x=>'<div class="activity"><span class="dotmini">⌕</span><div style="flex:1"><strong>'+esc(x.name)+'</strong><small>'+esc(x.address||'')+'</small><small>'+esc(x.website||'Site não informado no provedor (não comprovado)')+'</small></div>'+(x.website?'<a target="_blank" rel="noopener noreferrer" href="'+esc(x.website)+'">Site ↗</a>':'')+'</div>').join(''):'<div class="empty">Nenhum registro retornado por esta fonte.</div>';
     modal('<h2>Pesquisa em '+esc(result.source)+'</h2><p class="subtle">Resultados para revisão, não importados automaticamente. Confirme os termos do provedor e o site da empresa.</p>'+html+'<div class="footer"><button class="btn secondary" data-action="close-modal">Fechar</button></div>');
    }finally{el.disabled=false;}return;
  }
  if(action==='import-official'){
    const file=$('#official-file')?.files?.[0];if(!file)throw Error('Selecione um CSV ou JSON oficial');
    if(file.size>800000)throw Error('Máximo de 800 KB por arquivo');
    const source=$('#official-source').value;const text=await file.text();
    let payload={source,csv:text};if(file.name.toLowerCase().endsWith('.json')){const parsed=JSON.parse(text);payload={source,records:Array.isArray(parsed)?parsed:parsed.records};}
    el.disabled=true;try{const r=await request('/api/discover/official',payload);await load();showToast(r.added+' adicionados · '+r.duplicates+' duplicados · '+r.invalid+' inválidos');}finally{el.disabled=false;}
    return;
  }
  if(action==='discover-osm'){const city=$('#local-city').value,segment=$('#local-segment').value;el.disabled=true;try{const r=await request('/api/discover/osm',{city,segment});showToast(r.cached?'Consulta recente em cache.':r.added+' empresa(s) adicionada(s) de '+r.examined+' analisada(s).');await load();}finally{el.disabled=false;}return;}
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
$('#sidebar-toggle')?.addEventListener('click',()=>document.body.classList.toggle('nav-expanded'));
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'){$('#modal')?.classList.add('hidden');document.body.classList.remove('nav-expanded');}
 if(event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){
  event.preventDefault();if(page!=='prospects')navigate('prospects');
  const field=$('#kanban-search');field?.focus();
 }
});
document.querySelectorAll('[data-route]').forEach(b=>b.addEventListener('click',()=>document.body.classList.remove('nav-expanded')));
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
