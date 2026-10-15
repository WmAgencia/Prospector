// Interface de campanhas enxuta. Mídias precisam ser enviadas pelo operador.
// Não cria autorizações nem inicia disparos ao carregar.
const q=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uuid=()=>crypto.randomUUID();
let snapshot=null,selected=null,draft=null,loading=false,notice='';
const endpoint=async(path,data)=>{
 const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const value=await r.json();if(!r.ok)throw Error(value.error||'Operação indisponível');return value;
};
const list=()=>snapshot?.workflows||[];
const isCampaign=x=>x&&x.steps?.some(s=>s.type==='audio')&&x.steps?.some(s=>s.type==='video')&&x.steps?.some(s=>s.type==='decision');
function newCampaign(){
 return {id:null,name:'Nova campanha · Sites profissionais',enabled:false,segments:[],steps:[
 {id:uuid(),type:'message',text:'{{greeting}} A gente conheceu o trabalho de vocês e gostaríamos de apresentar uma proposta. Posso te enviar um áudio explicando tudo certinho?'},
 {id:uuid(),type:'wait_reply'},
 {id:uuid(),type:'delay',seconds:45},
 {id:uuid(),type:'audio',media_id:'',description:'Descreva com fidelidade o áudio gravado e o objetivo da apresentação.'},
 {id:uuid(),type:'delay',seconds:10},
 {id:uuid(),type:'video',media_id:'',caption:'O que achou? Gostaria de ter um assim também?'},
 {id:uuid(),type:'wait_reply'},
 {id:uuid(),type:'decision',context:'website_interest',context_description:'Após o vídeo, o cliente responde se gostaria de ter um site assim.',yes_type:'message',yes_text:'',yes_action:'handover',no_type:'message',no_text:'Sem problemas, muito obrigado pelo retorno, ficamos à disposição.',no_action:'end'},
 {id:uuid(),type:'end'}
 ]};
}
function render(){
 if(!location.hash.startsWith('#/workflows')||location.hash.includes('/classic'))return;
 const screen=q('#screen');if(!screen)return;
 if(!snapshot){screen.innerHTML='<div class="loader">Carregando campanhas…</div>';return;}
 if(!draft)draft=newCampaign();
 const steps=draft.steps,initial=steps.find(x=>x.type==='message'),delay=steps.find(x=>x.type==='delay'),videoDelay=steps.filter(x=>x.type==='delay')[1]||{seconds:10},audio=steps.find(x=>x.type==='audio'),video=steps.find(x=>x.type==='video'),decision=steps.find(x=>x.type==='decision');
 if(!initial||!delay||!audio||!video||!decision){screen.innerHTML='<div class="panel"><h3>Fluxo avançado</h3><p>Esta automação utiliza blocos de formato antigo. Use o editor clássico para alterá-la.</p><button class="btn secondary" data-campaign="classic">Abrir editor clássico</button><button class="btn" data-campaign="new">Criar nova campanha</button></div>';return;}
 const options=(kind,current)=>'<option value="">Selecione um '+kind+'…</option>'+(snapshot.media||[]).filter(m=>m.kind===kind).map(m=>'<option value="'+esc(m.id)+'" '+(m.id===current?'selected':'')+'>'+esc(m.name)+'</option>').join('');
 const bridge=snapshot.bridge||{state:'NOT_SYNCED'};
 const bridgeLabel={READY:'Campanha sincronizada',WAITING_MEDIA:'Aguardando áudio e vídeo',NOT_SYNCED:'Aguardando primeira sincronização',SYNC_ERROR:'Falha na sincronização',PAUSED_REQUIRED:'Pause a operação para atualizar'}[bridge.state]||bridge.state;
 const bridgeHtml='<div class="cp-bridge"><div class="between"><div><strong>✧ Ponte para IA</strong><p>Campanha e roteiro recebidos pelo GitHub. Os arquivos de áudio e vídeo só ficam prontos depois de enviados à biblioteca privada.</p></div><span class="tag '+(bridge.ready?'green':'yellow')+'">'+esc(bridgeLabel)+'</span></div><div class="cp-bridge-grid"><span>Áudio: <strong>'+(bridge.audio?.present?'Importado':'Pendente')+'</strong></span><span>Vídeo mudo: <strong>'+(bridge.video?.present?'Importado':'Pendente')+'</strong></span><span>Revisão: <strong>'+Number(bridge.revision||0)+'</strong></span></div><div class="actionsrow"><button class="btn small secondary" data-campaign="bridge-sync">Sincronizar com IA</button><a href="https://github.com/WmAgencia/Prospector/blob/main/bridge/campaigns/consecom-350.json" target="_blank" rel="noopener noreferrer" class="btn small secondary">Ver configurações no GitHub ↗</a></div></div>';
 const available=list().map(w=>'<button class="cp-item '+(w.id===draft.id?'cp-selected':'')+'" data-campaign="select" data-id="'+esc(w.id)+'"><strong>'+esc(w.name)+'</strong><small>'+((snapshot.settings?.autonomous_campaign_id===w.id)?'Em uso automático · ':'')+(w.enabled?'Ativa':'Rascunho')+'</small></button>').join('');
 screen.innerHTML='<div class="cp-head"><div><div class="panel-eyebrow">CONSECOM / AUTOMAÇÕES</div><h2>Campanhas de prospecção</h2><p>Configure o fluxo uma vez. O motor começa com os contatos que realmente autorizaram mensagens.</p></div><div class="actionsrow"><label class="btn secondary cp-import-label">⬆ Importar campanha pronta<input data-campaign-import type="file" accept=".zip,application/zip" style="display:none"></label><button class="btn secondary" data-campaign="new">+ Nova campanha</button><button class="btn secondary" data-campaign="classic">Editor clássico ↗</button></div></div>'+
 bridgeHtml+
 '<div class="cp-import-hint">Já tem o áudio e o vídeo da campanha Consecom? Importe o pacote ZIP completo: o sistema instala os dois arquivos, cria o fluxo, define a campanha ativa e mantém o estado de pausa atual.</div><div class="cp-layout"><aside class="panel cp-library"><div class="between"><h3>Suas campanhas</h3><span class="tag">'+list().length+'</span></div>'+available+'</aside><section class="panel cp-editor"><div class="between"><h3>Configuração do fluxo</h3><span class="tag '+(draft.enabled?'green':'yellow')+'">'+(draft.enabled?'Ativada':'Rascunho')+'</span></div>'+
 '<div class="field"><label>Nome</label><input data-cp-field="name" value="'+esc(draft.name)+'" placeholder="Campanha de sites"></div><div class="field"><label>Segmentos (opcional, separados por vírgula)</label><input data-cp-field="segments" value="'+esc((draft.segments||[]).join(', '))+'" placeholder="Psicólogo, Nutricionista…"></div>'+
 '<div class="cp-steps">'+
 '<div class="cp-step"><span class="cp-number">01</span><div class="cp-step-content"><h4>Mensagem de abordagem</h4><p>Primeira mensagem. Aguarda uma autorização clara para continuar com a apresentação.</p><textarea data-cp-field="message" rows="3">'+esc(initial.text)+'</textarea></div></div>'+
 '<div class="cp-step"><span class="cp-number">02</span><div class="cp-step-content"><h4>Aguardar resposta</h4><p>O áudio só é liberado quando o contato permite continuar. Respostas incertas vão para revisão.</p></div></div>'+
 '<div class="cp-step"><span class="cp-number">03</span><div class="cp-step-content"><h4>Espera antes da apresentação</h4><div class="row"><input data-cp-field="delay" type="number" min="1" max="86400" value="'+Number(delay.seconds||45)+'"><span class="subtle">segundos</span></div></div></div>'+
 '<div class="cp-step"><span class="cp-number">04</span><div class="cp-step-content"><h4>Enviar áudio</h4><select data-cp-field="audio">'+options('áudio',audio.media_id)+'</select><input type="file" data-cp-upload="audio" accept=".ogg,.mp3,.m4a,.opus,audio/*"><label>Resumo fiel do áudio</label><textarea data-cp-field="audio-description" rows="2">'+esc(audio.description)+'</textarea></div></div>'+
 '<div class="cp-step"><span class="cp-number">05</span><div class="cp-step-content"><h4>Esperar após o áudio</h4><div class="row"><input data-cp-field="video-delay" type="number" min="1" max="86400" value="'+Number(videoDelay.seconds||10)+'"><span class="subtle">segundos</span></div></div></div>'+ 
 '<div class="cp-step"><span class="cp-number">06</span><div class="cp-step-content"><h4>Enviar vídeo</h4><select data-cp-field="video">'+options('vídeo',video.media_id)+'</select><input type="file" data-cp-upload="video" accept="video/mp4,.mp4"><p>MP4, no máximo 60 segundos. O texto vai como legenda do vídeo, sem alterar a imagem nem adicionar som.</p><label>Legenda da mensagem de vídeo</label><textarea data-cp-field="video-caption" rows="2">'+esc(video.caption||'')+'</textarea></div></div>'+
 '<div class="cp-step"><span class="cp-number">07</span><div class="cp-step-content"><h4>Aguardar decisão</h4><p>SIM: vai para Interessados, com atendimento humano. NÃO: mensagem de despedida e Sem interesse. Dúvidas: revisão.</p><label>Mensagem após recusa</label><textarea data-cp-field="farewell" rows="2">'+esc(decision.no_text||'Sem problemas! Obrigado pelo retorno.')+'</textarea></div></div></div>'+
 '<div class="cp-actions"><button class="btn secondary" data-campaign="save">Salvar rascunho</button><button class="btn" data-campaign="activate">Salvar e ativar campanha</button></div><p class="helper-text">Ativar define esta campanha como padrão para novos contatos autorizados, sem iniciar mensagens enquanto a operação estiver pausada. Cadência máxima: 150/dia, 08h–18h.</p></section></div>'+
 (notice?'<p class="cp-notice" role="status">'+esc(notice)+'</p>':'');
}
async function load(){
 if(loading)return;loading=true;
 try{let r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)throw Error('Acesso à sessão indisponível');snapshot=await r.json();
  if(selected&&!draft)draft=structuredClone(list().find(w=>w.id===selected)||newCampaign());
  render();
 }catch(e){notice=e.message;render();}finally{loading=false;}
}
function updateField(name,value){
 if(!draft)return;
 const st=draft.steps;
 if(name==='name')draft.name=value;
 if(name==='segments')draft.segments=value.split(',').map(x=>x.trim()).filter(Boolean);
 if(name==='message')st.find(x=>x.type==='message').text=value;
 if(name==='delay')st.find(x=>x.type==='delay').seconds=Number(value);
 if(name==='video-delay'){let second=st.filter(x=>x.type==='delay')[1];if(!second){second={id:uuid(),type:'delay',seconds:10};st.splice(st.findIndex(x=>x.type==='video'),0,second);}second.seconds=Number(value);}
 if(name==='audio')st.find(x=>x.type==='audio').media_id=value;
 if(name==='video')st.find(x=>x.type==='video').media_id=value;
 if(name==='video-caption')st.find(x=>x.type==='video').caption=value;
 if(name==='audio-description')st.find(x=>x.type==='audio').description=value;
 if(name==='farewell')st.find(x=>x.type==='decision').no_text=value;
}
document.addEventListener('input',e=>{const el=e.target.closest('[data-cp-field]');if(el)updateField(el.dataset.cpField,el.value);});
document.addEventListener('change',async e=>{
 const pack=e.target.closest('[data-campaign-import]');
 if(pack){
  const file=pack.files?.[0];if(!file)return;
  try{
   if(!file.name.toLowerCase().endsWith('.zip')||file.size>38*1024*1024)throw Error('Escolha o ZIP completo da campanha Consecom (até 38 MB).');
   notice='Importando vídeo, áudio e campanha…';render();
   const response=await fetch('/api/campaign/import-package',{method:'POST',headers:{'Content-Type':'application/zip'},body:file});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Falha ao importar campanha');
   selected=result.workflowId;draft=null;
   notice=result.alreadyInstalled?'Campanha já instalada. Nenhum envio foi reiniciado.':result.paused?'Campanha instalada com áudio e vídeo sem som. A prospecção continua pausada.':'Campanha instalada e pronta para contatos com autorização registrada.';
   await load();
  }catch(error){notice=error.message;render();}
  return;
 }
 const el=e.target.closest('[data-cp-upload]');if(!el||!el.files?.[0])return;
 const kind=el.dataset.cpUpload,file=el.files[0];
 try{
  if(kind==='video'&&!file.name.toLowerCase().endsWith('.mp4'))throw Error('Escolha vídeo MP4');
  if(file.size>(kind==='video'?65:25)*1024*1024)throw Error('Arquivo muito grande');
  const r=await fetch('/api/media?kind='+kind+'&name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':file.type||(kind==='video'?'video/mp4':'audio/mpeg')},body:file});
  const value=await r.json();if(!r.ok)throw Error(value.error||'Falha ao enviar mídia');
  updateField(kind,value.id);notice=kind==='video'?'Vídeo anexado':'Áudio anexado';
  await load();
 }catch(error){notice=error.message;render();}
});
document.addEventListener('click',async e=>{
 const el=e.target.closest('[data-campaign]');if(!el)return;e.preventDefault();
 const action=el.dataset.campaign;
 try{
  if(action==='bridge-sync'){
   notice='Consultando o manifesto da IA no GitHub…';render();
   const result=await endpoint('/api/agent-bridge/sync',{});
   notice=result.message||'Sincronização concluída.';
   await load();return;
  }
  if(action==='classic'){location.hash='/workflows/classic';return;}
  if(action==='new'){selected=null;draft=newCampaign();notice='Rascunho novo. Selecione áudio e vídeo antes de ativar.';render();return;}
  if(action==='select'){selected=el.dataset.id;draft=structuredClone(list().find(w=>w.id===selected));notice='';render();return;}
  if(!draft)throw Error('Escolha uma campanha');
  if(action==='save'||action==='activate'){
   const active=action==='activate';
   if(active&&(!draft.steps.find(s=>s.type==='audio')?.media_id||!draft.steps.find(s=>s.type==='video')?.media_id))throw Error('Inclua áudio e vídeo antes de ativar.');
   const out=await endpoint('/api/workflows',{id:draft.id||undefined,name:draft.name,enabled:active,segments:draft.segments||[],steps:draft.steps});
   selected=out.id;
   if(active)await endpoint('/api/workflows/default',{id:out.id});
   draft=null;notice=active?'Campanha ativada. A execução depende de operação retomada e autorização de contato.':'Rascunho salvo.';
   await load();return;
  }
 }catch(error){notice=error.message;render();}
});
const observer=new MutationObserver(()=>{
 if(!location.hash.startsWith('#/workflows')||location.hash.includes('/classic'))return;
 const screen=q('#screen');if(!screen||screen.querySelector('.cp-head')||screen.querySelector('.loader'))return;
 if(screen.querySelector('.section-head')||screen.querySelector('.workflow-layout'))load();
});
observer.observe(document.body,{childList:true,subtree:true});
window.addEventListener('hashchange',()=>{if(location.hash.startsWith('#/workflows')&&!location.hash.includes('/classic'))load();});
if(location.hash.startsWith('#/workflows')&&!location.hash.includes('/classic'))load();
