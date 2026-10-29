// Whisper multilingual transcription of customer-initiated WhatsApp audio.
// The transcript is handled by the same inbox and Groq intent path as text.
import {db,one,run,now,audit} from './db.mjs';
import {safeMediaPath,fetchPrivateAudio,MAX_MEDIA_BYTES} from './waakg-media.mjs';
db.exec("CREATE TABLE IF NOT EXISTS inbound_audio_jobs(provider_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,jid TEXT NOT NULL,media_path TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,error TEXT)");
run("UPDATE inbound_audio_jobs SET state='REVIEW',error='Interrupted job; please review' WHERE state='PROCESSING'");
export function queueInboundAudio({providerId,sessionId,jid,fileUrl}={}){
 if(!/^[a-zA-Z0-9_-]{3,70}$/.test(sessionId||'')||
  !/^\d{10,15}@s\.whatsapp\.net$/.test(jid||'')||
  !/^[a-zA-Z0-9_-]{3,70}:[\w-]{5,150}$/.test(providerId||'')||
  !safeMediaPath(fileUrl))return {queued:false,reason:'INVALID_MEDIA_REFERENCE'};
 const existing=one("SELECT state FROM inbound_audio_jobs WHERE provider_id=?",providerId);
 if(existing)return {queued:false,reason:'ALREADY_SEEN'};
 run("INSERT INTO inbound_audio_jobs(provider_id,session_id,jid,media_path,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  providerId,sessionId,jid,fileUrl,'PENDING',now(),now());
 return {queued:true};
}
export async function transcribeAudio({buffer,filename,fetchFn=fetch}={}){
 if(!Buffer.isBuffer(buffer)||buffer.length<100||buffer.length>MAX_MEDIA_BYTES)throw Error('INVALID_AUDIO');
 const key=process.env.GROQ_API_KEY;
 if(!key)throw Error('GROQ_NOT_CONFIGURED');
 const allowed=/\.(mp3|m4a|mp4|ogg|opus|wav|webm)$/i;
 if(!allowed.test(filename||''))throw Error('AUDIO_EXTENSION');
 const form=new FormData();
 const ext=String(filename).split('.').at(-1).toLowerCase();
 const mime=({mp3:'audio/mpeg',m4a:'audio/mp4',mp4:'audio/mp4',ogg:'audio/ogg',
   opus:'audio/ogg',wav:'audio/wav',webm:'audio/webm'})[ext];
 form.append('file',new Blob([buffer],{type:mime}),filename);
 form.append('model','whisper-large-v3-turbo');
 form.append('language','pt');
 form.append('response_format','json');
 form.append('prompt','Conversa da agência Consecom Brasil. A palavra Consecom escreve-se C-O-N-S-E-C-O-M. Francisca é o nome da voz. Termos: Consecom Brasil, site, orçamento, atendimento, WhatsApp.');
 const res=await fetchFn('https://api.groq.com/openai/v1/audio/transcriptions',{
  method:'POST',headers:{Authorization:'Bearer '+key,Accept:'application/json'},
  body:form,signal:AbortSignal.timeout(24000)});
 if(!res.ok)throw Error('GROQ_TRANSCRIPTION_HTTP_'+res.status);
 const data=await res.json().catch(()=>({}));
 // The specific agency name is often split phonetically by Whisper. Correct
 // common spelling variants without changing the rest of the transcript.
 const content=String(data.text||'').trim().slice(0,2000).replace(/\b(?:conse\s*com|consecon|concecom|consecone|consecom)\b/gi,'Consecom');
 if(content.length<2)throw Error('TRANSCRIPT_EMPTY');
 // Avoid hallucinating common boilerplate for silence.
 if(/^(?:legendas? (?:por|pela)|obrigad[oa] por assistir|inscreva-se no canal)[.!\s]*$/i.test(content))throw Error('TRANSCRIPT_UNCERTAIN');
 return {text:content,model:'whisper-large-v3-turbo',language:'pt'};
}
let busy=false;
export async function processAudioJobs({download=fetchPrivateAudio,transcribe=transcribeAudio,deliver}={}){
 if(typeof deliver!=='function')throw Error('TRANSCRIPT_HANDLER_REQUIRED');
 if(busy)return {status:'BUSY'};
 busy=true;
 try{
  const entries=[...Array(3)].map(()=>one("SELECT * FROM inbound_audio_jobs WHERE state='PENDING' ORDER BY created_at LIMIT 1")).filter(Boolean);
  // Process only the oldest, so a long transcription cannot duplicate another job.
  const job=entries[0];if(!job)return {status:'IDLE'};
  run("UPDATE inbound_audio_jobs SET state='PROCESSING',updated_at=? WHERE provider_id=? AND state='PENDING'",now(),job.provider_id);
  try{
   const media=await download(job.media_path,{session:job.session_id});
   const recognized=await transcribe({buffer:media.buffer,filename:media.filename});
   const response=await deliver({sessionId:job.session_id,jid:job.jid,unique:job.provider_id,
    content:recognized.text,source:'AUDIO'});
   if(response?.body?.processed!==true&&response?.body?.duplicate!==true)throw Error('TRANSCRIPT_INBOX_FAILED');
   run("UPDATE inbound_audio_jobs SET state='DONE',updated_at=? WHERE provider_id=?",now(),job.provider_id);
   audit('WAAKG_AUDIO_TRANSCRIBED',null,{model:recognized.model,chars:recognized.text.length,source:'inbound'});
   return {status:'DONE',chars:recognized.text.length};
  }catch(error){
   const code=String(error?.message||'AUDIO_FAILED').slice(0,70);
   run("UPDATE inbound_audio_jobs SET state='REVIEW',error=?,updated_at=? WHERE provider_id=?",code,now(),job.provider_id);
   return {status:'REVIEW',error:code};
  }
 }finally{busy=false;}
}
export function audioStatus(){
 return {receivingEnabled:process.env.AUDIO_TRANSCRIPTION_ENABLED==='true',
  whisperReady:!!process.env.GROQ_API_KEY,pending:one("SELECT COUNT(*) n FROM inbound_audio_jobs WHERE state='PENDING'")?.n||0,
  review:one("SELECT COUNT(*) n FROM inbound_audio_jobs WHERE state='REVIEW'")?.n||0,
  transcribed:one("SELECT COUNT(*) n FROM inbound_audio_jobs WHERE state='DONE'")?.n||0};
}
