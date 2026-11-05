const dialog=document.querySelector('#auth-dialog'),form=document.querySelector('#auth-form');let mode='signup',sending=false;
const $=s=>document.querySelector(s);
function openAuth(next){mode=next;const signup=mode==='signup';document.querySelectorAll('.signup-only').forEach(x=>x.hidden=!signup);$('#signup-name').required=signup;$('#signup-phone').required=signup;$('#signup-email').type=signup?'email':'text';$('#signup-email').required=true;$('#signup-email').placeholder=signup?'voce@agencia.com.br':'E-mail ou celular com DDD';$('#identifier-label').textContent=signup?'E-mail profissional':'E-mail ou celular';$('#signup-password').autocomplete=signup?'new-password':'current-password';$('#auth-title').textContent=signup?'Vamos começar?':'Bom ter você de volta.';$('#auth-description').textContent=signup?'Crie sua conta gratuita. Você prepara a operação antes de comprar créditos.':'Entre no seu espaço para continuar de onde parou.';$('#auth-eyebrow').textContent=signup?'SEU ESPAÇO COMEÇA AQUI':'SEU PAINEL PROSPECTOR';$('#auth-submit').textContent=signup?'Criar conta gratuita ↗':'Entrar no meu painel ↗';$('#auth-switch').replaceChildren(document.createTextNode(signup?'Já tem uma conta? ':'Primeira vez aqui? '));const b=document.createElement('button');b.type='button';b.dataset.switch=signup?'signin':'signup';b.textContent=signup?'Entrar':'Criar conta';$('#auth-switch').append(b);$('#login-help').hidden=signup;$('#auth-message').textContent='';if(!dialog.open)dialog.showModal();}
const packageLabels={essencial:'Essencial · 50 créditos · R$ 4,90',padrao:'Padrão · 250 créditos · R$ 9,90',pro:'Pro · 1.000 créditos · R$ 34,90',agencia:'Agência · 5.000 créditos · R$ 149,90'};
document.addEventListener('click',e=>{
 const link=e.target.closest('[data-auth],[data-switch]');
 if(!link)return;
 e.preventDefault();openAuth(link.dataset.auth||link.dataset.switch);
 if(link.dataset.package&&packageLabels[link.dataset.package]){
  try{sessionStorage.setItem('prospector-preferred-package',link.dataset.package);}catch{}
  $('#auth-description').textContent='Pacote selecionado: '+packageLabels[link.dataset.package]+'. Crie sua conta gratuitamente. A recarga é liberada pela Consecom após confirmação de pagamento; não haverá cobrança no cadastro.';
 }
});
$('.close-dialog').addEventListener('click',()=>{if(!sending)dialog.close();});dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(!sending&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))dialog.close();}});dialog.addEventListener('cancel',e=>{if(sending)e.preventDefault();});
$('#password-toggle').addEventListener('click',()=>{const input=$('#signup-password'),show=input.type==='password';input.type=show?'text':'password';$('#password-toggle').textContent=show?'Ocultar':'Mostrar';$('#password-toggle').setAttribute('aria-label',show?'Ocultar senha':'Mostrar senha');});
$('#privacy-link').addEventListener('click',e=>{e.preventDefault();$('#privacy-description').hidden=!$('#privacy-description').hidden;});
form.addEventListener('submit',async e=>{e.preventDefault();if(sending||!form.reportValidity())return;const message=$('#auth-message');if(mode==='signup'&&!$('#privacy-check').checked){message.textContent='Confirme a leitura sobre o uso dos dados para continuar.';$('#privacy-check').focus();return;}const input={identifier:$('#signup-email').value.trim(),password:$('#signup-password').value};if(mode==='signup')Object.assign(input,{name:$('#signup-name').value.trim(),email:input.identifier,phone:$('#signup-phone').value,privacyAcknowledged:true});sending=true;$('#auth-submit').disabled=true;message.textContent=mode==='signup'?'Preparando seu espaço…':'Verificando acesso…';try{const response=await fetch('/api/platform/'+mode,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(20000)});const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'Não foi possível continuar. Tente novamente.');message.textContent='Tudo certo. Abrindo seu painel…';form.reset();location.assign(data.next||'/');}catch(e){message.textContent=e.name==='TimeoutError'?'A conexão demorou. Tente novamente em instantes.':e.message;$('#auth-submit').disabled=false;sending=false;}});
if(location.pathname==='/cadastro')openAuth('signup');if(location.pathname==='/entrar')openAuth('signin');

// Local SVG icon assets. The product demonstration only changes synthetic UI.
const iconMarkup=key=>globalThis.ProspectorIcons?.svg(key,'marketing-icon')||'';
document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=iconMarkup(el.dataset.icon);});

// Accessible product tour: click, Enter, Space and horizontal arrow keys.
const tourTabs=[...document.querySelectorAll('[role="tab"][data-tour]')];
const tourPanels=[...document.querySelectorAll('[data-tour-panel]')];
function selectTour(index,focus=false){
 if(!tourTabs.length)return;
 const n=(index+tourTabs.length)%tourTabs.length;
 const active=tourTabs[n].dataset.tour;
 tourTabs.forEach((tab,i)=>{
  const selected=i===n;
  tab.setAttribute('aria-selected',String(selected));
  tab.tabIndex=selected?0:-1;
 });
 tourPanels.forEach(panel=>{panel.hidden=panel.dataset.tourPanel!==active;});
 if(focus)tourTabs[n].focus();
}
tourTabs.forEach((tab,i)=>{
 tab.addEventListener('click',()=>selectTour(i));
 tab.addEventListener('keydown',event=>{
  if(event.key==='ArrowRight'||event.key==='ArrowDown'){
   event.preventDefault();selectTour(i+1,true);
  }else if(event.key==='ArrowLeft'||event.key==='ArrowUp'){
   event.preventDefault();selectTour(i-1,true);
  }else if(event.key==='Home'){
   event.preventDefault();selectTour(0,true);
  }else if(event.key==='End'){
   event.preventDefault();selectTour(tourTabs.length-1,true);
  }
 });
});
selectTour(0);

// Progressive entrance animations, disabled for reduced motion preferences.
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if(!reducedMotion&&'IntersectionObserver' in window){
 const reveal=new IntersectionObserver(entries=>{
  for(const entry of entries)if(entry.isIntersecting){
   entry.target.classList.add('is-visible');
   reveal.unobserve(entry.target);
  }
 },{threshold:.08});
 document.querySelectorAll('.p3-centered-title,.p3-flow-card,.p3-product,.p3-benefits-strip,.p3-price-card,.p3-scenario-cards article,.p3-faq,.p3-final-cta').forEach((el,i)=>{
  el.style.setProperty('--p3-reveal-delay',(i%4)*45+'ms');
  el.classList.add('motion-ready');
  reveal.observe(el);
 });
}
