// Preview visual em memória: nenhum contato real, backend, credencial ou rede externa.
const leads=[
 ['Aurora Odontologia','Ana','CONTACTED','clinica.aurora','Odontologia','Sorocaba','NO_WEBSITE','web_search'],
 ['Studio Belle','Marina','CONTACTED','studiobelle','Estética','Campinas','UNCERTAIN','web_search'],
 ['Arqui Formas','Paulo','CONTACTED','arquiformas','Arquitetura','Votorantim','NO_WEBSITE','instagram_search'],
 ['Clínica Mover','Helena','REPLIED','clinicamover','Fisioterapia','Sorocaba','NO_WEBSITE','web_search'],
 ['Nutri Vida','Camila','REPLIED','nutrivida','Nutrição','Campinas','NO_WEBSITE','web_search'],
 ['Ateliê Novo','Marta','REPLIED','atelienovo','Designer','São Paulo','UNCERTAIN','instagram_hashtags'],
 ['Consultório Horizonte','Rafael','NO_INTEREST','psihorizonte','Psicologia','Sorocaba','UNCERTAIN','web_search'],
 ['Lumi Contabilidade','Carla','NO_INTEREST','lumicontabilidade','Contabilidade','Campinas','NO_WEBSITE','web_search'],
 ['Clínica Harmonia','Fernanda','INTERESTED','harmonia.clinica','Estética','Sorocaba','NO_WEBSITE','web_search'],
 ['Avante Engenharia','Lucas','INTERESTED','avanteengenharia','Engenharia','Votorantim','NO_WEBSITE','meta_ads'],
 ['Odonto São José','Julia','INTERESTED','odonto.saojose','Odontologia','São Paulo','NO_WEBSITE','web_search'],
 ['Amor Pet','Patricia','DISCOVERED','amorpet','Veterinária','Sorocaba','UNCERTAIN','web_search'],
 ['Espaço Florescer','Bruna','DISCOVERED','espacoflorescer','Terapia','Campinas','UNCERTAIN','instagram_related'],
 ['Giro Fitness','Pedro','DISCOVERED','girofitness','Personal trainer','Itu','NO_WEBSITE','web_search'],
 ['Studio Arte','Livia','DISCOVERED','studioarte','Fotografia','Sorocaba','UNCERTAIN','web_search'],
 ['Vitta Pilates','Bianca','DISCOVERED','vittapilates','Pilates','Votorantim','UNCERTAIN','web_search']
].map((v,i)=>({id:'lead-'+i,business:v[0],name:v[1],stage:v[2],instagram:v[3],segment:v[4],city:v[5],website_status:v[6],source:v[7],origins:[v[7]],phone:'55 15 9XXXX-'+String(1000+i),score:[9,5,6,10,10,4,5,3,11,12,11,2,3,7,4,2][i],contact_permission:0,created_at:new Date(Date.now()-(i+1)*7000000).toISOString(),last_activity_at:new Date(Date.now()-(i+1)*920000).toISOString(),website:null}));
const threads=leads.filter(x=>!['DISCOVERED'].includes(x.stage)).map((l,i)=>({id:'thread-'+i,lead_id:l.id,business:l.business,name:l.name,phone:l.phone,stage:l.stage,unread_count:l.stage==='INTERESTED'?1:0,manual_takeover:0,last_message_at:new Date(Date.now()-i*900000).toISOString()}));
const messages={};
for(const t of threads){const l=leads.find(x=>x.id===t.lead_id);messages[t.id]=[{id:t.id+'-1',type:'text',body:'Olá, '+l.name+'! Tudo bem? Vi o trabalho da '+l.business+' e queria apresentar uma ideia.',direction:'out',status:'sent',at:new Date(Date.now()-15000000).toISOString()},{id:t.id+'-2',type:'text',body:l.stage==='INTERESTED'?'Oi! Gostei. Pode me explicar melhor como funciona?':l.stage==='NO_INTEREST'?'Obrigado, mas não tenho interesse no momento.':'Oi, tudo bem sim. Pode falar!',direction:'in',status:'received',at:new Date(Date.now()-1600000).toISOString()}];}
const settings={owner_phone_a:'',owner_phone_b:'',owner_notifications_enabled:false,owner_report_hour:20,paused:true,auto_initial:false,min_minutes:5,daily_limit:96,business_start:8,business_end:21,automation_enabled:true,segments:'Psicologia, Estética, Odontologia, Arquitetura, Engenharia',cities:'Sorocaba, Votorantim, Campinas, São Paulo',discovery_sources:{web_search:true,meta_ads:false,instagram_search:false,instagram_hashtags:false,instagram_related:false},discovery_priority:'no_website',discovery_brazil_wide:false,score_weights:{noWebsite:4,activeAd:3,publicWhatsapp:2,activeBusiness:2,prioritySegment:2,location:1,businessName:1}};
let workflows=[
 {id:'default',name:'Abordagem geral',is_default:1,enabled:true,segments:[],version:1,steps:[
  {id:'g1',type:'message',text:'Olá, {{business_name}}! Posso te mostrar um exemplo visual de como poderia ficar seu site?'},
  {id:'g2',type:'wait_reply'},
  {id:'g3',type:'decision',context:'sample_offer',context_description:'Perguntei se gostaria de um exemplo gratuito da página.',yes_type:'message',yes_text:'Que legal! Vou criar uma prévia para te mostrar. A meta é até 10 minutos.',yes_action:'request_sample',no_type:'message',no_text:'Sem problema! Obrigado pelo seu tempo.',no_action:'end'},
  {id:'g4',type:'end'}]},
 {id:'psicologia-demo',name:'Psicólogos · convite discreto',is_default:0,enabled:true,segments:['Psicologia'],version:1,steps:[
  {id:'p1',type:'message',text:'Olá, {{first_name}}! Posso enviar uma prévia profissional da sua página?'},
  {id:'p2',type:'wait_reply'},
  {id:'p3',type:'decision',context:'sample_offer',context_description:'Pergunta sobre uma página personalizada.',yes_type:'audio',yes_media_id:'audio-demo',yes_audio_description:'Agradecimento pelo aceite e aviso de que será preparada uma prévia visual em cerca de dez minutos.',yes_action:'request_sample',no_type:'message',no_text:'Tudo bem! Fico à disposição.',no_action:'end'},
  {id:'p4',type:'end'}]}
];
let media=[{id:'video-demo',name:'Apresentação Consecom.mp4 (exemplo)',kind:'video',mime:'video/mp4',duration:49,bytes:4200000},{id:'audio-demo',name:'Mensagem comercial.ogg (exemplo)',kind:'audio',mime:'audio/ogg',duration:24,bytes:190000}];
let meetings=[{id:'m1',lead_id:'lead-8',business:'Clínica Harmonia',name:'Fernanda',start_at:new Date(Date.now()+86400000).toISOString(),status:'SCHEDULED',notes:'Entender serviços e necessidade do site'},{id:'m2',lead_id:'lead-9',business:'Avante Engenharia',name:'Lucas',start_at:new Date(Date.now()+172800000).toISOString(),status:'SCHEDULED',notes:'Apresentar proposta inicial'}];
const providers=[{id:'meta_ads',label:'Biblioteca de Anúncios',status:'NOT_IMPLEMENTED',note:'Depende de integração e permissões oficiais.'},{id:'instagram_search',label:'Pesquisa direta no Instagram',status:'NOT_IMPLEMENTED',note:'API de busca geral não integrada.'},{id:'instagram_hashtags',label:'Hashtags',status:'NOT_IMPLEMENTED',note:'Permissões oficiais pendentes.'},{id:'instagram_related',label:'Perfis relacionados',status:'NOT_IMPLEMENTED',note:'Recurso ainda não integrado.'},{id:'web_search',label:'Pesquisa web complementar',status:'NEEDS_API_KEY',note:'Brave Search em produção local quando configurado.'}];

