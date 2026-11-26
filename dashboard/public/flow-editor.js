const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kinds={text:'Mensagem de texto',audio:'Áudio',video:'Vídeo',image:'Imagem',document:'Documento',reply:'Aguardar resposta',delay:'Tempo de espera',condition:'Condição',ai:'Atendimento por IA',handoff:'Atendimento humano'};
const isMessage=k=>['text','audio','video','image','document'].includes(k);
const icons={folder:'<path d="M3 7V5h7l2 3h9v12H3z"/>',text:'<path d="M4 4h16v13H9l-5 4zM8 9h8M8 13h6"/>',audio:'<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3"/>',video:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>',image:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',document:'<path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h8"/>',reply:'<path d="M20 16H9l-5 4V4h16zM8 9h8M8 13h6"/>',delay:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',condition:'<path d="M12 3v5M5 21v-5l7-8 7 8v5"/><circle cx="12" cy="3" r="2"/>',ai:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',handoff:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3"/>',copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 4H4v12"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',plus:'<path d="M12 5v14M5 12h14"/>'};
const icon=k=>'<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+(icons[k]||icons.folder)+'</svg>';
let root,api,projects=[],current=null,selected=null,query='',loading=false,loaded=false,error='',dirty=false,zoom=1,simulating=false,simulationLead=1,busy=false,projectDialog=null,simulationRun=null;
const uid=()=>crypto.randomUUID();
const btn=(action,label,extra='')=>'<button type="button" data-flow="'+action+'" '+extra+'>'+label+'</button>';
const readonly=()=>!!current?.protected;
const step=()=>current?.definition.steps.find(s=>s.id===selected?.step);
const variant=()=>step()?.variants.find(v=>v.id===selected?.variant);
const date=v=>v?new Date(v).toLocaleDateString('pt-BR'):'Motor existente';
function library(){
 const filtered=projects.filter(p=>(p.name+' '+p.niche+' '+p.description).toLowerCase().includes(query.toLowerCase()));
 return '<div class="pf-library"><div class="pf-heading"><div><span class="pf-overline">WORKSPACE / FLUXOS</span><h2>Seus projetos</h2><p>Organize abordagens e estratégias por nicho em um só lugar.</p></div>'+btn('new',icon('plus')+' Novo projeto','class="pf-primary"')+'</div><div class="pf-library-toolbar"><div class="pf-search">'+icon('search')+'<input data-field="search" placeholder="Buscar projetos ou nichos" value="'+esc(query)+'"></div><span>'+filtered.length+' projeto(s)</span></div><div class="pf-project-grid">'+filtered.map(p=>'<article class="pf-project"><button data-flow="open" data-id="'+esc(p.id)+'" class="pf-project-open"><span class="pf-folder">'+icon('folder')+'</span><span class="pf-project-title">'+esc(p.name)+'</span><span class="pf-niche">'+esc(p.niche||'Sem nicho definido')+'</span><span class="pf-description">'+esc(p.description||'Configure seu fluxo de prospecção.')+'</span></button><div class="pf-project-footer"><span class="pf-chip '+(p.protected?'pf-protected':'')+'">'+(p.protected?'Protegido':p.publishedVersion?'Versão '+p.publishedVersion:'Rascunho')+'</span><small>'+p.definition.steps.length+' etapas</small>'+(!p.protected?btn('duplicate',icon('copy'),'data-id="'+esc(p.id)+'" title="Duplicar projeto" aria-label="Duplicar projeto" class="pf-icon"'):'')+'</div></article>').join('')+(filtered.length?'':'<div class="pf-empty">Nenhum projeto encontrado.</div>')+'</div></div>';
}
function node(s,i){
 const count=s.variants.length,total=s.variants.reduce((n,v)=>n+v.weight,0);
 const attrs='data-step="'+esc(s.id)+'"';
 return '<div class="pf-column"><div class="pf-stage-label">'+String(i+1).padStart(2,'0')+' / '+esc(s.name)+'</div><div class="pf-nodes">'+(isMessage(s.kind)?s.variants.map((v,j)=>'<button class="pf-node '+(selected?.variant===v.id?'pf-selected':'')+'" data-flow="select" '+attrs+' data-variant="'+esc(v.id)+'"><span class="pf-node-head"><span class="pf-node-icon">'+icon(s.kind)+'</span><strong>'+(count>1?'Variante '+(j<26?String.fromCharCode(65+j):j+1):esc(kinds[s.kind]))+'</strong><small>'+Math.round(v.weight/total*100)+'%</small></span><span class="pf-node-text">'+esc(v.text||'Clique para configurar')+'</span><span class="pf-node-foot">'+esc(kinds[s.kind])+'</span></button>').join(''):'<button class="pf-node '+(selected?.step===s.id?'pf-selected':'')+'" data-flow="select" '+attrs+'><span class="pf-node-head"><span class="pf-node-icon pf-wait">'+icon(s.kind)+'</span><strong>'+esc(kinds[s.kind])+'</strong></span><span class="pf-node-text">'+esc(s.kind==='delay'?s.seconds+' segundos':s.name)+'</span><span class="pf-node-foot">Gatilho / controle</span></button>')+(!readonly()&&isMessage(s.kind)?btn('variant', '+ Adicionar variante',attrs+' class="pf-add-variant"'):'')+'</div></div>';
}
function panel(){
 const s=step(),v=variant(),disabled=readonly()?' disabled':'';
 if(!s)return '<aside class="pf-inspector"><h3>Configurações do projeto</h3><label>Nome<input data-field="name" value="'+esc(current.name)+'"'+disabled+'></label><label>Nicho<input data-field="niche" value="'+esc(current.niche)+'" placeholder="Ex.: Espaços de eventos"'+disabled+'></label><label>Descrição<textarea data-field="description" rows="4"'+disabled+'>'+esc(current.description)+'</textarea></label><p>O nicho identifica a estratégia deste projeto. O editor não altera as campanhas atuais.</p>'+(readonly()?'<p>Limite atual: '+esc(current.settings.dailyLimit)+' por dia.<br>Janela: '+esc(current.settings.window)+'</p>':'')+'</aside>';
 return '<aside class="pf-inspector"><div class="pf-inspector-head"><h3>'+esc(kinds[s.kind])+'</h3>'+btn('deselect','×','class="pf-icon" aria-label="Fechar edição"')+'</div><label>Nome da etapa<input data-field="stepName" value="'+esc(s.name)+'"'+disabled+'></label>'+(v?'<label>'+(s.kind==='text'?'Mensagem':'Descrição / legenda da mídia')+'<textarea data-field="text" rows="6"'+disabled+'>'+esc(v.text)+'</textarea></label>'+(!readonly()?'<div class="pf-vars">'+['nome','empresa','cidade','segmento'].map(x=>btn('variable','+ '+x,'data-value="'+x+'"')).join('')+'</div>':'')+'<label>Peso da variante<input type="number" min="1" max="10000" data-field="weight" value="'+v.weight+'"'+disabled+'></label><div class="pf-preview"><small>PRÉVIA</small><div>'+esc(v.text.replaceAll('{{nome}}','Carlos').replaceAll('{{empresa}}','Empresa Exemplo').replaceAll('{{cidade}}','Sorocaba'))+'</div></div>':s.kind==='delay'?'<label>Espera em segundos<input type="number" min="0" max="604800" data-field="seconds" value="'+s.seconds+'"'+disabled+'></label>':s.kind==='condition'?'<label>Condição<select data-field="condition"'+disabled+'>'+['reply','permission','interest'].map(k=>'<option value="'+k+'" '+(s.condition===k?'selected':'')+'>'+({reply:'Resposta',permission:'Autorização',interest:'Interesse'}[k])+'</option>').join('')+'</select></label>':'')+(!readonly()?'<div class="pf-inspector-actions">'+btn('left','← Mover')+btn('right','Mover →')+(v&&s.variants.length>1?btn('remove-variant','Remover variante'):'')+btn('remove-step','Remover etapa','class="pf-danger"')+'</div>':'')+'</aside>';
}
function simulatedVariant(s){
 const vars=s.variants||[],total=vars.reduce((sum,v)=>sum+Math.max(1,Number(v.weight)||1),0);
 if(!total)return null;
 const weights=vars.map(v=>Math.max(1,Number(v.weight)||1));
 if(weights.every(w=>w===weights[0]))return vars[(simulationLead-1)%vars.length];
 let cursor=(simulationLead-1)%total;
 for(let i=0;i<vars.length;i++){if(cursor<weights[i])return vars[i];cursor-=weights[i];}
 return vars[0];
}
function previewSimulation(){
 return '<div class="pf-sim"><div class="pf-sim-head"><strong>Simulação local</strong><span>Nenhuma mensagem enviada</span>'+btn('prev-sim','←')+'<b>Contato '+simulationLead+'</b>'+btn('next-sim','→')+btn('close-sim','Fechar')+'</div>'+current.definition.steps.map((s,i)=>{
 const v=simulatedVariant(s),idx=s.variants.indexOf(v),variantName=idx>=0?' · Variante '+(idx<26?String.fromCharCode(65+idx):idx+1):'';
 return '<p><b>'+String(i+1).padStart(2,'0')+' · '+esc(s.name)+esc(variantName)+'</b> — '+esc(isMessage(s.kind)?(v?.text||'Mensagem vazia'):s.kind==='delay'?s.seconds+' s':s.kind==='condition'?'Condição: '+({reply:'Resposta',permission:'Autorização',interest:'Interesse'}[s.condition]||'Resposta'):kinds[s.kind])+'</p>';
 }).join('')+'<small>Prévia de percurso afirmativo; condições e mensagens são apenas representadas, sem execução externa.</small></div>';
}
function simulation(){
 if(!simulationRun)return previewSimulation();
 const r=simulationRun,e=r.execution,s=r.definition.steps[e.cursor];
 const terminal=['COMPLETE','CANCELLED','HUMAN','REVIEW'].includes(e.state);
 const choices=e.state==='WAIT_REPLY'?['reply','permission','interest','automatic','refusal','optout','takeover']:terminal?[]:['next',...(['RESERVED','WAIT_PROOF'].includes(e.state)?['uncertain']:[]),'takeover'];
 const labels={next:'Avançar',reply:'Cliente respondeu',permission:'Autorizou',interest:'Demonstrou interesse',automatic:'Resposta automática',refusal:'Recusou',optout:'Não contatar',takeover:'Assumir conversa',uncertain:'Entrega incerta'};
 return '<div class="pf-sim"><div class="pf-sim-head"><strong>Simulação persistente</strong><span>Versão '+r.version+' · Sem envio real</span>'+btn('close-sim','Fechar')+'</div><p><b>'+esc(s?.name||'Fluxo encerrado')+'</b> · '+esc(e.state)+'</p>'+e.history.slice(-15).map(h=>'<p>'+esc(h.type)+' · '+esc(h.stepId||'')+(h.variantId?' · Variante '+esc(h.variantId):'')+'</p>').join('')+'<div class="pf-actions">'+choices.map(c=>btn('sim-event',labels[c],'data-choice="'+c+'"')).join('')+btn('restart-sim','Novo contato')+'</div></div>';
}
async function runSimulation(action,extra={}){
 const r=await api('/api/flow/simulation',{method:'POST',body:JSON.stringify({action,...extra})});
 simulationRun=r;simulating=true;paint();
}
function metricsPanel(){
 if(readonly()||!current.metrics)return '';
 const m=current.metrics;
 const items=[['Execuções',m.total],['Em andamento',m.inProgress],['Concluídas',m.completed],['Atendimento humano',m.human],['Canceladas',m.cancelled],['Em revisão',m.review]];
 const variants=(m.variants||[]).map(v=>{const step=current.definition.steps.find(s=>s.id===v.stepId),index=step?.variants.findIndex(x=>x.id===v.variantId)??-1;return '<p>'+esc('V'+v.version+' · '+(step?.name||v.stepId)+' · '+(index>=0?'Variante '+(index<26?String.fromCharCode(65+index):index+1):v.variantId))+' — '+esc(v.reservations)+' reserva(s)</p>';}).join('');
 return '<div class="pf-sim"><div class="pf-sim-head"><strong>Métricas reais do projeto</strong><span>'+esc(m.activeVersion===null?'Sem versão ativa':'Versão ativa '+m.activeVersion)+'</span>'+btn('refresh-metrics','Atualizar')+'</div><div class="pf-actions">'+items.map(([label,value])=>'<span class="pf-chip">'+esc(label)+': '+esc(value)+'</span>').join('')+'</div><p><small>As métricas consideram todas as versões. Reservas de variantes não equivalem a entregas confirmadas.</small></p>'+variants+'</div>';
}
function editor(){
 return '<div class="pf-editor"><div class="pf-edit-top"><div>'+btn('back','← Projetos','class="pf-back"')+'<h2>'+esc(current.name)+'</h2><span class="pf-niche">'+esc(current.niche||'Sem nicho')+'</span></div><div class="pf-actions"><span class="pf-chip">'+(readonly()?'Fluxo atual · protegido':dirty?'Alterações não salvas':'Salvo')+'</span>'+(!readonly()?btn('settings','Configurar projeto')+btn('save','Salvar')+btn('version','Salvar versão','class="pf-primary"'):'')+'</div></div><div class="pf-edit-toolbar"><span>Editor visual</span><span class="pf-toolbar-note">'+(readonly()?'Espelho somente leitura do fluxo existente':'Ambiente de edição e simulação · sem disparos reais')+'</span>'+btn('simulate','Simular')+(!readonly()?'<select data-field="addKind" aria-label="Tipo da nova etapa">'+Object.entries(kinds).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select>'+btn('add-step',icon('plus')+' Etapa','class="pf-primary"'):'')+'</div><div class="pf-workspace"><div class="pf-canvas"><div class="pf-track" style="zoom:'+zoom+'">'+current.definition.steps.map((s,i)=>node(s,i)).join('<div class="pf-wire"><span>›</span></div>')+'</div><div class="pf-zoom">'+btn('zoom-out','−')+'<span>'+Math.round(zoom*100)+'%</span>'+btn('zoom-in','+')+btn('fullscreen','⛶','title="Tela cheia"')+'</div></div>'+panel()+'</div>'+(simulating?simulation():'')+metricsPanel()+'</div>';
}
function projectDialogHtml(){
 if(!projectDialog)return '';
 return '<div class="pf-modal-backdrop"><form class="pf-modal" data-flow-form role="dialog" aria-modal="true" aria-labelledby="pf-modal-title"><div class="pf-modal-heading"><span class="pf-folder">'+icon('folder')+'</span><div><h3 id="pf-modal-title">'+(projectDialog.action==='duplicate'?'Duplicar projeto':'Criar projeto')+'</h3><p>Organize sua estratégia de prospecção.</p></div>'+btn('cancel-project','×','class="pf-icon" aria-label="Fechar"')+'</div><label>Nome do projeto<input name="name" maxlength="100" required placeholder="Ex.: Eventos e casamentos" value="'+esc(projectDialog.name||'')+'"></label><label>Nicho de atuação<input name="niche" maxlength="120" placeholder="Ex.: Espaços de eventos" value="'+esc(projectDialog.niche||'')+'"></label><label>Descrição<textarea name="description" rows="3" maxlength="500" placeholder="Objetivo deste fluxo">'+esc(projectDialog.description||'')+'</textarea></label><div class="pf-modal-actions">'+btn('cancel-project','Cancelar')+'<button type="submit" class="pf-primary">'+(projectDialog.action==='duplicate'?'Duplicar':'Criar projeto')+'</button></div></form></div>';
}
function paint(){
 if(!root)return;
 const canvas=root.querySelector('.pf-canvas'),x=canvas?.scrollLeft||0,y=canvas?.scrollTop||0;
 root.innerHTML=(error?'<div class="pf-error" role="alert">'+esc(error)+'</div>':'')+(loading?'<div class="pf-empty">Carregando projetos...</div>':current?editor():library())+projectDialogHtml();
 const next=root.querySelector('.pf-canvas');if(next){next.scrollLeft=x;next.scrollTop=y;}
}
async function refresh(){
 loading=true;paint();try{const r=await api('/api/flow/projects');projects=r.items||[];loaded=true;error='';}catch(e){error=e.message;}finally{loading=false;paint();}
}
async function mutate(action,payload){
 if(busy)return null;busy=true;error='';
 try{return await api('/api/flow/projects',{method:'POST',body:JSON.stringify({action,...payload})});}
 catch(e){error=e.message;paint();return null;}finally{busy=false;}
}
async function save(){
 if(readonly())return false;
 const result=await mutate('save',current);
 if(!result)return false;current=result;projects=projects.map(p=>p.id===result.id?result:p);dirty=false;paint();return true;
}
function change(){dirty=true;}
async function onClick(e){
 const b=e.target.closest('[data-flow]');if(!b||busy)return;
 const action=b.dataset.flow,s=step();
 if(action==='new'||action==='duplicate'){
  const prior=projects.find(p=>p.id===b.dataset.id);
  projectDialog={action,id:prior?.id,name:prior?prior.name+' (cópia)':'',niche:prior?.niche||'',description:prior?.description||''};
  paint();root.querySelector('[data-flow-form] input')?.focus();return;
 }
 if(action==='cancel-project'){projectDialog=null;paint();return;}
 if(action==='open'){current=structuredClone(projects.find(p=>p.id===b.dataset.id));selected=null;dirty=false;simulating=false;simulationRun=null;zoom=1;}
 else if(action==='refresh-metrics'){const r=await api('/api/flow/projects');const p=r.items?.find(p=>p.id===current.id);if(p){current.metrics=p.metrics;projects=projects.map(x=>x.id===p.id?{...x,metrics:p.metrics}:x);}paint();return;}
 else if(action==='back'){if(dirty&&!confirm('Sair sem salvar as alterações?'))return;current=null;selected=null;dirty=false;simulating=false;}
 else if(action==='select'){selected={step:b.dataset.step,variant:b.dataset.variant};}
 else if(action==='settings'||action==='deselect'){selected=null;}
 else if(action==='simulate'){simulationRun=null;simulating=true;simulationLead=1;if(!readonly()&&current.publishedVersion&&!dirty){await runSimulation('start',{projectId:current.id});return;}}
 else if(action==='restart-sim'){await runSimulation('start',{projectId:current.id});return;}
 else if(action==='sim-event'&&simulationRun){await runSimulation('advance',{id:simulationRun.id,revision:simulationRun.revision,choice:b.dataset.choice});return;}
 else if(action==='prev-sim'){simulationLead=Math.max(1,simulationLead-1);}
 else if(action==='next-sim'){simulationLead++;}
 else if(action==='close-sim'){simulating=false;}
 else if(action==='zoom-in'){zoom=Math.min(1.5,zoom+.1);}
 else if(action==='zoom-out'){zoom=Math.max(.5,zoom-.1);}
 else if(action==='fullscreen'){if(document.fullscreenElement)await document.exitFullscreen();else await root.requestFullscreen?.();return;}
 else if(!readonly()){
  if(action==='save'){await save();return;}
  if(action==='version'){if(dirty&&!await save())return;const result=await mutate('version',{id:current.id,revision:current.revision});if(result){current=result;projects=projects.map(p=>p.id===result.id?result:p);}paint();return;}
  if(action==='add-step'){const kind=root.querySelector('[data-field="addKind"]').value;const n={id:uid(),kind,name:kinds[kind],variants:isMessage(kind)?[{id:uid(),text:'',weight:1}]:[],...(kind==='delay'?{seconds:10}:{}),...(kind==='condition'?{condition:'reply'}:{})};current.definition.steps.push(n);selected={step:n.id,variant:n.variants[0]?.id};change();}
  if(action==='variant'){const target=current.definition.steps.find(x=>x.id===b.dataset.step),v={id:uid(),text:'',weight:1};target.variants.push(v);selected={step:target.id,variant:v.id};change();}
  if(action==='variable'&&variant()){variant().text+=' {{'+b.dataset.value+'}}';change();}
  if(action==='remove-variant'&&s){s.variants=s.variants.filter(v=>v.id!==selected.variant);selected.variant=s.variants[0]?.id;change();}
  if(action==='remove-step'&&s){if(!confirm('Remover esta etapa do rascunho?'))return;current.definition.steps=current.definition.steps.filter(x=>x.id!==s.id);selected=null;change();}
  if((action==='left'||action==='right')&&s){const a=current.definition.steps,i=a.indexOf(s),j=i+(action==='left'?-1:1);if(j>=0&&j<a.length){[a[i],a[j]]=[a[j],a[i]];change();}}
 }
 paint();
}
function onInput(e){
 if(projectDialog&&e.target.closest('[data-flow-form]')&&['name','niche','description'].includes(e.target.name)){projectDialog[e.target.name]=e.target.value;return;}
 const f=e.target.dataset.field;if(!f)return;
 if(f==='search'){query=e.target.value;const pos=e.target.selectionStart;paint();const input=root.querySelector('[data-field="search"]');input?.focus();input?.setSelectionRange(pos,pos);return;}
 if(!current||readonly()||f==='addKind')return;
 const v=e.target.value,s=step(),item=variant();
 if(['name','niche','description'].includes(f))current[f]=v;
 else if(f==='stepName'&&s)s.name=v;
 else if(f==='text'&&item)item.text=v;
 else if(f==='weight'&&item)item.weight=Number(v);
 else if(f==='seconds'&&s)s.seconds=Number(v);
 else if(f==='condition'&&s)s.condition=v;
 else return;
 change();
 const badge=root.querySelector('.pf-actions .pf-chip');if(badge)badge.textContent='Alterações não salvas';
 if(f==='text'&&item){const preview=root.querySelector('.pf-preview div');if(preview)preview.textContent=item.text.replaceAll('{{nome}}','Carlos').replaceAll('{{empresa}}','Empresa Exemplo').replaceAll('{{cidade}}','Sorocaba');}
}
async function submitProject(e){
 if(!e.target.matches('[data-flow-form]'))return;e.preventDefault();
 if(!projectDialog||busy)return;
 const result=await mutate(projectDialog.action,projectDialog);
 if(result){projects.unshift(result);current=structuredClone(result);selected=null;dirty=false;projectDialog=null;simulating=false;simulationRun=null;zoom=1;paint();}
}
export function mountProspectorFlow(host,request){
 api=request;
 if(!root){root=document.createElement('section');root.className='pf-root';root.addEventListener('click',e=>{void onClick(e).catch(err=>{error=err.message;paint();});});root.addEventListener('input',onInput);root.addEventListener('submit',e=>{void submitProject(e);});}
 host.append(root);if(!loaded&&!loading)void refresh();
}
