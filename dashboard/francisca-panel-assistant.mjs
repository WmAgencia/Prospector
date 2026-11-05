// Francisca in the SaaS panel. All reads execute INSIDE the already authenticated
// tenant worker's own SQLite database. No tool execution, sends, purchases, lead
// mutations, customer cross-tenant search or persistent transcripts here.
import {all,one,getSetting} from './db.mjs';
import {groqChat,groqConfigured} from './groq-models.mjs';
import {transcribeAudio} from './waakg-audio-inbound.mjs';
import {makeFranciscaVoice,voiceStatus} from './francisca-tts.mjs';

const safe=s=>String(s??'').replace(/[\r\n\t<>]/g,' ').replace(/\s+/g,' ').trim();
export function panelAssistantContext(){
 const business=getSetting('training_business',{}),profile=getSetting('training_active',null);
 const leads=all("SELECT business,city,stage FROM leads ORDER BY COALESCE(last_activity_at,created_at) DESC LIMIT 10");
 const lastWins=all("SELECT l.business,o.updated_at FROM sales_outcomes o JOIN leads l ON l.id=o.lead_id WHERE o.status='CLOSED_WON' ORDER BY o.updated_at DESC LIMIT 5");
 const contactCount=one("SELECT COUNT(*) n FROM initial_contacts WHERE status='SENT'")?.n||0;
 const leadsTotal=one('SELECT COUNT(*) n FROM leads')?.n||0;
 return {workspace:process.env.PROSPECTOR_TENANT_NAME||'Meu espaço',
  companyName:safe(business.name).slice(0,100),
  companyDescription:safe(business.description).slice(0,1300),
  trainingApproved:Boolean(profile),approvedTraining:safe(profile?.text).slice(0,1800),
  approachHours:getSetting('client_outreach_hours',{start:'08:00',end:'17:30'}),
  paused:getSetting('paused',false),autoResearch:getSetting('discovery_auto_enabled',false),
  autoApproach:getSetting('autonomous_outreach_enabled',false),
  totalLeads:leadsTotal,acceptedApproaches:contactCount,
  latestLeads:leads.map(l=>({name:safe(l.business).slice(0,85),city:safe(l.city).slice(0,60),stage:l.stage})),
  recentlyClosed:lastWins.map(x=>({business:safe(x.business).slice(0,85),at:x.updated_at})),
  limitations:'Não tenho acesso ao saldo atual de créditos ou ao status ao vivo de um WhatsApp nesta consulta; veja as respectivas páginas. Não posso executar ações nesta interface de voz.'};
}
export function panelAssistantStatus(){
 return {configured:groqConfigured(),voiceAvailable:voiceStatus().available,mode:'tenant-read-only',consent:'Audio is transcribed by the configured provider only after explicit user action.'};
}
export async function handlePanelAssistant(req,res,url,{json,respond},deps={}){
 if(!url.pathname.startsWith('/api/assistant/panel'))return false;
 if(req.method==='GET'&&url.pathname==='/api/assistant/panel/status'){
  respond(res,200,panelAssistantStatus());return true;
 }
 if(req.method!=='POST'||url.pathname!=='/api/assistant/panel/turn'){
  respond(res,404,{error:'Recurso indisponível'});return true;
 }
 const body=await json(req);
 let text=safe(body.text).slice(0,1300);
 if(body.audioBase64!==undefined){
  const type=String(body.audioType||'').toLowerCase();
  if(!['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav'].includes(type)){
   respond(res,422,{error:'Formato de áudio não suportado'});return true;
  }
  if(typeof body.audioBase64!=='string'||body.audioBase64.length<140||body.audioBase64.length>2_000_000||!/^[a-zA-Z0-9+/]+={0,2}$/.test(body.audioBase64)){
   respond(res,422,{error:'Áudio inválido ou muito longo'});return true;
  }
  const bytes=Buffer.from(body.audioBase64,'base64');
  if(bytes.length<100||bytes.length>1_500_000){respond(res,422,{error:'Áudio acima do limite'});return true;}
  try{
   const recognized=await (deps.transcribe||transcribeAudio)({buffer:bytes,filename:'francisca-panel.'+({ 'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a','audio/mpeg':'mp3','audio/wav':'wav'})[type]});
   text=safe(recognized.text).slice(0,1300);
  }catch(e){respond(res,502,{error:'Não foi possível transcrever o áudio. Tente falar novamente ou digite.'});return true;}
 }
 if(text.length<2){respond(res,422,{error:'Escreva ou grave sua pergunta'});return true;}
 const history=Array.isArray(body.history)?body.history.filter(x=>['user','assistant'].includes(x.role)&&typeof x.content==='string').slice(-8).map(x=>({role:x.role,content:safe(x.content).slice(0,600)})):[];
 let reply='';
 try{
  const model=deps.model||groqChat;
  const result=await model({task:'voice',maxTokens:380,messages:[
   {role:'system',content:'Você é Francisca, assistente falada do Prospector, em português brasileiro. Use EXCLUSIVAMENTE o contexto verificado do espaço do cliente autenticado fornecido abaixo. Responda de modo natural e breve, máximo 450 caracteres. Não invente métricas, saldos, WhatsApps conectados, confirmações ou resultados. Você está em modo leitura: não pode alterar configurações, enviar WhatsApps, comprar créditos, extrair contatos ou criar automações. Quando a pessoa pedir uma alteração, explique em qual área do painel ela pode realizar. Jamais revele segredos. Contexto do cliente: '+JSON.stringify(panelAssistantContext()).slice(0,5500)},
   ...history,{role:'user',content:text}]});
  reply=safe(result.choice?.content).slice(0,580);
  if(!reply)throw Error('EMPTY_RESPONSE');
 }catch(e){respond(res,502,{error:'Francisca não conseguiu responder agora. Tente novamente.'});return true;}
 let audioBase64=null,audioError=null;
 if(voiceStatus().available){
  try{
   const audio=await (deps.synthesize||makeFranciscaVoice)(reply.slice(0,640));
   if(audio.bytes.length<=1_800_000)audioBase64=audio.bytes.toString('base64');
   else audioError='Áudio maior que o limite';
  }catch(e){audioError='A voz está indisponível neste momento';}
 }else audioError='Voz não habilitada neste ambiente';
 respond(res,200,{text:reply,transcript:text,audioBase64,audioMimeType:'audio/mp4',audioError,readOnly:true});
 return true;
}
