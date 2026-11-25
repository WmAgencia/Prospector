// Flow library is deliberately independent of the live dispatch engine.
// Internal workspace is a read-only reference, not a second executable flow.
import {db,all,one,run,now,id,tx,getSetting} from './db.mjs';
import {WESLEY_INTRO,INTRO_DELAY_MS,PITCH_PREVIEW_DELAY_MS,PITCH_PREVIEW_TEXT} from './prospecting-introduction.mjs';
import {PITCH_AUDIO_OFFER_BRL,PITCH_AUDIO_SECONDS} from './portfolio-pitch-audio.mjs';
import {prospectingWindowLabel} from './outreach-window.mjs';
const isInternal=()=>!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true';
const kinds=new Set(['text','audio','video','image','document','reply','delay','condition','ai','handoff']);
const sending=new Set(['text','audio','video','image','document']);
const clean=(v,n)=>String(v??'').trim().slice(0,n);
const uid=v=>/^[a-zA-Z0-9_-]{1,80}$/.test(String(v||''));
function init(){
 db.exec("CREATE TABLE IF NOT EXISTS flow_projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,niche TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',draft TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,published_version INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
 db.exec("CREATE TABLE IF NOT EXISTS flow_project_versions(project_id TEXT NOT NULL REFERENCES flow_projects(id),version INTEGER NOT NULL,definition TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,version))");
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
    return {id:v.id,text,weight};
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
export function listFlowProjects(){
 if(isInternal())return {items:[internalProject()],protected:true,executionEnabled:false};
 init();return {items:all('SELECT * FROM flow_projects ORDER BY updated_at DESC LIMIT 500').map(parse),protected:false,executionEnabled:false};
}
export function mutateFlowProject(action,input={}){
 if(isInternal())throw Error('O fluxo Consecom está protegido e não pode ser alterado neste editor.');
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
   return parse(one('SELECT * FROM flow_projects WHERE id=?',key));
  }
  const row=one('SELECT * FROM flow_projects WHERE id=?',clean(input.id,80));
  if(!row)throw Error('Projeto não encontrado.');
  if(Number(input.revision)!==row.revision)throw Error('Projeto atualizado em outra aba. Recarregue antes de salvar.');
  if(action==='save'){
   const name=clean(input.name,100);if(!name)throw Error('Informe o nome do projeto.');
   const definition=validateFlow(input.definition);
   run('UPDATE flow_projects SET name=?,niche=?,description=?,draft=?,revision=revision+1,updated_at=? WHERE id=?',name,clean(input.niche,120),clean(input.description,500),JSON.stringify(definition),now(),row.id);
  }else if(action==='version'){
   const definition=validateFlow(JSON.parse(row.draft),{publish:true});
   const version=(row.published_version||0)+1;
   run('INSERT INTO flow_project_versions(project_id,version,definition,created_at) VALUES(?,?,?,?)',row.id,version,JSON.stringify({name:row.name,niche:row.niche,description:row.description,...definition}),now());
   run('UPDATE flow_projects SET published_version=?,revision=revision+1,updated_at=? WHERE id=?',version,now(),row.id);
  }else throw Error('Operação inválida.');
  return parse(one('SELECT * FROM flow_projects WHERE id=?',row.id));
 });
}
