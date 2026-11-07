// Prospector paid landing flow: checkout first, account activation only after a
// signed Stripe webhook. Preview uses no real session or payment network calls.
(() => {
 'use strict';
 const plans={
  dia1:{name:'1 dia',price:'R$ 9,90',credits:'250'},
  dias3:{name:'3 dias',price:'R$ 25,90',credits:'750'},
  dias7:{name:'7 dias',price:'R$ 59,90',credits:'1.750'},
  dias14:{name:'14 dias',price:'R$ 109,90',credits:'3.500'},
  dias30:{name:'30 dias',price:'R$ 219,90',credits:'7.500'}
 };
 const $=s=>document.querySelector(s);
 const clean=s=>String(s||'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
 let busy=false,checkout=null,dialog=null,poll=null;
 function stopPoll(){if(poll){clearInterval(poll);poll=null;}}
 function close(){stopPoll();try{checkout?.destroy();}catch{}checkout=null;if(dialog){dialog.close();dialog.remove();dialog=null;}}
 function shell({title,subtitle,closeable=true}={}){
  close();dialog=document.createElement('dialog');dialog.className='prospector-pay-dialog';
  dialog.setAttribute('aria-label',title||'Checkout Prospector');
  dialog.innerHTML='<div class="ps-pay-panel"><header class="ps-pay-top"><div class="ps-pay-brand"><span>P</span>Prospector <small>/ pagamento seguro</small></div>'+
   (closeable?'<button type="button" class="ps-pay-close" aria-label="Fechar checkout">×</button>':'')+
   '</header><div class="ps-pay-content"><span class="ps-pay-overline">CONSECOM BRASIL</span><h2 class="ps-pay-title"></h2><p class="ps-pay-subtitle"></p><div class="ps-pay-body" role="status" aria-live="polite"></div></div><footer class="ps-pay-foot">🔒 Pagamento processado pela Stripe. Seus créditos só são liberados após confirmação.</footer></div>';
  $('.p3-outer')?.append(dialog)||document.body.append(dialog);
  dialog.querySelector('.ps-pay-title').textContent=title||'Finalizar contratação';
  dialog.querySelector('.ps-pay-subtitle').textContent=subtitle||'';
  dialog.querySelector('.ps-pay-close')?.addEventListener('click',close);
  dialog.addEventListener('cancel',e=>{if(!closeable)e.preventDefault();else close();});
  dialog.showModal();return dialog.querySelector('.ps-pay-body');
 }
 async function post(url,payload){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
   credentials:'same-origin',body:JSON.stringify(payload),signal:AbortSignal.timeout(18000)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(data.error||'Não foi possível continuar. Tente novamente.');
  return data;
 }
 let stripeReady=null;
 async function getStripe(){
  if(window.Stripe)return window.Stripe;
  if(!stripeReady)stripeReady=new Promise((resolve,reject)=>{
   const s=document.createElement('script');s.src='https://js.stripe.com/v3/';s.async=true;
   s.onload=()=>resolve(window.Stripe);s.onerror=()=>reject(Error('Falha ao carregar o checkout da Stripe'));
   document.head.append(s);
  }).catch(err=>{stripeReady=null;throw err;});
  return stripeReady;
 }
 async function buy(packageId){
  if(busy||!plans[packageId])return;
  busy=true;
  const plan=plans[packageId];
  const body=shell({title:'Checkout transparente',subtitle:plan.name+' · '+plan.credits+' abordagens · '+plan.price});
  body.innerHTML='<div class="ps-pay-spinner" aria-label="Carregando"></div><p>Preparando pagamento com cartão e Pix…</p>';
  try{
   const order=await post('/api/platform/paid-checkout',{packageId});
   const Stripe=await getStripe();
   if(!Stripe||!order.clientSecret||!order.publishableKey)throw Error('Pagamento temporariamente indisponível');
   if(!dialog?.open)return;
   body.innerHTML='<div class="ps-pay-summary"><div><strong>'+clean(plan.name)+'</strong><small>'+plan.credits+' créditos</small></div><b>'+clean(plan.price)+'</b></div><div class="ps-pay-stripe" id="ps-paid-mount"></div>';
   checkout=await Stripe(order.publishableKey).initEmbeddedCheckout({clientSecret:order.clientSecret});
   if(dialog?.open)checkout.mount('#ps-paid-mount');
  }catch(error){
   if(dialog?.open)body.innerHTML='<div class="ps-pay-error"><strong>Não foi possível abrir o pagamento</strong><p>'+clean(error.message)+'</p><p>Nenhum acesso foi criado ou liberado.</p></div>';
  }finally{busy=false;}
 }
 const sessionPattern=/^cs_live_[a-zA-Z0-9_]+$/;
 async function status(sessionId){
  const r=await fetch('/api/platform/paid-checkout/status?session_id='+encodeURIComponent(sessionId),{
   cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000)});
  const obj=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(obj.error||'Pagamento não encontrado');
  return obj;
 }
 function activationForm(body,info,sessionId){
  if(!dialog?.open)return;
  const email=clean(info.email||'e-mail informado no pagamento');
  body.innerHTML='<div class="ps-pay-success"><span>✓</span><strong>Pagamento confirmado</strong><p>Seu plano de '+clean(String(info.credits||''))+' créditos está pronto para ser ativado.</p></div>'+
   '<p class="ps-pay-email">Acesso vinculado a: <strong>'+email+'</strong></p>'+
   '<form id="ps-paid-activate" class="ps-pay-form">'+
   '<label>Nome do responsável ou empresa<input name="name" maxlength="100" required autocomplete="name" placeholder="Nome da sua empresa"></label>'+
   '<label>Celular com DDD (opcional)<input name="phone" type="tel" autocomplete="tel" maxlength="20" placeholder="(11) 99999-9999"></label>'+
   '<label>Crie sua senha de acesso<input name="password" type="password" autocomplete="new-password" minlength="10" maxlength="128" required placeholder="Mínimo de 10 caracteres"></label>'+
   '<label class="ps-pay-agree"><input type="checkbox" name="privacy" required> Li e aceito o tratamento de dados para disponibilizar o serviço Prospector.</label>'+
   '<p class="ps-pay-feedback" role="alert"></p><button type="submit" class="ps-pay-primary">Criar minha conta e acessar o painel →</button></form>';
  const form=body.querySelector('#ps-paid-activate');
  form.addEventListener('submit',async e=>{
   e.preventDefault();if(busy||!form.reportValidity())return;busy=true;
   const button=form.querySelector('button[type=submit]'),message=form.querySelector('.ps-pay-feedback');
   button.disabled=true;message.textContent='Ativando seu acesso…';
   try{
    const data=await post('/api/platform/paid-checkout/activate',{
     sessionId,name:form.elements.name.value.trim(),phone:form.elements.phone.value,
     password:form.elements.password.value,privacyAcknowledged:form.elements.privacy.checked
    });
    sessionStorage.removeItem('prospector-paid-return-session');
    message.textContent=data.existing?'Plano creditado em sua conta existente. Entre com sua senha atual.':'Conta criada. Abrindo seu painel…';
    location.assign(data.next||'/entrar');
   }catch(error){message.textContent=error.message;button.disabled=false;}finally{busy=false;}
  });
 }
 async function activate(sessionId){
  if(!sessionPattern.test(sessionId))return;
  const body=shell({title:'Ativar meu plano',subtitle:'Acesso liberado somente após confirmação do pagamento.'});
  body.innerHTML='<div class="ps-pay-spinner"></div><p>Conferindo o pagamento com a Stripe…</p>';
  let last='',started=Date.now();
  const refresh=async ()=>{
   try{
    const info=await status(sessionId);
    if(!dialog?.open)return;
    if(info.status==='PAID'){stopPoll();activationForm(body,info,sessionId);return;}
    if(info.status==='CLAIMED'){
     stopPoll();sessionStorage.removeItem('prospector-paid-return-session');
     body.innerHTML='<div class="ps-pay-success"><span>✓</span><strong>Pagamento confirmado</strong><p>Os créditos foram adicionados a uma conta existente ou já ativada.</p></div><a class="ps-pay-primary ps-pay-link" href="/entrar">Entrar no meu painel →</a>';
     return;
    }
    if(info.status==='PENDING'){
     if(last!=='PENDING'){body.innerHTML='<div class="ps-pay-await"><strong>Aguardando confirmação do pagamento</strong><p>Se pagou por Pix, a confirmação pode levar alguns instantes. Você ainda não tem acesso ao plano pago.</p><button class="ps-pay-secondary" id="ps-pay-refresh" type="button">Atualizar status</button></div>';body.querySelector('#ps-pay-refresh')?.addEventListener('click',refresh);}
     last='PENDING';
     if(Date.now()-started>240000)stopPoll();return;
    }
    throw Error('Não foi possível identificar a compra');
   }catch(error){
    if(!dialog?.open)return;
    body.innerHTML='<div class="ps-pay-error"><strong>Verificação indisponível</strong><p>'+clean(error.message)+'</p><button class="ps-pay-secondary" id="ps-pay-retry">Tentar novamente</button></div>';
    body.querySelector('#ps-pay-retry')?.addEventListener('click',refresh);
   }
  };
  await refresh();if(dialog?.open&&!poll)poll=setInterval(refresh,6500);
 }
 document.addEventListener('click',e=>{
  const link=e.target.closest('[data-plan-checkout]');
  if(!link)return;
  e.preventDefault();buy(link.dataset.planCheckout);
 });
 const params=new URLSearchParams(location.search);
 let previous=null;
 try{previous=sessionStorage.getItem('prospector-paid-return-session');}catch{}
 const returned=params.get('pagamento')==='adesao'?params.get('session_id'):null;
 if(returned&&sessionPattern.test(returned)){
  try{sessionStorage.setItem('prospector-paid-return-session',returned);}catch{}
  history.replaceState(null,'','/cadastro');
  activate(returned);
 }else if(location.pathname==='/cadastro'&&previous&&sessionPattern.test(previous)){
  activate(previous);
 }
})();