leads.push({id:'lead-wrs-demo',business:'WRS Reformas e Manutenções',name:'Contato demonstrativo',phone:'55••••••••••',instagram:'wrs_brasil',city:'Sorocaba',segment:'Reformas',stage:'INTERESTED',website_status:'UNCERTAIN',contact_permission:0,source:'DEMO',created_at:new Date().toISOString()});
const production=[
 {id:'demo-req-1',lead_id:'lead-8',business:'Clínica Harmonia',instagram:'harmonia.clinica',city:'Sorocaba',segment:'Estética',status:'REQUESTED',accepted_at:new Date().toISOString(),due_at:new Date(Date.now()+600000).toISOString()},
 {id:'demo-req-2',lead_id:'lead-9',business:'Avante Engenharia',instagram:'avanteengenharia',city:'Votorantim',segment:'Engenharia',status:'IN_PROGRESS',accepted_at:new Date().toISOString(),due_at:new Date(Date.now()+600000).toISOString()},
 {id:'demo-req-3',lead_id:'lead-wrs-demo',business:'WRS Reformas e Manutenções',instagram:'wrs_brasil',city:'Sorocaba',segment:'Reformas',status:'READY',accepted_at:new Date().toISOString(),site_url:'https://prospector-ui-production.up.railway.app/studio/sites/wrs-brasil.html'}
];
const report={day:'DEMONSTRAÇÃO',approached:12,responded:6,interested:3,notInterested:2,requested:2,closed:1};

