// Francisca's tenant-scoped, review-before-activation onboarding interview.
// Deterministic question order with adaptive per-service branches; the model never
// grants permissions, invents prices or activates the profile automatically.
import crypto from 'node:crypto';
import {getSetting,setSetting,now} from './db.mjs';
import {storeTrainingMarkdown,removeTrainingMarkdown} from './training-markdown.mjs';

const KEY='francisca_training_interview_v1';

const APPROACH_OPTIONS=Object.freeze([
 {id:'permission',label:'Permissão primeiro',description:'Cumprimento curto e pergunta se pode explicar o trabalho.',
  template:'Olá, {{nome}}, tudo bem? Sou a Francisca, assistente virtual da {{empresa}}. Posso te explicar brevemente o motivo do contato?'},
 {id:'direct',label:'Direta e objetiva',description:'Apresenta o serviço de forma transparente e verifica se faz sentido.',
  template:'Olá, {{nome}}! Sou a Francisca, assistente virtual da {{empresa}}. Trabalhamos com {{servico}}. Faz sentido te contar um pouco mais?'},
 {id:'consultative',label:'Consultiva',description:'Começa com uma pergunta simples para entender a necessidade.',
  template:'Olá, {{nome}}! Sou a Francisca, assistente virtual da {{empresa}}. Posso te fazer uma pergunta rápida sobre o que você busca melhorar no seu negócio?'},
 {id:'friendly',label:'Leve e próxima',description:'Uma apresentação cordial, sem forçar uma proposta.',
  template:'Oi, {{nome}}, tudo bem? Aqui é a Francisca, assistente virtual da {{empresa}}. Posso te contar rapidamente sobre o que fazemos?'},
 {id:'custom',label:'Minha abordagem personalizada',description:'Escreva ou dite a primeira mensagem do seu jeito, com revisão antes de ativar.'}
]);
const approachOption=(input)=>{
 const value=normalized(input).replace(/[.!,?]+$/g,'');
 if(!value)return null;
 const exact=APPROACH_OPTIONS.find(o=>value===normalized(o.id)||value===normalized(o.label));
 if(exact)return exact;
 const numbers=/^(?:(?:opcao|opcoes|numero|alternativa|quero a|a)\s*)?([1-5])$/.exec(value);
 if(numbers)return APPROACH_OPTIONS[Number(numbers[1])-1];
 const words=['primeira','primeiro','segunda','segundo','terceira','terceiro','quarta','quarto','quinta','quinto'];
 const ordinal=words.findIndex(w=>new RegExp('\\b'+w+'\\b').test(value));
 if(ordinal>=0)return APPROACH_OPTIONS[Math.floor(ordinal/2)];
 const cardinal=['um','dois','tres','quatro','cinco'];
 const named=cardinal.findIndex(w=>new RegExp('\\b'+w+'\\b').test(value));
 if(named>=0)return APPROACH_OPTIONS[named];
 if(/\b(?:personalizada|personalizado|propria|meu jeito|do meu jeito)\b/.test(value))return APPROACH_OPTIONS[4];
 if(/\b(?:permissao|pedir permissao)\b/.test(value))return APPROACH_OPTIONS[0];
 if(/\b(?:direta|objetiva)\b/.test(value))return APPROACH_OPTIONS[1];
 if(/\b(?:consultiva|pergunta)\b/.test(value))return APPROACH_OPTIONS[2];
 if(/\b(?:leve|proxima|amigavel|descontraida)\b/.test(value))return APPROACH_OPTIONS[3];
 return null;
};

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
 if(key==='social_proof')return 'Quais provas sociais e portfólios você quer usar? Você pode anexar imagens, PDFs ou links aqui no chat, descrever os trabalhos e, quando terminar, escrever ou dizer "pronto". Se não tiver materiais, responda "não tenho".';
 if(key==='handoff')return 'Em quais situações eu devo parar de responder e avisar você? Por exemplo: pedido de proposta, cliente interessado ou negociação de preço.';
 if(key==='restrictions')return 'Existe alguma promessa, desconto, serviço ou condição que eu nunca devo oferecer sem sua aprovação?';
 if(key==='notification')return 'Para qual WhatsApp você quer receber avisos? Se preferir configurar depois, responda "depois". Depois vamos definir até onde posso negociar por você.';
 if(key==='closing_mode')return 'Quando um cliente tiver interesse, o que você prefere? 1: eu aviso você e transfiro a conversa para você fechar; ou 2: eu continuo, faço a proposta, explico o pagamento aprovado e acompanho o comprovante. Nenhuma opção significa pagamento confirmado automaticamente.';
 if(key==='payment_methods')return 'Quais formas de pagamento sua empresa aceita? Pode escolher PIX, cartão, transferência, boleto, ou combinar. A chave PIX deve ser cadastrada separadamente no campo protegido do painel, nunca ditada por voz.';
 if(key==='payment_terms')return 'Que porcentagem do valor deve ser paga de entrada? Por exemplo, 50% de entrada e 50% na entrega. Digite só o número, de 0 a 100, ou diga "cinquenta".';
 if(key==='approach')return 'Agora a última decisão: como você prefere que eu faça a primeira abordagem? Temos cinco opções: 1, pedir permissão primeiro; 2, direta e objetiva; 3, consultiva, com uma pergunta; 4, leve e próxima; ou 5, personalizada, do seu jeito. Você pode selecionar um botão, escrever ou dizer o número da opção.';
 if(key==='approach_custom')return 'Me conte exatamente como você quer a primeira mensagem. Pode ditar ou escrever, com até 420 caracteres. Para personalizar cada envio, use os campos {{nome}}, {{empresa}} e {{servico}}. Vamos salvar no seu Markdown para você revisar antes de ativar.';
 return '';
}
const steps=['company','audience','services','service_detail','service_price','region','process','qualify','style','objections','social_proof','handoff','restrictions','notification','closing_mode','payment_methods','payment_terms','approach','approach_custom'];
const stepsBase=14;
function progress(state){
 const count=state.data?.services?.length||1;
 const tenant=Boolean(process.env.PROSPECTOR_TENANT_ID);
 const custom=state.data?.approachMode==='custom'?1:0;
 const payment=state.data?.closingMode==='complete'?2:0;
 const total=stepsBase+2*count+(tenant?1+custom+payment:0);
 if(state.phase==='review')return 100;
 const k=state.key;
 let done=0;
 if(k==='company')done=0;
 else if(k==='audience')done=1;
 else if(k==='services')done=2;
 else if(k==='service_detail')done=3+(state.index||0)*2;
 else if(k==='service_price')done=4+(state.index||0)*2;
 else if(['region','process','qualify','style','objections','social_proof','handoff','restrictions','notification','closing_mode','payment_methods','payment_terms'].includes(k))
  done=3+2*count+['region','process','qualify','style','objections','social_proof','handoff','restrictions','notification','closing_mode','payment_methods','payment_terms'].indexOf(k);
 else if(k==='approach')done=14+2*count;
 else if(k==='approach_custom')done=15+2*count;
 return Math.max(0,Math.min(99,Math.round(done/Math.max(total,1)*100)));
}
const publicState=s=>s?{
 mode:s.mode,phase:s.phase,step:s.key,
 question:s.phase==='active'?question(s):'',
 choices:s.phase==='active'&&s.key==='approach'&&process.env.PROSPECTOR_TENANT_ID?
   APPROACH_OPTIONS.map(({id,label,description})=>({id,label,description})):[],
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
 '- **Portfólio e provas sociais:** '+(data.social_proof||'Consulte a biblioteca privada de materiais aprovados.'),
 '',
 ...(data.approach?[
  '## Estratégia de primeira abordagem',
  '- **Código da estratégia:** '+data.approach.mode,
  '- **Estilo selecionado:** '+data.approach.label,
  '- **Mensagem inicial aprovada:** '+data.approach.template,
  '- **Variáveis permitidas:** {{nome}}, {{empresa}}, {{servico}} (somente dados conferidos desta empresa).',
  '- **Uso:** somente contatos elegíveis, autorizados e com consentimento aplicável. Esta escolha não ativa disparos nem altera a política de contato.',
  ''
 ]:[]),
 '## Política de fechamento e pagamentos',
 '- **Modo escolhido:** '+(data.closingMode==='complete'?'complete — Francisca pode conduzir o fechamento':'handoff — transferir ao gestor quando houver interesse'),
 '- **Meios de pagamento:** '+((data.paymentMethods||[]).join(', ')||'Configurar separadamente'),
 '- **Entrada combinada:** '+(Number.isInteger(data.depositPercent)?data.depositPercent+'%':'Não definida'),
 '- **Saldo na entrega:** '+(Number.isInteger(data.depositPercent)?(100-data.depositPercent)+'%':'Não definido'),
 '- **Chave PIX:** Somente no cadastro protegido da empresa; não inserir a chave neste documento e nunca inventar dados bancários.',
 '- **Comprovantes:** documento recebido não é confirmação bancária; não iniciar serviço nem marcar venda como paga até conciliação confiável.',
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
 const result=lines.join('\n');
 if(result.length>9000)throw Error('Treinamento muito extenso. Resuma algumas respostas antes de aprovar.');
 return result;
}

