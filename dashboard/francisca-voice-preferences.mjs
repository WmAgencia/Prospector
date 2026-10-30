// User-requested, non-sensitive speaking preferences for the verified owner.
// Unlike call transcript context these may survive a call and a server restart.
// No remembered customer data, credentials or free-form transcripts.
import {db,one,run,now,audit} from './db.mjs';
import {verifiedOwnerPhone,classifyContact} from './whatsapp-roles.mjs';
db.exec("CREATE TABLE IF NOT EXISTS francisca_voice_prefs(owner_jid TEXT PRIMARY KEY, speed TEXT NOT NULL DEFAULT 'normal', detail TEXT NOT NULL DEFAULT 'auto', updated_at TEXT NOT NULL)");
const defaults=()=>({speed:'normal',detail:'auto'});
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[.,!?]+$/,'').trim();
const safeOwner=actor=>{
 const role=classifyContact(actor||{});
 return role.role==='OWNER'&&role.ownerTools===true&&role.authorized===true&&
  actor?.jid===verifiedOwnerPhone()+'@s.whatsapp.net';
};
export function voicePrefsForOwner(actor){
 if(!safeOwner(actor))return defaults();
 const r=one('SELECT speed,detail FROM francisca_voice_prefs WHERE owner_jid=?',actor.jid);
 return {speed:['normal','slow','fast'].includes(r?.speed)?r.speed:'normal',
  detail:['auto','brief','detailed'].includes(r?.detail)?r.detail:'auto'};
}
export function voiceRateForPreferences(preferences={}){
 return {slow:'-13%',normal:'+4%',fast:'+13%'}[preferences.speed]||'+4%';
}
export function interpretVoicePreferences(text){
 const s=norm(text);
 if(/^(?:volta|volte|retorna|retorne|responde|fala|fale)\s+(?:ao\s+|a[o]?\s+)?(?:seu\s+)?(?:ritmo|jeito|modo|velocidade)\s+normal$/.test(s)||
   /^(?:volta|volte|retorna|retorne)\s+ao\s+normal$/.test(s))
  return {speed:'normal',detail:'auto',label:'Voltei ao ritmo normal de conversa.'};
 if(/^(?:(?:fala|fale|conversa|converse)\s+)?(?:mais\s+)?(?:devagar|lentamente|calmamente)$/.test(s)||
  /^(?:fala|fale|conversa|converse)\s+mais\s+devagar$/.test(s)||
  /^(?:diminui|reduz|abaixa)\s+(?:a\s+)?velocidade\s+(?:da\s+)?(?:fala|voz)$/.test(s))
  return {speed:'slow',label:'Vou falar mais devagar.'};
 if(/^(?:fala|fale|conversa|converse)\s+(?:mais\s+)?(?:rapido|depressa|ligeiro)$/.test(s)||
  /^(?:aumenta|acelera)\s+(?:a\s+)?velocidade\s+(?:da\s+)?(?:fala|voz)$/.test(s))
  return {speed:'fast',label:'Vou acelerar um pouco a fala.'};
 if(/^(?:(?:responde|responda|fala|fale)\s+)?(?:mais\s+)?(?:curto|curta|objetivo|objetiva|resumido|resumida|direto|direta)$/.test(s)||
    /^(?:prefiro|quero)\s+(?:respostas|explicacoes)\s+(?:curtas|objetivas|resumidas|diretas)$/.test(s))
  return {detail:'brief',label:'Vou dar respostas mais curtas e diretas.'};
 if(/^(?:(?:responde|responda|explica|explique)\s+)?(?:mais\s+)?(?:detalhado|detalhada|com\s+mais\s+detalhes|profundamente)$/.test(s)||
    /^(?:prefiro|quero)\s+(?:respostas|explicacoes)\s+(?:detalhadas|longas|completas)$/.test(s))
  return {detail:'detailed',label:'Vou explicar com mais detalhes.'};
 return null;
}
export function applyVoicePreferences(text,actor){
 const command=interpretVoicePreferences(text);
 if(!command)return null;
 if(!safeOwner(actor))return null;
 const before=voicePrefsForOwner(actor);
 const next={speed:command.speed||before.speed,detail:command.detail||before.detail};
 run("INSERT INTO francisca_voice_prefs(owner_jid,speed,detail,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner_jid) DO UPDATE SET speed=excluded.speed,detail=excluded.detail,updated_at=excluded.updated_at",
  actor.jid,next.speed,next.detail,now());
 audit('FRANCISCA_VOICE_PREFERENCES_CHANGED',null,{speed:next.speed,detail:next.detail});
 return {spoken:command.label,preferences:next};
}