const jobLogs=[];
let counter=100;
const output=(data,status=200)=>Promise.resolve(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}));
const route=(u)=>u.pathname.replace(/\/$/,'');
const nativeFetch=window.fetch.bind(window);
window.fetch=async (path,opts={})=>{
 const u=new URL(path,location.href);if(!u.pathname.startsWith('/api/'))return nativeFetch(path,opts);
 const p=route(u);const method=opts.method||'GET';
 let v={};try{v=opts.body&&typeof opts.body==='string'?JSON.parse(opts.body):{};}catch{}
 if(p==='/api/state'){
  const count=s=>leads.filter(x=>x.stage===s).length;
  return output({isPreview:true,production,report,leads,threads,workflows,media,meetings,providers,settings,jobs:jobLogs,discoveries:[],searchConfigured:false,connection:{status:'DISCONNECTED',qr:null,error:'Prévia visual — conecte seu WhatsApp apenas na instalação local.'},stats:{profiles_analyzed:134,found:leads.length,without_site:leads.filter(x=>x.website_status==='NO_WEBSITE').length,qualified:leads.filter(x=>x.website_status==='NO_WEBSITE').length,contacted:leads.filter(x=>x.stage!=='DISCOVERED').length,responded:count('REPLIED')+count('NO_INTEREST')+count('INTERESTED'),interested:count('INTERESTED'),meetings:meetings.filter(x=>x.status==='SCHEDULED').length}});
 }
 let m=p.match(/^\/api\/threads\/([^/]+)\/messages$/);
 if(m)return output(messages[m[1]]||[]);
 m=p.match(/^\/api\/threads\/ensure\/([^/]+)$/);
 if(m){let t=threads.find(x=>x.lead_id===m[1]);if(!t){const l=leads.find(x=>x.id===m[1]);t={id:'thread-'+counter++,lead_id:l.id,business:l.business,name:l.name,phone:l.phone,stage:l.stage,manual_takeover:0,unread_count:0};threads.unshift(t);messages[t.id]=[];}return output(t);}
 m=p.match(/^\/api\/threads\/([^/]+)\/(read|takeover)$/);
 if(m){const t=threads.find(x=>x.id===m[1]);if(t)t[m[2]==='read'?'unread_count':'manual_takeover']=m[2]==='read'?0:(v.value?1:0);return output({ok:true});}
 m=p.match(/^\/api\/leads\/([^/]+)\/(stage|permission|update|messages|verify-site)$/);
 if(m){
  const l=leads.find(x=>x.id===m[1]);if(!l)return output({error:'Lead não encontrado'},404);
  if(m[2]==='verify-site')return output({leadId:l.id,status:'NEEDS_REVIEW',candidates:[],explanation:'Prévia visual'});
  if(m[2]==='stage'){l.stage=v.stage;const t=threads.find(x=>x.lead_id===l.id);if(t)t.stage=v.stage;}
  if(m[2]==='permission')l.contact_permission=v.value?1:0;
  if(m[2]==='update')Object.assign(l,v);
  if(m[2]==='messages'){const t=threads.find(x=>x.lead_id===l.id);if(t)messages[t.id].push({id:'msg-'+counter++,direction:'out',type:'text',body:v.text,status:'simulated',at:new Date().toISOString()});}
  return output({ok:true});
 }
 if(p==='/api/leads'&&method==='POST'){const l={id:'lead-'+counter++,business:v.business||'Novo prospect',name:v.name||'',phone:v.phone||'',instagram:v.instagram||'',city:v.city||'',segment:v.segment||'',stage:'DISCOVERED',website_status:v.website_status||'UNCERTAIN',source:'MANUAL',origins:['MANUAL'],score:0,contact_permission:v.contact_permission?1:0,created_at:new Date().toISOString()};leads.unshift(l);return output({lead:l,created:true},201);}
 if(p.match(/^\/api\/production\/brief\/[^/]+$/)){
  const leadId=p.split('/')[4],l=leads.find(x=>x.id===leadId),pr=production.find(x=>x.lead_id===leadId);
  if(!l)return output({error:'Lead não encontrado'},404);
  return output({job_reference:pr?.id,company:l.business,instagram:'https://instagram.com/'+l.instagram,category:l.segment,city:l.city,notes:'BRIEFING DEMONSTRATIVO — sem dados pessoais reais',instructions:'Crie landing premium e publique no Site Studio com production_ref igual a job_reference. Não envie ao cliente.'});
 }
 if(p==='/api/production/move'&&method==='POST'){
  const x=production.find(x=>x.lead_id===v.lead_id);if(!x)return output({error:'Pedido não encontrado'},404);
  const permitted={REQUESTED:['IN_PROGRESS'],IN_PROGRESS:['READY']};if(!permitted[x.status]?.includes(v.status))return output({error:'Transição não permitida'},400);
  if(v.status==='READY'&&!/^https:\/\/prospector-ui-production\.up\.railway\.app\/studio\/sites\/[a-z0-9-]+\.html$/.test(v.site_url||''))return output({error:'Informe URL válida do Site Studio'},400);
  x.status=v.status;if(v.site_url)x.site_url=v.site_url;return output(x);
 }
 if(p==='/api/production/approve'&&method==='POST'){
  const x=production.find(x=>x.lead_id===v.lead_id);if(!x||x.status!=='READY')return output({error:'Ainda não está pronto'},400);
  x.status='SEND_QUEUED';return output({...x,simulated:true});
 }
 if(p==='/api/production/accept'&&method==='POST'){
  const x=production.find(x=>x.lead_id===v.lead_id);if(!x||!['OFFER_SENT','NEEDS_REVIEW'].includes(x.status))return output({error:'Nenhuma oferta pendente'},400);
  x.status='REQUESTED';return output(x);
 }
 if(p==='/api/production/close'&&method==='POST'){
  const x=production.find(x=>x.lead_id===v.lead_id);if(x?.status!=='DELIVERED')return output({error:'Sem entrega confirmada'},400);
  report.closed++;return output({ok:true});
 }
 if(p==='/api/production/offer'&&method==='POST')return output({error:'Prévia fictícia: não há envio real de áudio'},400);
 if(p==='/api/settings'&&method==='POST'){Object.assign(settings,v);return output({ok:true});}
 if(p==='/api/workflows'&&method==='POST'){const wf=workflows.find(x=>x.id===v.id);if(wf)Object.assign(wf,{name:v.name,steps:v.steps,segments:v.segments||[],enabled:v.enabled!==false,version:wf.version+1});else workflows.push({id:'wf-'+counter++,name:v.name,steps:v.steps,segments:v.segments||[],enabled:v.enabled!==false,is_default:0,version:1});return output({id:wf?.id||workflows[workflows.length-1].id});}
 if(p==='/api/automations/test'&&method==='POST'){const s=String(v.text||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();const no=/\b(?:nao|sem interesse|dispenso|agora nao|nao quero)\b/.test(s);const yes=/^(sim|pode|pode sim|claro|manda|quero|quero ver|pode mandar|ok|pode ser)[.!? ]*$/.test(s)||/quero.{0,30}(?:previa|exemplo|site)/.test(s);return output({decision:no?'NO':yes?'YES':'REVIEW',reason:'Prévia demonstrativa'});}
 if(p==='/api/workflows/default'){workflows.forEach(x=>x.is_default=x.id===v.id?1:0);return output({ok:true});}
 if(p.startsWith('/api/workflows/start/'))return output({error:'Prévia visual: fluxos não enviam mensagens reais'},400);
 if(p==='/api/connect'||p==='/api/disconnect')return output({status:'DISCONNECTED',error:'Prévia visual sem conexão real'});
 if(p==='/api/discover')return output({error:'Prévia visual: descoberta real disponível somente no servidor local configurado'},400);
 if(p==='/api/import')return output({created:0,duplicates:0,errors:['Importação não habilitada nesta prévia']});
 if(p==='/api/media'&&method==='POST'){const newAsset={id:'media-'+counter++,name:u.searchParams.get('name')||'Nova mídia',kind:u.searchParams.get('kind'),mime:opts.headers?.['Content-Type']||'video/mp4',bytes:opts.body?.size||0,duration:opts.body?.duration||30};media.unshift(newAsset);return output(newAsset,201);}
 if(p==='/api/meetings'&&method==='POST'){const l=leads.find(x=>x.id===v.lead_id);meetings.push({id:'mt-'+counter++,business:l?.business||'Cliente',name:l?.name||'',status:'SCHEDULED',...v});return output({ok:true});}
 if(p.match(/^\/api\/meetings\/[^/]+\/cancel$/)){const id=p.split('/')[3];const m=meetings.find(x=>x.id===id);if(m)m.status='CANCELLED';return output({ok:true});}
 return output({error:'Operação indisponível nesta prévia.'},400);
};
window.EventSource=class{addEventListener(){} close(){} set onerror(fn){} };
