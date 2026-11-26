// Flow library is deliberately independent of the live dispatch engine.
// Internal workspace is a read-only reference, not a second executable flow.
import {db,all,one,run,now,id,tx,getSetting} from './db.mjs';
import {WESLEY_INTRO,INTRO_DELAY_MS,PITCH_PREVIEW_DELAY_MS,PITCH_PREVIEW_TEXT} from './prospecting-introduction.mjs';
import {PITCH_AUDIO_OFFER_BRL,PITCH_AUDIO_SECONDS} from './portfolio-pitch-audio.mjs';
import {prospectingWindowLabel} from './outreach-window.mjs';
import {assignVariant,newExecution,reduceExecution} from './flow-engine.mjs';
import {liveFlowSupported,setLiveRoute} from './flow-runtime.mjs';
const isInternal=()=>!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true';
const kinds=new Set(['text','audio','video','image','document','reply','delay','condition','ai','handoff']);
const sending=new Set(['text','audio','video','image','document']);
const clean=(v,n)=>String(v??'').trim().slice(0,n);
const uid=v=>/^[a-zA-Z0-9_-]{1,80}$/.test(String(v||''));
function init(){
 db.exec("CREATE TABLE IF NOT EXISTS flow_projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,niche TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',draft TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,published_version INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
 db.exec("CREATE TABLE IF NOT EXISTS flow_project_versions(project_id TEXT NOT NULL REFERENCES flow_projects(id),version INTEGER NOT NULL,definition TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,version))");
}
function initSimulation(){
 init();
 db.exec("CREATE TABLE IF NOT EXISTS flow_simulations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,version INTEGER NOT NULL,definition TEXT NOT NULL,execution TEXT NOT NULL,clock INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
 db.exec("CREATE TABLE IF NOT EXISTS flow_simulation_variants(project_id TEXT NOT NULL,version INTEGER NOT NULL,step_id TEXT NOT NULL,variant_id TEXT NOT NULL,total INTEGER NOT NULL,PRIMARY KEY(project_id,version,step_id,variant_id))");
}
export function flowSimulation(input={}){
 if(input.id==='consecom-current'||input.projectId==='consecom-current')throw Error('O fluxo operacional Consecom não pode ser executado neste simulador.');
 initSimulation();
 return tx(()=>{
  if(input.action==='start'){
   const p=one('SELECT * FROM flow_projects WHERE id=?',clean(input.projectId,80));
   if(!p?.published_version)throw Error('Salve uma versão do projeto para testar.');
   const v=one('SELECT definition FROM flow_project_versions WHERE project_id=? AND version=?',p.id,p.published_version);
   const definition=validateFlow(JSON.parse(v.definition),{publish:true});
   const key=id(),at=Date.now(),execution=newExecution(definition,at);
   run('INSERT INTO flow_simulations(id,project_id,version,definition,execution,clock,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',key,p.id,p.published_version,JSON.stringify(definition),JSON.stringify(execution),at,now(),now());
   return {id:key,projectId:p.id,version:p.published_version,definition,execution,clock:at,revision:1,simulation:true};
  }
  const row=one('SELECT * FROM flow_simulations WHERE id=?',clean(input.id,80));
  if(!row)throw Error('Simulação não encontrada.');
  const definition=JSON.parse(row.definition),current=JSON.parse(row.execution);
  const format=(execution,clock,revision)=>({id:row.id,projectId:row.project_id,version:row.version,definition,execution,clock,revision,simulation:true});
  if(input.action==='get')return format(current,row.clock,row.revision);
  if(input.action!=='advance'||Number(input.revision)!==row.revision)throw Error('Simulação desatualizada.');
  const step=definition.steps[current.cursor];if(!step)return format(current,row.clock,row.revision);
  const choice=String(input.choice||'next'),at=current.state==='WAIT_TIME'&&choice==='next'?Math.max(row.clock,current.dueAt):row.clock+1;
  let event;
  if(['optout','refusal','takeover'].includes(choice))event={type:choice};
  else if(choice==='uncertain')event={type:'uncertain'};
  else if(current.state==='READY')event={type:'start'};
  else if(current.state==='RESERVED')event={type:'accepted',providerId:'sim-'+row.id+'-'+current.cursor};
  else if(current.state==='WAIT_PROOF')event={type:'proof',providerId:current.providerId,status:'DELIVERED'};
  else if(current.state==='WAIT_TIME')event={type:'tick'};
  else if(current.state==='WAIT_REPLY'&&['reply','permission','interest','automatic'].includes(choice))event={type:'inbound',id:'sim-in-'+row.revision,automatic:choice==='automatic',intent:choice};
  else throw Error('Escolha uma resposta para avançar.');
  const execution=reduceExecution(definition,current,event,{at,choose:variants=>{
   const counts=Object.fromEntries(all('SELECT variant_id,total FROM flow_simulation_variants WHERE project_id=? AND version=? AND step_id=?',row.project_id,row.version,step.id).map(x=>[x.variant_id,x.total]));
   const chosen=assignVariant(variants,counts);
   run('INSERT INTO flow_simulation_variants(project_id,version,step_id,variant_id,total) VALUES(?,?,?,?,1) ON CONFLICT(project_id,version,step_id,variant_id) DO UPDATE SET total=total+1',row.project_id,row.version,step.id,chosen.id);
   return chosen;
  }});
  run('UPDATE flow_simulations SET execution=?,clock=?,revision=revision+1,updated_at=? WHERE id=?',JSON.stringify(execution),at,now(),row.id);
  return format(execution,at,row.revision+1);
 });
}
function internalProject(){
 return {id:'consecom-current',name:'Consecom · Fluxo atual',niche:'Prospecção Consecom',description:'Espelho das etapas principais do motor existente. Somente leitura. Não executa envios.',protected:true,status:'legacy',revision:0,definition:{steps:[
 {id:'greeting',name:'Abordagem',kind:'text',variants:[{id:'greeting-a',text:'Olá, {{nome}} (quando disponível), {{saudacao}}! Tudo bem?',weight:1}]},
 {id:'reply1',name:'Aguardar resposta',kind:'reply',variants:[]},
 {id:'wait1',name:'Aguardar antes da apresentação',kind:'delay',seconds:INTRO_DELAY_MS/1000,variants:[]},
 {id:'intro',name:'Solicitar autorização',kind:'text',variants:[{id:'intro-a',text:WESLEY_INTRO,weight:1}]},
 {id:'consent',name:'Aguardar autorização do áudio',kind:'condition',condition:'permission',variants:[]},
 {id:'wait2',name:'Aguardar antes do áudio',kind:'delay',seconds:INTRO_DELAY_MS/1000,variants:[]},
 {id:'audio',name:'Áudio original da proposta',kind:'audio',variants:[{id:'audio-a',text:'Gravação original · R$ '+PITCH_AUDIO_OFFER_BRL+' · '+Math.round(PITCH_AUDIO_SECONDS)+' s',weight:1}]},
 {id:'wait3',name:'Após confirmação do áudio',kind:'delay',seconds:PITCH_PREVIEW_DELAY_MS/1000,variants:[]},
 {id:'video',name:'Vídeo do portfólio',kind:'video',variants:[{id:'video-a',text:PITCH_PREVIEW_TEXT,weight:1}]},
 {id:'result',name:'Avaliar resposta e encaminhar',kind:'condition',condition:'interest',variants:[]},
 {id:'human',name:'Interesse confirmado: atendimento humano',kind:'handoff',variants:[]}
 ]},settings:{dailyLimit:getSetting('daily_limit',90),window:prospectingWindowLabel()},execution:'existing_engine'};
}
export function validateFlow(input,{publish=false}={}){
 if(!input||!Array.isArray(input.steps)||input.steps.length>100)throw Error('Fluxo inválido: máximo de 100 etapas.');
 const seen=new Set();
 const steps=input.steps.map((s,i)=>{
  if(!uid(s.id)||seen.has(s.id)||!kinds.has(s.kind))throw Error('Etapa inválida ou repetida: '+(i+1));seen.add(s.id);
  const out={id:s.id,name:clean(s.name,100)||'Etapa '+(i+1),kind:s.kind,variants:[]};
  if(sending.has(s.kind)){
   if(!Array.isArray(s.variants)||s.variants.length>100)throw Error('Variantes inválidas');
   out.variants=s.variants.map(v=>{
    if(!uid(v.id)||seen.has(v.id))throw Error('Variante repetida ou inválida');seen.add(v.id);
    const weight=Number(v.weight??1);if(!Number.isInteger(weight)||weight<1||weight>10000)throw Error('Peso inválido');
    const text=clean(v.text,5000);
    if(publish&&s.kind==='text'&&!text)throw Error('Preencha todas as mensagens.');
    const mediaId=clean(v.mediaId,80);
    if(mediaId&&(!['audio','video','image','document'].includes(s.kind)||!uid(mediaId)||!one('SELECT 1 FROM media WHERE id=? AND kind=?',mediaId,s.kind)))throw Error('Mídia inválida para esta etapa.');
    return {id:v.id,text,weight,...(mediaId?{mediaId}:{})};
   });
   if(publish&&!out.variants.length)throw Error('Adicione uma variante de mensagem.');
  }
  if(s.kind==='delay'){const seconds=Number(s.seconds??10);if(!Number.isInteger(seconds)||seconds<0||seconds>604800)throw Error('Espera inválida');out.seconds=seconds;}
  if(s.kind==='condition')out.condition=['permission','interest','reply'].includes(s.condition)?s.condition:'reply';
  return out;
 });
 if(publish&&(!steps.length||!sending.has(steps[0].kind)))throw Error('Inicie o fluxo com uma mensagem.');
 return {steps};
}
const parse=r=>({id:r.id,name:r.name,niche:r.niche,description:r.description,definition:JSON.parse(r.draft),revision:r.revision,publishedVersion:r.published_version,createdAt:r.created_at,updatedAt:r.updated_at,status:r.published_version?'versioned':'draft',execution:'simulation_only'});
// Read-only aggregate telemetry; never creates live tables or exposes contact data.
export function flowProjectMetrics(projectId){
 const result={total:0,completed:0,cancelled:0,human:0,review:0,inProgress:0,activeVersion:null,variants:[]};
 if(isInternal())return result;
 if(one("SELECT 1 FROM sqlite_master WHERE type='table' AND name='flow_live_routes'")){
  result.activeVersion=one('SELECT version FROM flow_live_routes WHERE project_id=? AND enabled=1',projectId)?.version??null;
 }
 if(one("SELECT 1 FROM sqlite_master WHERE type='table' AND name='flow_live_runs'")){
  for(const row of all('SELECT state,COUNT(*) n FROM flow_live_runs WHERE project_id=? GROUP BY state',projectId)){
   const key=({COMPLETE:'completed',CANCELLED:'cancelled',HUMAN:'human',REVIEW:'review'})[row.state]||'inProgress';
   result[key]+=row.n;result.total+=row.n;
  }
 }
 if(one("SELECT 1 FROM sqlite_master WHERE type='table' AND name='flow_live_variants'")){
  result.variants=all('SELECT version,step_id AS stepId,variant_id AS variantId,total AS reservations FROM flow_live_variants WHERE project_id=? ORDER BY version,step_id,variant_id',projectId).map(row=>({...row}));
 }
 return result;
}
export function listFlowProjects(){
 init();const internal=isInternal();return {items:[...(internal?[internalProject()]:[]),...all('SELECT * FROM flow_projects ORDER BY updated_at DESC LIMIT 500').map(r=>({...parse(r),metrics:flowProjectMetrics(r.id)}))],protected:internal,executionEnabled:liveFlowSupported(),media:all('SELECT id,name,kind,mime,bytes FROM media ORDER BY created_at DESC LIMIT 500').map(r=>({...r}))};
}
export function mutateFlowProject(action,input={}){
 if(input.id==='consecom-current')throw Error('O fluxo Consecom está protegido e não pode ser alterado neste editor.');
 init();
 return tx(()=>{
  if(action==='create'||action==='duplicate'){
   if(one('SELECT COUNT(*) n FROM flow_projects').n>=500)throw Error('Limite de projetos atingido.');
   const previous=action==='duplicate'?one('SELECT * FROM flow_projects WHERE id=?',clean(input.id,80)):null;
   if(action==='duplicate'&&!previous)throw Error('Projeto não encontrado.');
   const name=clean(input.name,100)||(previous?previous.name+' (cópia)':'');
   if(!name)throw Error('Informe o nome do projeto.');
   const key=id(),at=now(),definition=previous?JSON.parse(previous.draft):{steps:[{id:id(),name:'Abordagem',kind:'text',variants:[{id:id(),text:'',weight:1}]}]};
   run('INSERT INTO flow_projects(id,name,niche,description,draft,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',key,name.slice(0,100),clean(input.niche??previous?.niche,120),clean(input.description??previous?.description,500),JSON.stringify(definition),at,at);
   return {...parse(one('SELECT * FROM flow_projects WHERE id=?',key)),metrics:flowProjectMetrics(key)};
  }
  const row=one('SELECT * FROM flow_projects WHERE id=?',clean(input.id,80));
  if(!row)throw Error('Projeto não encontrado.');
  if(Number(input.revision)!==row.revision)throw Error('Projeto atualizado em outra aba. Recarregue antes de salvar.');
  if(action==='save'){
   const name=clean(input.name,100);if(!name)throw Error('Informe o nome do projeto.');
   const definition=validateFlow(input.definition);
   run('UPDATE flow_projects SET name=?,niche=?,description=?,draft=?,revision=revision+1,updated_at=? WHERE id=?',name,clean(input.niche,120),clean(input.description,500),JSON.stringify(definition),now(),row.id);
  }else if(action==='activate'||action==='deactivate'){
   if(action==='activate'&&input.confirm!==true)throw Error('Confirme a ativação para contatos autorizados.');
   const v=one('SELECT definition FROM flow_project_versions WHERE project_id=? AND version=?',row.id,row.published_version||0);
   if(!v)throw Error('Salve uma versão antes de ativar.');
   const definition=JSON.parse(v.definition);
   setLiveRoute({projectId:row.id,niche:definition.niche,version:row.published_version,definition:validateFlow(definition,{publish:true}),enabled:action==='activate'});
  }else if(action==='version'){
   const definition=validateFlow(JSON.parse(row.draft),{publish:true});
   const version=(row.published_version||0)+1;
   run('INSERT INTO flow_project_versions(project_id,version,definition,created_at) VALUES(?,?,?,?)',row.id,version,JSON.stringify({name:row.name,niche:row.niche,description:row.description,...definition}),now());
   run('UPDATE flow_projects SET published_version=?,revision=revision+1,updated_at=? WHERE id=?',version,now(),row.id);
  }else throw Error('Operação inválida.');
  return {...parse(one('SELECT * FROM flow_projects WHERE id=?',row.id)),metrics:flowProjectMetrics(row.id)};
 });
}
