// Aggregate timing only: no transcripts, phone numbers, message bodies or audio.
import {db,one,run,now} from './db.mjs';
import {createHash} from 'node:crypto';
db.exec("CREATE TABLE IF NOT EXISTS francisca_call_metrics(id TEXT PRIMARY KEY,call_hash TEXT NOT NULL,created_at TEXT NOT NULL,stt_ms INTEGER NOT NULL,llm_ms INTEGER NOT NULL,tts_ms INTEGER NOT NULL,total_ms INTEGER NOT NULL,segments INTEGER NOT NULL,interrupted INTEGER NOT NULL,uncertain INTEGER NOT NULL,tool_calls INTEGER NOT NULL,error_type TEXT)");
const number=x=>Math.min(120000,Math.max(0,Math.round(Number(x)||0)));
const safeError=e=>/^[A-Z][A-Z0-9_]{0,38}$/.test(String(e||''))?e:null;
export function recordVoiceMetrics({callId,sttMs,llmMs,ttsMs,totalMs,segments=1,interrupted=false,uncertain=false,toolCalls=0,errorType=null}={}){
 const callHash=createHash('sha256').update(String(callId||'unknown')).digest('hex').slice(0,14);
 const id=createHash('sha256').update(callHash+':'+String(now())+':'+String(Math.random())).digest('hex');
 run('INSERT INTO francisca_call_metrics(id,call_hash,created_at,stt_ms,llm_ms,tts_ms,total_ms,segments,interrupted,uncertain,tool_calls,error_type) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
  id,callHash,now(),number(sttMs),number(llmMs),number(ttsMs),number(totalMs),
  Math.min(8,number(segments)),interrupted?1:0,uncertain?1:0,Math.min(10,number(toolCalls)),safeError(errorType));
 // Limit footprint to the last 1000 anonymous timing rows.
 run("DELETE FROM francisca_call_metrics WHERE id NOT IN (SELECT id FROM francisca_call_metrics ORDER BY created_at DESC LIMIT 1000)");
}
export function voiceMetricsSummary(){
 const r=one("SELECT COUNT(*) n,ROUND(AVG(total_ms)) avg_ms,ROUND(AVG(stt_ms)) stt_ms,ROUND(AVG(llm_ms)) llm_ms,ROUND(AVG(tts_ms)) tts_ms,SUM(interrupted) interruptions,SUM(uncertain) uncertain,SUM(tool_calls) tool_calls,ROUND(AVG(segments)*10)/10 segments FROM francisca_call_metrics WHERE created_at>?",new Date(Date.now()-7*86400000).toISOString())||{};
 return {turns:Number(r.n)||0,avgMs:Number(r.avg_ms)||0,sttMs:Number(r.stt_ms)||0,llmMs:Number(r.llm_ms)||0,ttsMs:Number(r.tts_ms)||0,interruptions:Number(r.interruptions)||0,uncertain:Number(r.uncertain)||0,toolCalls:Number(r.tool_calls)||0,avgSegments:Number(r.segments)||0};
}
export const voiceMetricsRequested=x=>/(?:latencia|lentidao|velocidade|demora|diagnostico|metricas?|desempenho)\s+(?:das?\s+)?(?:ultimas?\s+)?(?:chamadas?|ligacoes?|conversas?\s+de\s+voz)|(?:como\s+)?(?:estao|est[aá])\s+(?:a\s+)?(?:qualidade|velocidade)\s+das?\s+(?:chamadas?|ligacoes?)/i.test(String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase());
export function voiceMetricsSpoken(){
 const m=voiceMetricsSummary();
 return m.turns?'Nas últimas sete dias, medi '+m.turns+' respostas. Tempo médio total: '+(m.avgMs/1000).toFixed(1)+' segundos, sendo '+(m.sttMs/1000).toFixed(1)+' na transcrição, '+(m.llmMs/1000).toFixed(1)+' no processamento e '+(m.ttsMs/1000).toFixed(1)+' na voz. O detector registrou '+m.interruptions+' interrupções e '+m.uncertain+' transcrições incertas.':'Ainda não tenho amostras de chamadas suficientes para apresentar tempos medidos.';
}
