// Francisca's tenant-scoped, review-before-activation onboarding interview.
// Deterministic question order with adaptive per-service branches; the model never
// grants permissions, invents prices or activates the profile automatically.
import crypto from 'node:crypto';
import {getSetting,setSetting,now} from './db.mjs';
import {storeTrainingMarkdown,removeTrainingMarkdown} from './training-markdown.mjs';

const KEY='francisca_training_interview_v1';
const clean=(value,max=750)=>String(value||'').replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const normalized=value=>clean(value,600).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const normalizeServiceName=value=>clean(value,90).replace(/^(?:eu )?(?:trabalho (?:com|s[oó])|ofere[cç]o|fa[cç]o|prestamos?|temos|tamb[eé]m fa[cç]o|e tamb[eé]m|sou (?:da [aá]rea de|de)|servi[cç]os? de)\s+/i,'').replace(/\s+(?:apenas|somente|s[oó])\.?$/i,'').trim();
const splitServices=value=>{
 const raw=clean(value,700).replace(/\b(?:al[eé]m disso|tamb[eé]m trabalhamos com|tamb[eé]m ofere[cç]o)\b/gi,', ');
 const segments=raw.split(/\s*(?:,|;|\s+e\s+|\s+mais\s+|\s+ou\s+)\s*/i)
  .map(normalizeServiceName).filter(x=>x.length>=3&&!/^(?:tudo bem|oi|ol[aá]|bom dia|boa tarde|boa noite|irm[aã]o)(?:[\s!?.]|$)/i.test(x));
 const unique=[];for(const name of segments){if(!unique.some(s=>normalized(s.name)===normalized(name)))unique.push({name,detail:'',price:''});}
 return unique.slice(0,8);
};
const classify=name=>{
 const n=normalized(name);
 if(/tr[aá]fego|an[uú]nci|google ads|meta ads|m[ií]dia paga|performance/.test(n))return 'traffic';
 if(/site|website|web|landing|e-commerce|loja virtual|desenvolvimento|programa[cç][aã]o/.test(n))return 'web';
 if(/design|identidade visual|logo|branding|social media|arte|criativo/.test(n))return 'design';
 return 'general';
};
const detailQuestion=name=>{
 switch(classify(name)){
  case 'traffic':return 'Sobre '+name+': em quais plataformas você trabalha e o investimento nos anúncios é pago à parte da sua gestão?';
  case 'web':return 'Sobre '+name+': quais tipos de site você entrega (institucional, landing page, loja virtual...) e qual prazo costuma informar?';
  case 'design':return 'Sobre '+name+': quais peças ou entregáveis estão incluídos e quais prazos você costuma cumprir?';
  default:return 'Sobre '+name+': o que exatamente está incluído, como é entregue e em quanto tempo?';
 }
};
function question(state){
 const data=state.data||{},key=state.key,index=state.index||0;
 if(key==='company')return 'Olá, sou a Francisca! Vamos preparar meu atendimento para o seu negócio. Primeiro: como se chama sua empresa?';
 if(key==='audience')return 'Prazer! Qual é o tipo de cliente que você quer alcançar? Pode falar os segmentos e o perfil ideal.';
 if(key==='services')return 'Quais serviços sua empresa oferece? Pode me contar todos, por exemplo: gestão de tráfego, desenvolvimento de sites e design gráfico.';
 if(key==='service_detail')return detailQuestion(data.services?.[index]?.name||'esse serviço');
 if(key==='service_price')return 'E quanto você cobra por '+(data.services?.[index]?.name||'esse serviço')+'? Pode ser o valor inicial, a mensalidade ou uma faixa. Se depender de orçamento, me diga.';
 if(key==='region')return 'Você atende clientes de quais cidades ou regiões? Pode atender online em todo o Brasil?';
 if(key==='process')return 'Como funciona a contratação? Precisa de reunião, briefing, orçamento personalizado ou pode apresentar um valor direto?';
 if(key==='qualify')return 'Que perguntas devo fazer para descobrir se um cliente tem o perfil certo antes de passar para você?';
 if(key==='style')return 'Como você quer que eu converse com os clientes? Mais formal ou descontraída? Respostas curtas ou explicativas?';
 if(key==='objections')return 'Se alguém disser que está caro, pedir desconto ou perguntar pelo portfólio, como você prefere que eu responda?';
 if(key==='handoff')return 'Em quais situações eu devo parar de responder e avisar você? Por exemplo: pedido de proposta, cliente interessado ou negociação de preço.';
 if(key==='restrictions')return 'Existe alguma promessa, desconto, serviço ou condição que eu nunca devo oferecer sem sua aprovação?';
 if(key==='notification')return 'Por último: para qual WhatsApp você quer receber os avisos de interessados? Se preferir configurar depois, responda "depois".';
 return '';
}
const steps=['company','audience','services','service_detail','service_price','region','process','qualify','style','objections','handoff','restrictions','notification'];
const stepsBase=11;
function progress(state){
 const n=steps.indexOf(state.key);
 const services=state.data?.services?.length||1;
 const total=stepsBase+services*2;
 let done=state.phase==='review'?total:Math.max(0,n<=2?n:n-5+services*2);
 if(state.key==='service_detail')done=3+(state.index||0)*2;
 if(state.key==='service_price')done=4+(state.index||0)*2;
 if(['region','process','qualify','style','objections','handoff','restrictions','notification'].includes(state.key)){
  done=3+services*2+['region','process','qualify','style','objections','handoff','restrictions','notification'].indexOf(state.key);
 }
 return Math.min(100,Math.max(0,Math.round(done/Math.max(1,total)*100)));
}
const publicState=s=>s?{
 mode:s.mode,phase:s.phase,question:s.phase==='active'?question(s):'',
 messages:s.messages||[],progress:progress(s),serviceCount:s.data?.services?.length||0,
 completed:s.phase==='review',startedAt:s.startedAt
}:null;
export const trainingInterviewStatus=()=>publicState(getSetting(KEY,null));
export function startTrainingInterview(mode='text'){
 const prior=getSetting('training_draft',null);
 if(prior?.source==='interview'){setSetting('training_draft',null);removeTrainingMarkdown('draft');}
 if(!['text','voice'].includes(mode))throw Error('Escolha treinamento escrito ou por voz.');
 const q={version:1,mode,phase:'active',key:'company',index:0,data:{services:[]},messages:[],startedAt:now()};
 q.messages.push({role:'assistant',body:question(q),at:now()});
 setSetting(KEY,q);
 return publicState(q);
}
export function resetTrainingInterview(){setSetting(KEY,null);const draft=getSetting('training_draft',null);if(draft?.source==='interview'){setSetting('training_draft',null);removeTrainingMarkdown('draft');}return null;}
const safeValue=(v,limit=800)=>clean(v,limit);
// Built from the interview's structured answers, never from another tenant.
export function buildTrainingMarkdown(data){
 const lines=[
 '# Manual de atendimento — Francisca',
 '',
 '> Documento de treinamento preparado para revisão. Só utilizar após aprovação explícita.',
 '',
 '## Identidade da empresa',
 '- **Nome:** '+(data.company||'Não informado'),
 '- **Público-alvo:** '+(data.audience||'Não informado'),
 '- **Regiões atendidas:** '+(data.region||'Não informado'),
 '',
 '## Serviços, entregas e preços aprovados',
 ...((data.services||[]).flatMap((service,index)=>[
  '### '+(index+1)+'. '+service.name,
  '- **O que inclui, modalidades e prazos:** '+(service.detail||'Não informado'),
  '- **Valor permitido na conversa:** '+(service.price||'Não autorizado informar; encaminhar para orçamento'),
  ''
 ])),
 '## Fluxo comercial',
 '- **Como contratar:** '+(data.process||'Não informado'),
 '- **Perguntas de qualificação:** '+(data.qualify||'Não informado'),
 '- **Estilo da conversa:** '+(data.style||'Não informado'),
 '- **Respostas a objeções e pedidos de portfólio:** '+(data.objections||'Não informado'),
 '',
 '## Quando acionar um responsável',
 '- **Situações de encaminhamento:** '+(data.handoff||'Não informado'),
 '- **WhatsApp para notificações:** '+(data.notification||'A configurar'),
 '',
 '## Limites e segurança',
 '- **Condições que exigem autorização:** '+(data.restrictions||'Não informado'),
 '- Não inventar preços, garantias, resultados, prazos, entregáveis ou descontos.',
 '- Quando um serviço ou condição não estiver explicitamente descrito, consultar o responsável.',
 '- Respeitar recusas, pedidos de remoção e solicitações de atendimento humano.',
 '- **Só responder automaticamente contatos que receberam uma abordagem confirmada do Prospector neste mesmo espaço.**',
 '- O treinamento não autoriza envios, mudança de campanha nem acesso a outros clientes.',
 '- As regras legais e operacionais do Prospector têm prioridade sobre este documento.',
 ''
 ];
 return lines.join('\n').slice(0,9000);
}

