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

// Local SVG assets, finite product demonstration and progressive motion.
const iconMarkup=key=>globalThis.ProspectorIcons?.svg(key,'marketing-icon')||'';
document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=iconMarkup(el.dataset.icon);});
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if('IntersectionObserver' in window&&!reducedMotion){
 const reveal=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('is-visible');reveal.unobserve(entry.target);}},{threshold:.08});
 document.querySelectorAll('.section-heading,.automated-steps article,.feature-grid article,.volume-copy,.opportunity-card,.price-card,.faq-list details,.final-cta').forEach((el,i)=>{el.style.setProperty('--reveal-delay',(i%4)*60+'ms');el.classList.add('motion-ready');reveal.observe(el);});
}
const scene=document.querySelector('.sales-scene'),demoButton=document.querySelector('#demo-play');
if(scene&&demoButton){
 let stage=reducedMotion?2:0,playing=!reducedMotion,visible=false,timer=null;
 const clear=()=>{if(timer!==null)clearTimeout(timer);timer=null;};
 const update=()=>{
  scene.dataset.demo=String(stage);scene.classList.toggle('is-playing',playing&&visible&&!document.hidden);scene.classList.toggle('is-paused',!playing||!visible||document.hidden);
  scene.querySelectorAll('[data-demo-stage]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.demoStage)===stage)));
  scene.querySelector('.scene-core>span').innerHTML=iconMarkup(['radar','conversations','bell'][stage]);
  demoButton.innerHTML=iconMarkup(playing?'pause':'play');demoButton.setAttribute('aria-label',playing?'Pausar demonstração':'Reproduzir demonstração');
 };
 const schedule=()=>{clear();update();if(!playing||!visible||document.hidden)return;timer=setTimeout(()=>{timer=null;if(stage<2){stage++;schedule();}else{playing=false;update();}},3000);};
 scene.querySelectorAll('[data-demo-stage]').forEach(button=>button.addEventListener('click',()=>{clear();stage=Number(button.dataset.demoStage);playing=false;update();}));
 demoButton.addEventListener('click',()=>{playing=!playing;if(playing&&stage===2)stage=0;schedule();});
 document.addEventListener('visibilitychange',schedule);
 if('IntersectionObserver' in window){new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;schedule();},{threshold:.12}).observe(scene);}else{visible=true;schedule();}
 update();
}
