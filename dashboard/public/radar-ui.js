// Complemento visual do radar existente, vinculado aos números atuais do backend.
// Não inventa leads, não inicia mensagens e não altera flags de consentimento.
async function refresh(){
 if(!location.hash||location.hash==='#/overview'){
  const radar=document.querySelector('.radar-panel');if(!radar)return;
  try{
   const response=await fetch('/api/radar',{cache:'no-store'});if(!response.ok)return;
   const data=await response.json();
   if(!document.contains(radar))return;
   const limit=Number(data.limit||150),sent=Number(data.confirmed||0),counted=Number(data.counted||0);
   const goal=Number(data.discoveryTarget||150),found=Number(data.foundToday||0);
   const status={PAUSED:'Pausado',TARGET_REACHED:'Meta de 150 atingida',OUTSIDE_HOURS:'Fora do horário',RUNNING_OR_WAITING_FOR_PROVIDER:'Busca agendada'}[data.discoveryReason]||'Aguardando fonte';
   const circle=radar.querySelector('.radar-circle');circle?.classList.toggle('idle',data.discoveryReason!=='RUNNING_OR_WAITING_FOR_PROVIDER');
   const title=radar.querySelector('.radar-heading .tag');if(title){title.textContent=data.searchInProgress?'Pesquisa em execução':status;title.classList.toggle('green',data.discoveryReason==='RUNNING_OR_WAITING_FOR_PROVIDER');}
   const counter=radar.querySelector('.radar-quota h3');if(counter)counter.innerHTML='<strong>'+sent+'</strong> <span class="subtle">/ '+limit+' confirmadas</span>';
   const info=radar.querySelector('.radar-quota-info');if(info)info.innerHTML=String(data.start).padStart(2,'0')+'h–'+String(data.end).padStart(2,'0')+'h · '+data.intervalSeconds+' s de intervalo<br><small>'+Number(data.uncertain||0)+' entregas incertas · '+Number(data.remaining||0)+' vagas restantes</small>';
   const bar=radar.querySelector('.radar-quota .radar-meter');if(bar){bar.setAttribute('aria-valuemax',String(limit));bar.setAttribute('aria-valuenow',String(Math.min(limit,counted)));const v=bar.querySelector('span');if(v)v.style.width=Math.min(100,100*counted/limit)+'%';}
   const ticks=radar.querySelector('.radar-ticks');if(ticks)ticks.innerHTML=[0,.25,.5,.75,1].map(v=>'<span>'+Math.round(limit*v)+'</span>').join('');
   let target=radar.querySelector('.radar-discovery-meter');
   if(!target){target=document.createElement('div');target.className='radar-discovery-meter';radar.querySelector('.radar-quota')?.before(target);}
   target.innerHTML='<div class="between"><div><div class="panel-eyebrow">DESCOBERTA AUTOMÁTICA · HOJE</div><h3><strong>'+Math.min(goal,found)+'</strong> <span class="subtle">/ '+goal+' clientes encontrados</span></h3></div><span class="tag">'+status+'</span></div><div class="radar-meter" role="progressbar" aria-label="Clientes encontrados hoje" aria-valuemin="0" aria-valuemax="'+goal+'" aria-valuenow="'+Math.min(goal,found)+'"><span style="width:'+Math.min(100,found/goal*100)+'%"></span></div><p class="helper-text">A busca pausa ao alcançar a meta ou quando se esgotam as cotas das fontes. Encontrar contatos não significa que autorizaram mensagens.</p>';
   const side=radar.querySelector('.radar-mini-grid div:first-child span');if(side)side.textContent='encontrados hoje / '+goal;
  }catch{}
 }
 const prospect=document.querySelector('.section-head .actionsrow');
 if(location.hash.startsWith('#/prospects')&&prospect&&!prospect.querySelector('[data-to="recontacts"]')){
  const button=document.createElement('button');button.className='btn secondary';button.dataset.action='route';button.dataset.to='recontacts';button.textContent='Recontatos';prospect.prepend(button);
 }
}
setInterval(refresh,6000);refresh();
