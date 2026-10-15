import {campaignStatus,campaignPreview} from './campaign-ui-state.mjs';
// Editor compacto. Os dados vêm do /api/state e a escolha de campanha só muda
// depois de uma validação atômica em /api/workflows/activate.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const root=()=>document.getElementById('campaign-app');
const uuid=()=>crypto.randomUUID();
const request=async(path,data)=>{
 const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'Não foi possível concluir a operação');
 return result;
};
let snapshot=null,selectedId=null,mode='view',draft=null,busy=false,notice='',showBridge=false;
const workflows=()=>snapshot?.workflows||[];
const selectedCampaign=()=>workflows().find(w=>w.id===selectedId)||null;
const activeCampaign=()=>workflows().find(w=>w.id===snapshot?.settings?.autonomous_campaign_id&&w.enabled)||null;
function freshDraft(){
 return {id:null,name:'Nova campanha de sites',enabled:false,segments:[],steps:[
  {id:uuid(),type:'message',text:'{{greeting}} A gente conheceu o trabalho de vocês e gostaríamos de apresentar uma proposta. Posso te enviar um áudio explicando tudo certinho?'},
  {id:uuid(),type:'wait_reply'},
  {id:uuid(),type:'delay',seconds:45},
  {id:uuid(),type:'audio',media_id:'',description:'Áudio de apresentação da proposta e condições da oferta.'},
  {id:uuid(),type:'delay',seconds:10},
  {id:uuid(),type:'video',media_id:'',caption:'O que achou? Gostaria de ter um assim também?'},
  {id:uuid(),type:'wait_reply'},
  {id:uuid(),type:'decision',context:'website_interest',context_description:'Após assistir ao vídeo, o destinatário confirma se deseja um site.',yes_type:'message',yes_text:'',yes_action:'handover',no_type:'message',no_text:'Sem problemas, muito obrigado pelo retorno, ficamos à disposição.',no_action:'end'},
  {id:uuid(),type:'end'}
 ]};
}
const previewRows=s=>{
 const p=campaignPreview(s);
 return '<div class="cm-steps-compact">'+[
  ['01','Abordagem',p.initial||'Não configurada'],
  ['02','Aguardar resposta','Permissão para continuar'],
  ['03','Apresentação',p.waitBeforeAudio+' segundos → áudio '+(p.hasAudio?'anexado':'pendente')],
  ['04','Portfólio',p.waitBeforeVideo+' segundos → vídeo '+(p.hasVideo?'anexado':'pendente')],
  ['05','Decisão','Interessados → atendimento humano · Recusa → despedida']
 ].map(x=>'<div class="cm-step-row"><span class="cm-step-index">'+x[0]+'</span><div><strong>'+esc(x[1])+'</strong><small>'+esc(x[2])+'</small></div></div>').join('')+'</div>';
};
function renderActive(){
 const active=activeCampaign(),id=active?.id;
 if(!active)return '<section class="cm-active cm-active-empty"><span class="cm-overline">CAMPANHA EM USO</span><h3>Nenhuma campanha selecionada</h3><p>Escolha uma campanha salva na esquerda e clique em <strong>Ativar campanha</strong>. Sem uma seleção válida, a operação não envia mensagens de campanha.</p></section>';
 const status=campaignStatus({workflow:active,activeId:id,settings:snapshot.settings,connection:snapshot.connection});
 const p=campaignPreview(active.steps);
 return '<section class="cm-active" aria-label="Campanha selecionada"><div class="cm-active-head"><div class="cm-active-icon">↗</div><span class="cm-overline">CAMPANHA SELECIONADA</span><span class="cm-state '+(status.running?'cm-green':'cm-muted')+'">'+(status.running?'● ':'')+esc(status.label)+'</span></div>'+
 '<h3>'+esc(active.name)+'</h3><p>Fluxo salvo e protegido contra alterações acidentais. '+(snapshot.settings.paused?'Os envios permanecem pausados.':'Somente contatos autorizados podem receber abordagens.')+'</p>'+
 '<div class="cm-mini-stats"><span>◷ Espera '+p.waitBeforeAudio+'s + '+p.waitBeforeVideo+'s</span><span>♫ Áudio '+(p.hasAudio?'pronto':'pendente')+'</span><span>▣ Vídeo '+(p.hasVideo?'pronto':'pendente')+'</span></div>'+
 '<details class="cm-disclosure"><summary>Ver etapas da campanha <span aria-hidden="true">⌄</span></summary>'+previewRows(active.steps)+'</details></section>';
}
function renderList(){
 const activeId=activeCampaign()?.id||null;
 const cards=workflows().filter(w=>w.id!=='default'||w.id===activeId).map(w=>{
  const status=campaignStatus({workflow:w,activeId,settings:snapshot.settings,connection:snapshot.connection});
  return '<button type="button" data-cm="select" data-id="'+esc(w.id)+'" class="cm-library-item '+(w.id===selectedId?'cm-selected':'')+'" aria-pressed="'+(w.id===selectedId?'true':'false')+'"><span class="cm-library-title">'+esc(w.name)+'</span><span class="cm-library-meta"><span class="cm-indicator '+(status.active?'cm-dot-active':'')+'"></span>'+esc(status.active?'Selecionada':status.label)+'</span></button>';
 }).join('');
 return '<aside class="cm-library"><div class="cm-library-head"><div><span class="cm-overline">BIBLIOTECA</span><h3>Suas campanhas</h3></div><span class="cm-count">'+workflows().filter(w=>w.id!=='default'||w.id===activeId).length+'</span></div><div class="cm-list">'+(cards||'<p class="cm-empty">Sua primeira campanha aparecerá aqui.</p>')+'</div>'+
 '<button type="button" data-cm="new" class="btn cm-new-btn">＋ Criar campanha</button><p class="cm-help">Selecione um card para visualizar ou ativar. A campanha em uso não pode ser editada.</p></aside>';
}
function renderDetail(){
 const chosen=selectedCampaign();
 if(!chosen)return '<section class="cm-detail cm-muted-panel"><span class="cm-overline">SELECIONE UMA CAMPANHA</span><h3>Escolha um card à esquerda</h3><p>Veja as etapas, ative outra campanha ou crie uma nova.</p></section>';
 const activeId=activeCampaign()?.id,status=campaignStatus({workflow:chosen,activeId,settings:snapshot.settings,connection:snapshot.connection});
 if(status.active)return '<section class="cm-detail cm-detail-small"><div class="cm-detail-icon">✓</div><div><strong>Esta é a campanha selecionada.</strong><p>Para trocar, escolha outro card na esquerda. Para alterar esse roteiro, crie uma cópia como nova campanha.</p><button class="btn secondary small" data-cm="duplicate" data-id="'+esc(chosen.id)+'">Criar uma cópia editável</button></div></section>';
 const p=campaignPreview(chosen.steps);
 return '<section class="cm-detail"><div class="cm-detail-head"><div><span class="cm-overline">CAMPANHA SALVA</span><h3>'+esc(chosen.name)+'</h3><p>Revise o resumo antes de selecionar esta campanha.</p></div><span class="cm-state">'+esc(status.label)+'</span></div>'+
 '<div class="cm-brief-grid"><span><strong>'+p.steps+'</strong> etapas</span><span><strong>'+p.waitBeforeAudio+'s</strong> antes do áudio</span><span><strong>'+p.waitBeforeVideo+'s</strong> antes do vídeo</span></div>'+
 '<details class="cm-disclosure" open><summary>Etapas configuradas <span aria-hidden="true">⌄</span></summary>'+previewRows(chosen.steps)+'</details>'+
 '<div class="cm-actions">'+(status.canActivate?'<button class="btn" data-cm="activate" data-id="'+esc(chosen.id)+'">✓ Ativar esta campanha</button>':'<span class="cm-warning">Para ativar, anexe áudio e vídeo.</span>')+
 (!chosen.enabled?'<button class="btn secondary" data-cm="edit" data-id="'+esc(chosen.id)+'">Editar rascunho</button>':'<button class="btn secondary" data-cm="duplicate" data-id="'+esc(chosen.id)+'">Duplicar para editar</button>')+'</div></section>';
}
const opt=(kind,value)=>'<option value="">Selecione '+(kind==='audio'?'um áudio':'um vídeo')+'</option>'+(snapshot.media||[]).filter(x=>x.kind===kind).map(x=>'<option value="'+esc(x.id)+'" '+(x.id===value?'selected':'')+'>'+esc(x.name)+'</option>').join('');
function renderEditor(){
 if(!draft)return '';
 const steps=draft.steps;
 const message=steps.find(x=>x.type==='message'),delays=steps.filter(x=>x.type==='delay'),audio=steps.find(x=>x.type==='audio'),video=steps.find(x=>x.type==='video'),decision=steps.find(x=>x.type==='decision');
 if(!message||delays.length<2||!audio||!video||!decision)return '<section class="cm-detail"><h3>Roteiro avançado</h3><p>Esta campanha usa um formato diferente. Faça uma cópia com o modelo simplificado.</p><button class="btn secondary" data-cm="cancel">Voltar</button></section>';
 return '<section class="cm-editor"><div class="cm-detail-head"><div><span class="cm-overline">EDITOR DE CAMPANHAS</span><h3>'+esc(draft.id?'Editar rascunho':'Criar campanha')+'</h3><p>Configure uma vez, salve e depois ative pelo card.</p></div><button class="btn secondary small" data-cm="cancel">Cancelar</button></div>'+
 '<div class="cm-field"><label for="cm-name">Nome da campanha</label><input id="cm-name" data-cm-field="name" value="'+esc(draft.name)+'" maxlength="100"></div>'+
 '<div class="cm-field"><label for="cm-message">1 · Mensagem inicial</label><textarea id="cm-message" data-cm-field="message" rows="3">'+esc(message.text)+'</textarea><small>O sistema substitui {{greeting}} pelo primeiro nome, quando disponível.</small></div>'+
 '<div class="cm-inline-fields"><div class="cm-field"><label for="cm-before">2 · Espera após a resposta (segundos)</label><input id="cm-before" data-cm-field="before" type="number" min="1" max="86400" value="'+Number(delays[0].seconds)+'"></div><div class="cm-field"><label for="cm-after">3 · Espera entre áudio e vídeo (segundos)</label><input id="cm-after" data-cm-field="after" type="number" min="1" max="86400" value="'+Number(delays[1].seconds)+'"></div></div>'+
 '<div class="cm-inline-fields"><div class="cm-field"><label for="cm-audio">4 · Áudio de apresentação</label><select id="cm-audio" data-cm-field="audio">'+opt('audio',audio.media_id)+'</select><label class="cm-upload-label">Enviar novo áudio<input data-cm-upload="audio" type="file" accept=".ogg,.opus,.mp3,.m4a,audio/*"></label></div>'+
 '<div class="cm-field"><label for="cm-video">5 · Vídeo da campanha</label><select id="cm-video" data-cm-field="video">'+opt('video',video.media_id)+'</select><label class="cm-upload-label">Enviar novo vídeo<input data-cm-upload="video" type="file" accept=".mp4,video/mp4"></label></div></div>'+
 '<div class="cm-field"><label for="cm-description">Descrição do áudio</label><textarea id="cm-description" data-cm-field="description" rows="2">'+esc(audio.description||'')+'</textarea></div>'+
 '<div class="cm-field"><label for="cm-caption">6 · Legenda do vídeo (sem adicionar som ao arquivo)</label><textarea id="cm-caption" data-cm-field="caption" rows="2">'+esc(video.caption||'')+'</textarea></div>'+
 '<div class="cm-field"><label for="cm-farewell">7 · Mensagem para quem não tem interesse</label><textarea id="cm-farewell" data-cm-field="farewell" rows="2">'+esc(decision.no_text||'')+'</textarea><small>Quem confirmar interesse vai direto ao Kanban. Respostas incertas precisam de revisão.</small></div>'+
 '<div class="cm-actions"><button type="button" class="btn" data-cm="save">Salvar campanha</button><button type="button" class="btn secondary" data-cm="cancel">Cancelar</button></div><p class="cm-help">Salvar cria um rascunho, sem iniciar envios. Depois, selecione o card para ativá-lo.</p></section>';
}
function renderBridge(){
 const bridge=snapshot?.bridge||{},state=bridge.state||'NOT_SYNCED';
 return '<details class="cm-advanced" '+(showBridge?'open':'')+'><summary>Ferramentas avançadas e importação <span aria-hidden="true">⌄</span></summary><div class="cm-advanced-body"><p>A ponte permite sincronizar uma campanha do GitHub; não inicia abordagens e mantém a permissão de contato obrigatória.</p><div class="cm-bridge-info"><span>Sincronização: <strong>'+esc(state)+'</strong></span><span>Áudio: '+(bridge.audio?.present?'disponível':'não verificado')+'</span><span>Vídeo: '+(bridge.video?.present?'disponível':'não verificado')+'</span></div><div class="cm-actions"><button class="btn secondary small" data-cm="bridge-sync">Sincronizar ponte de IA</button><label class="btn secondary small cm-zip-label">Importar ZIP<input data-cm-import type="file" accept=".zip,application/zip" hidden></label></div></div></details>';
}
function render(){
 const target=root();
 if(!target||!snapshot||!location.hash.startsWith('#/workflows')||location.hash.includes('/classic'))return;
 const active=activeCampaign();
 if(selectedId&&!workflows().some(x=>x.id===selectedId))selectedId=null;
 if(!selectedId&&mode!=='edit')selectedId=active?.id||workflows().find(x=>x.id!=='default')?.id||null;
 target.innerHTML='<div class="cm-page"><div class="cm-title"><div><span class="cm-overline">AUTOMAÇÕES</span><h2>Suas campanhas, em um só lugar.</h2><p>Uma campanha por vez. Crie, salve e selecione quando quiser mudar a operação.</p></div><span class="cm-count">'+workflows().filter(x=>x.id!=='default').length+' salva(s)</span></div>'+
 '<div class="cm-layout">'+renderList()+'<div class="cm-main">'+renderActive()+(mode==='edit'?renderEditor():renderDetail())+renderBridge()+'</div></div>'+
 (notice?'<div role="status" class="cm-notice">'+esc(notice)+'</div>':'')+'</div>';
}
function editField(field,value){
 if(!draft)return;
 const s=draft.steps;
 if(field==='name')draft.name=value;
 if(field==='message')s.find(x=>x.type==='message').text=value;
 if(field==='before')s.filter(x=>x.type==='delay')[0].seconds=Number(value);
 if(field==='after')s.filter(x=>x.type==='delay')[1].seconds=Number(value);
 if(field==='audio')s.find(x=>x.type==='audio').media_id=value;
 if(field==='video')s.find(x=>x.type==='video').media_id=value;
 if(field==='description')s.find(x=>x.type==='audio').description=value;
 if(field==='caption')s.find(x=>x.type==='video').caption=value;
 if(field==='farewell')s.find(x=>x.type==='decision').no_text=value;
}
async function refresh(){
 const r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)throw Error('Não foi possível atualizar o painel');
 snapshot=await r.json();render();
}
async function execute(action,button){
 if(busy)return;
 busy=true;
 try{
  if(action==='new'){draft=freshDraft();mode='edit';notice='';render();return;}
  if(action==='cancel'){draft=null;mode='view';notice='';render();return;}
  if(action==='select'){selectedId=button.dataset.id;mode='view';draft=null;notice='';render();return;}
  const chosen=workflows().find(w=>w.id===button.dataset.id);
  if(action==='duplicate'||action==='edit'){
   if(!chosen)throw Error('Campanha não encontrada');
   if(action==='edit'&&chosen.id===activeCampaign()?.id)throw Error('Duplique a campanha em uso para editá-la.');
   draft=structuredClone(chosen);if(action==='duplicate'){draft.id=null;draft.name='Cópia de '+draft.name;}
   draft.enabled=false;mode='edit';notice='';render();return;
  }
  if(action==='activate'){
   if(!chosen)throw Error('Selecione uma campanha válida');
   const res=await request('/api/workflows/activate',{id:chosen.id});
   selectedId=res.id;mode='view';draft=null;
   notice=res.paused?'Campanha selecionada! Os envios continuam pausados.':'Campanha selecionada para novos contatos autorizados.';
   await refresh();return;
  }
  if(action==='save'){
   if(!draft||!draft.name.trim())throw Error('Informe o nome da campanha');
   if(draft.name.trim().length>100)throw Error('Use um nome de até 100 caracteres.');
   const data={id:draft.id||undefined,name:draft.name.trim(),enabled:false,segments:draft.segments||[],steps:draft.steps};
   const result=await request('/api/workflows',data);
   selectedId=result.id;mode='view';draft=null;notice='Campanha salva como rascunho. Para usá-la, clique em Ativar campanha.';
   await refresh();return;
  }
  if(action==='bridge-sync'){
   notice='Sincronizando com o GitHub…';render();
   const out=await request('/api/agent-bridge/sync',{});
   notice=out.message||'Sincronização solicitada.';await refresh();return;
  }
 }catch(error){notice=error.message;render();}finally{busy=false;}
}
document.addEventListener('click',e=>{
 if(!e.target.closest('#campaign-app'))return;
 const b=e.target.closest('[data-cm]');
 if(b){e.preventDefault();execute(b.dataset.cm,b);}
});
document.addEventListener('input',e=>{
 if(!e.target.closest('#campaign-app'))return;
 const node=e.target.closest('[data-cm-field]');
 if(node)editField(node.dataset.cmField,node.value);
});
document.addEventListener('change',async e=>{
 if(!e.target.closest('#campaign-app'))return;
 const field=e.target.closest('[data-cm-field]');
 if(field)editField(field.dataset.cmField,field.value);
 const upload=e.target.closest('[data-cm-upload]');
 const importing=e.target.closest('[data-cm-import]');
 if(!upload&&!importing)return;
 const file=e.target.files?.[0];if(!file)return;
 try{
  if(busy)return;busy=true;
  if(importing){
   if(!file.name.toLowerCase().endsWith('.zip')||file.size>38*1024*1024)throw Error('Use um pacote ZIP de até 38 MB');
   const r=await fetch('/api/campaign/import-package',{method:'POST',headers:{'Content-Type':'application/zip'},body:file});
   const x=await r.json();if(!r.ok)throw Error(x.error||'Pacote inválido');
   selectedId=x.workflowId;mode='view';draft=null;notice='Pacote importado. Campanha disponível na biblioteca.';
  }else{
   const type=upload.dataset.cmUpload;
   if(type==='video'&&!file.name.toLowerCase().endsWith('.mp4'))throw Error('O vídeo precisa estar em MP4');
   if(file.size>(type==='video'?65:25)*1024*1024)throw Error('Arquivo acima do tamanho permitido');
   const mime=file.type||(type==='video'?'video/mp4':'audio/ogg');
   const r=await fetch('/api/media?kind='+type+'&name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':mime},body:file});
   const x=await r.json();if(!r.ok)throw Error(x.error||'Falha ao enviar arquivo');
   editField(type,x.id);notice='Mídia enviada. Agora salve o rascunho.';
  }
  await refresh();
 }catch(error){notice=error.message;render();}finally{busy=false;}
});
document.addEventListener('toggle',e=>{
 if(e.target.matches('.cm-advanced'))showBridge=e.target.open;
},true);
window.addEventListener('prospector:draw',e=>{
 if(e.detail?.page!=='workflows'||location.hash.includes('/classic'))return;
 snapshot=e.detail.state;render();
});
window.addEventListener('prospector:data',e=>{
 if(e.detail?.page!=='workflows'||mode==='edit')return;
 snapshot=e.detail.state;render();
});
window.addEventListener('hashchange',()=>{
 if(location.hash.startsWith('#/workflows')&&!location.hash.includes('/classic')&&!snapshot)refresh().catch(()=>{});
});
if(location.hash.startsWith('#/workflows')&&!location.hash.includes('/classic'))refresh().catch(()=>{});
