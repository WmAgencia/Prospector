// Deterministic delivery policy for Francisca: honor an explicit instruction
// before the AI-generated draft, then formal/urgent notices, then context.
// Only inbound sender commands can change persistent chat preferences.
import {db,one,run,now} from './db.mjs';
db.exec("CREATE TABLE IF NOT EXISTS groq_channel_preferences(jid TEXT PRIMARY KEY,mode TEXT NOT NULL CHECK(mode IN ('TEXT','VOICE','BOTH')),updated_at TEXT NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS groq_reply_parts(provider_id TEXT NOT NULL,part TEXT NOT NULL CHECK(part IN ('TEXT','VOICE')),state TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(provider_id,part))");
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const persistent=/\b(?:a partir de agora|daqui (?:pra|para) frente|de agora em diante|sempre|todas as (?:mensagens|respostas)|ate eu pedir|ate eu mudar|por padrao)\b/;
const explicitAll=/\b(?:os dois|ambos|ambas|texto e audio|audio e texto|texto junto (?:com|ao) audio|audio junto (?:com|ao) texto|em texto e (?:em )?audio|em audio e (?:em )?texto)\b/;
const onlyText=/\b(?:nao (?:quero|mande|envie|envia|responda|responde|precisa|mande mais|envie mais).{0,35}audio|sem audio|somente texto|so texto|apenas texto|nao em audio)\b/;
const onlyAudio=/\b(?:nao (?:quero|mande|envie|envia|responda|responde).{0,35}texto|sem texto|somente audio|so audio|apenas audio|nao em texto)\b/;
const request=/\b(?:me (?:manda|mande|envia|envie|responde|responda|fale|fala|escreva)|pode (?:mandar|enviar|responder)|prefiro|quero (?:que (?:voce|ela) )?|responda|responde|manda|mande|envia|envie|escreva|escreve|fale|fala|por favor)\b.{0,65}/;
const textCue=/\b(?:por escrito|em texto|por texto|mensagem escrita|resposta escrita|so escrev|somente escrev|escreva pra mim|escreve pra mim)\b/;
const voiceCue=/\b(?:em audio|por audio|nota de voz|mensagem de voz|mensagem falada|voz da francisca)\b/;
export function explicitChannelRequest(text){
 const t=norm(text);
 if(!t)return null;
 const persist=persistent.test(t);
 const noVoice=onlyText.test(t),noText=onlyAudio.test(t);
 if(noVoice&&!noText)return {mode:'TEXT',persistent:persist,reason:'EXPLICIT_NO_AUDIO'};
 if(noText&&!noVoice)return {mode:'VOICE',persistent:persist,reason:'EXPLICIT_NO_TEXT'};
 const askedBoth=explicitAll.test(t);
 if(askedBoth)return {mode:'BOTH',persistent:persist,reason:'EXPLICIT_BOTH'};
 const requestPhrase=request.test(t);
 if(requestPhrase&&textCue.test(t))return {mode:'TEXT',persistent:persist,reason:'EXPLICIT_TEXT'};
 if(requestPhrase&&voiceCue.test(t))return {mode:'VOICE',persistent:persist,reason:'EXPLICIT_AUDIO'};
 if(persist&&textCue.test(t))return {mode:'TEXT',persistent:true,reason:'PREFERENCE_TEXT'};
 if(persist&&voiceCue.test(t))return {mode:'VOICE',persistent:true,reason:'PREFERENCE_AUDIO'};
 return null;
}
export function formalOrUrgent(text,draft){
 const t=norm(text+' '+draft);
 return /\b(?:urgente|emergencia|precisa de (?:voce|mim) agora|cliente.{0,45}(?:precisa falar|precisa de voce|quer falar|esta esperando)|contrato|assinatura|comprovante|boleto|fatura|cobranca|pagamento|dados bancarios|pix|proposta formal|documento|protocolo|telefone do cliente|numero do cliente|contato do cliente|prazo final|vencimento|data da reuniao|confirmacao por escrito)\b/.test(t);
}
export function isReport(text,draft){
 const t=norm(text+' '+draft);
 return /\b(?:relatorio|balanco|prestacao de contas|metricas|analise de resultados|resumo (?:de|dos) (?:resultados|campanhas|desempenho)|desempenho (?:das|dos) campanhas|resultados da campanha|relatorio de vendas)\b/.test(t);
}
export function chooseReplyChannel({inbound='',draft='',wasAudio=false,isOperatorTest=false,preferredMode=null,voiceAvailable=false}={}){
 const instruction=explicitChannelRequest(inbound);
 let mode,reason;
 if(instruction){mode=instruction.mode;reason=instruction.reason;}
 else if(formalOrUrgent(inbound,draft)){mode='TEXT';reason='FORMAL_OR_URGENT';}
 else if(isReport(inbound,draft)){mode='BOTH';reason='REPORT_EXPLAINED';}
 else if(['TEXT','VOICE','BOTH'].includes(preferredMode)){mode=preferredMode;reason='SAVED_PREFERENCE';}
 else if(isOperatorTest||wasAudio){mode='VOICE';reason='SIMPLE_CONVERSATION';}
 else{mode='TEXT';reason='TEXT_CHAT';}
 // Safety: even an audio preference must preserve an essential written record.
 if(formalOrUrgent(inbound,draft)&&mode==='VOICE'){mode='BOTH';reason='IMPORTANT_WRITTEN_RECORD';}
 const requested=mode;
 if(!voiceAvailable&&mode!=='TEXT'){mode='TEXT';reason='VOICE_UNAVAILABLE';}
 return {mode,requested,reason,preference:instruction?.persistent?instruction.mode:null,
   explicit:!!instruction,text:mode==='TEXT'||mode==='BOTH',voice:mode==='VOICE'||mode==='BOTH'};
}
export function channelPreference(jid){return one('SELECT mode FROM groq_channel_preferences WHERE jid=?',jid)?.mode||null;}
export function saveChannelPreference(jid,mode){
 if(!/^\d{10,15}@s\.whatsapp\.net$/.test(jid||'')||!['TEXT','VOICE','BOTH'].includes(mode))return false;
 run('INSERT INTO groq_channel_preferences(jid,mode,updated_at) VALUES(?,?,?) ON CONFLICT(jid) DO UPDATE SET mode=excluded.mode,updated_at=excluded.updated_at',jid,mode,now());
 return true;
}
export function reservePart(providerId,part){
 return run('INSERT OR IGNORE INTO groq_reply_parts(provider_id,part,state,updated_at) VALUES(?,?,?,?)',providerId,part,'UNKNOWN',now()).changes===1;
}
export function acceptPart(providerId,part){
 run("UPDATE groq_reply_parts SET state='ACCEPTED',updated_at=? WHERE provider_id=? AND part=?",now(),providerId,part);
}
export function partsFor(providerId){return one("SELECT GROUP_CONCAT(part||':'||state,',') summary FROM groq_reply_parts WHERE provider_id=?",providerId)?.summary||'';}