export function advanceTrainingInterview(text){
 const state=getSetting(KEY,null);
 if(!state||state.phase!=='active')throw Error('Inicie o treinamento selecionando texto ou voz.');
 const user=safeValue(text,850);if(user.length<2)throw Error('Conte um pouco mais para eu continuar.');
 if((state.messages||[]).length>=80)throw Error('Limite de treinamento atingido. Revise o perfil atual.');
 const key=state.key,data=state.data,index=state.index||0;
 if(key==='company')data.company=user;
 else if(key==='audience')data.audience=user;
 else if(key==='services'){
  const services=splitServices(user);if(!services.length)throw Error('Informe pelo menos um serviço que você oferece.');
  data.services=services;
 }else if(key==='service_detail')data.services[index].detail=user;
 else if(key==='service_price')data.services[index].price=user;
 else data[key]=user;
 state.messages.push({role:'user',body:user,at:now()});
 if(key==='company')state.key='audience';
 else if(key==='audience')state.key='services';
 else if(key==='services'){state.key='service_detail';state.index=0;}
 else if(key==='service_detail')state.key='service_price';
 else if(key==='service_price'){
  if(index+1<data.services.length){state.key='service_detail';state.index=index+1;}
  else state.key='region';
 }else{
  const following={region:'process',process:'qualify',qualify:'style',style:'objections',objections:'handoff',handoff:'restrictions',restrictions:'notification',notification:'done'};
  state.key=following[key]||'done';
 }
 if(state.key==='done'){
  const profileText=buildTrainingMarkdown(data);
  const artifact=storeTrainingMarkdown('draft',profileText);
  state.phase='review';
  state.messages.push({role:'assistant',body:'Perfeito! Preparei seu perfil de atendimento. Leia os serviços, os preços e as regras antes de clicar em Aprovar e ativar. Nada foi ativado automaticamente.',at:now()});
  setSetting('training_draft',{id:crypto.randomUUID(),source:'interview',filename:artifact.filename,interviewData:{company:data.company,audience:data.audience},at:now()});
 }else{
  state.messages.push({role:'assistant',body:question(state),at:now()});
 }
 setSetting(KEY,state);
 return publicState(state);
}