export function advanceTrainingInterview(text){
 const state=getSetting(KEY,null);
 if(!state||state.phase!=='active')throw Error('Inicie o treinamento selecionando texto ou voz.');
 const user=safeValue(text,850);if(user.length<2&&!(['approach','closing_mode','payment_methods'].includes(state.key)&&/^[1-5]$/.test(user)))throw Error('Conte um pouco mais para eu continuar.');
 if((state.messages||[]).length>=80)throw Error('Limite de treinamento atingido. Revise o perfil atual.');
 const key=state.key,data=state.data,index=state.index||0;
 if(key==='company')data.company=user.slice(0,120);
 else if(key==='audience')data.audience=user.slice(0,300);
 else if(key==='services'){
  const services=splitServices(user);if(!services.length)throw Error('Informe pelo menos um serviço que você oferece.');
  data.services=services;
 }else if(key==='service_detail')data.services[index].detail=user.slice(0,250);
 else if(key==='service_price')data.services[index].price=user.slice(0,180);
 else if(key==='closing_mode'){
  const raw=normalized(user);
  if(/^(?:2|dois|segunda|segundo|complete|fechar|completo)$/.test(raw)||/ate o pagamento|fechamento inteiro|fazer tudo/.test(raw))data.closingMode='complete';
  else if(/^(?:1|um|primeira|primeiro|handoff|transferir|avisar)$/.test(raw)||/encaminhar|avisar.*responsavel|passar.*dono/.test(raw))data.closingMode='handoff';
  else throw Error('Escolha 1 (avisar e transferir) ou 2 (conduzir fechamento).');
 }else if(key==='payment_methods'){
  const raw=normalized(user);
  data.paymentMethods=[...new Set([/pix/.test(raw)?'pix':null,/cartao|credito|debito/.test(raw)?'card':null,/transferencia|ted/.test(raw)?'transfer':null,/boleto/.test(raw)?'invoice':null].filter(Boolean))];
  if(!data.paymentMethods.length)throw Error('Informe PIX, cartão, transferência ou boleto.');
 }else if(key==='payment_terms'){
  const value=/^(?:cinquenta|meio a meio|metade)$/.test(normalized(user))?50:Number(user.replace('%','').trim());
  if(!Number.isInteger(value)||value<0||value>100)throw Error('Informe uma porcentagem inteira de 0 a 100.');
  data.depositPercent=value;
 }
 else if(key==='approach'){
  const option=approachOption(user);
  // A free-form explanation means the user wants to write a custom opening.
  const mode=option?.id||'custom';
  data.approachMode=mode;
  if(mode!=='custom')data.approach={mode,label:option.label,template:option.template};
 }else if(key==='approach_custom'){
  if(user.length>420)throw Error('Sua primeira mensagem pode ter no máximo 420 caracteres. Resuma para continuar.');
  const template=user;
  if(template.length<12)throw Error('Descreva a primeira mensagem com pelo menos 12 caracteres.');
  data.approach={mode:'custom',label:'Minha abordagem personalizada',template};
 }else data[key]=user.slice(0,300);
 state.messages.push({role:'user',body:user,at:now()});
 if(key==='company')state.key='audience';
 else if(key==='audience')state.key='services';
 else if(key==='services'){state.key='service_detail';state.index=0;}
 else if(key==='service_detail')state.key='service_price';
 else if(key==='service_price'){
  if(index+1<data.services.length){state.key='service_detail';state.index=index+1;}
  else state.key='region';
  }else if(key==='notification')state.key='closing_mode';
 else if(key==='closing_mode')state.key=data.closingMode==='complete'?'payment_methods':(process.env.PROSPECTOR_TENANT_ID?'approach':'done');
 else if(key==='payment_methods')state.key='payment_terms';
 else if(key==='payment_terms')state.key=process.env.PROSPECTOR_TENANT_ID?'approach':'done';
 else if(key==='approach')state.key=data.approachMode==='custom'?'approach_custom':'done';
 else if(key==='approach_custom')state.key='done';
 else{
  const following={region:'process',process:'qualify',qualify:'style',style:'objections',objections:'social_proof',social_proof:'handoff',handoff:'restrictions',restrictions:'notification'};
  state.key=following[key]||'done';
 }
 if(state.key==='done'){
  const profileText=buildTrainingMarkdown(data);
  const artifact=storeTrainingMarkdown('draft',profileText);
  state.phase='review';
  state.messages.push({role:'assistant',body:'Perfeito! Preparei seu perfil de atendimento. Leia os serviços, os preços e as regras antes de clicar em Aprovar e ativar. Nada foi ativado automaticamente.',at:now()});
  setSetting('training_draft',{id:crypto.randomUUID(),source:'interview',filename:artifact.filename,interviewData:{company:data.company,audience:data.audience,closingMode:data.closingMode,paymentMethods:data.paymentMethods||[],depositPercent:data.depositPercent},at:now()});
 }else{
  state.messages.push({role:'assistant',body:question(state),at:now()});
 }
 setSetting(KEY,state);
 return publicState(state);
}
