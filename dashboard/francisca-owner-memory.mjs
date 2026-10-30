// Opt-in owner notes plus minimal automatic topical continuity.
// No raw transcripts/contacts/phone numbers/secrets. No permission is recalled.
import {db,one,run,now,audit} from './db.mjs';
import {classifyContact,verifiedOwnerPhone} from './whatsapp-roles.mjs';
db.exec("CREATE TABLE IF NOT EXISTS francisca_owner_notes(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_jid TEXT NOT NULL,topic TEXT NOT NULL,summary TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL)");
const clean=x=>String(x||'').replace(/\s+/g,' ').trim();
const nrm=x=>clean(x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const authenticated=a=>classifyContact(a||{}).role==='OWNER'&&
  classifyContact(a||{}).ownerTools===true&&a?.jid===verifiedOwnerPhone()+'@s.whatsapp.net';
const sensitive=s=>/(?:\b\d{8,}\b|@[\w.-]+\.[a-z]{2,}|\b(?:senha|password|token|api.?key|chave privada|cpf|cnpj|cartao|pix|credencial|codigo de acesso)\b)/i.test(s);
const topics=[['prospectos',/\b(?:lead|prospect|abordagem|clientes)\b/],['campanhas',/\b(?:campanha|anuncio|trafego|ads)\b/],['relatorios',/\b(?:relatorio|diagnostico|metricas|desempenho)\b/],['agenda',/\b(?:reuniao|agenda|agendamento)\b/],['site',/\b(?:site|pagina|seo)\b/],['sistema',/\b(?:prospector|sistema|whatsapp)\b/]];
const topicOf=s=>topics.find(([,re])=>re.test(nrm(s)))?.[0]||null;
function prune(owner){
 run('DELETE FROM francisca_owner_notes WHERE expires_at<?',now());
 const keep=one('SELECT COUNT(*) n FROM francisca_owner_notes WHERE owner_jid=?',owner)?.n||0;
 if(keep>25)run('DELETE FROM francisca_owner_notes WHERE id IN (SELECT id FROM francisca_owner_notes WHERE owner_jid=? ORDER BY id ASC LIMIT ?)',owner,keep-25);
}
function append(owner,topic,summary,days){
 run('INSERT INTO francisca_owner_notes(owner_jid,topic,summary,created_at,expires_at) VALUES(?,?,?,?,?)',
  owner,topic,summary,now(),new Date(Date.now()+days*86400000).toISOString());
 prune(owner);
}
export function ownerMemoryCommand(text,actor){
 if(!authenticated(actor))return null;
 const raw=clean(text), n=nrm(raw);
 if(/^(?:esquece|apaga|limpa|exclui)\s+(?:as?\s+)?(?:minhas?\s+)?(?:lembrancas?|memorias?|anotacoes?)/.test(n)){
  run('DELETE FROM francisca_owner_notes WHERE owner_jid=?',actor.jid);
  audit('FRANCISCA_OWNER_NOTES_CLEARED',null,{source:'verified-owner-call'});
  return 'Apaguei as anotações e tópicos guardados para as próximas ligações.';
 }
 if(/^(?:quais|o que)\s+(?:sao\s+)?(?:as\s+)?(?:minhas\s+)?(?:memorias?|anotacoes?|lembrancas?)/.test(n)){
  const rows=db.prepare("SELECT summary FROM francisca_owner_notes WHERE owner_jid=? AND expires_at>? ORDER BY id DESC LIMIT 4").all(actor.jid,now());
  return rows.length?'Guardei estas informações: '+rows.map(r=>r.summary).join('; ')+'.':'Não há anotações guardadas de ligações anteriores.';
 }
 const match=raw.match(/^(?:francisca[, ]+)?(?:lembra|lembre|anota|anote|guarda|guarde)\s+(?:pra\s+depois\s+)?(?:que|o seguinte)\s*[:,-]?\s*(.+)$/i);
 if(match){
  const value=clean(match[1]);
  if(value.length<8||value.length>200||sensitive(value))
   return 'Só posso guardar notas curtas sem telefones, senhas, dados pessoais ou credenciais. Pode reformular?';
  const topic=topicOf(value)||'nota';
  append(actor.jid,topic,value,30);
  audit('FRANCISCA_OWNER_NOTE_STORED',null,{topic});
  return 'Anotado para as próximas ligações: '+value+'.';
 }
 if(/^(?:continua|continuar|retoma|retomar|vamos continuar|onde paramos)\s+(?:o\s+)?(?:assunto|conversa|tarefa|trabalho|pesquisa)?\s*(?:da|de|na|do)?\s*(?:ultima|outra|anterior)\s*(?:ligacao|chamada|vez)?/.test(n)||
    /^(?:onde paramos|continua de onde paramos)/.test(n)){
  const row=one('SELECT topic,summary FROM francisca_owner_notes WHERE owner_jid=? AND expires_at>? ORDER BY id DESC LIMIT 1',actor.jid,now());
  return row?'Na última ligação, o assunto anotado foi '+row.summary+'. Quer retomar essa consulta? Nenhuma ação foi executada.':'Não tenho um assunto de ligação anterior registrado para retomar.';
 }
 return null;
}
export function rememberCallTopic(text,actor){
 if(!authenticated(actor))return;
 const topic=topicOf(text);
 if(!topic||sensitive(text))return;
 // Store only a topic label, never original dictation or customer data.
 const summary='consulta sobre '+topic;
 const last=one('SELECT summary FROM francisca_owner_notes WHERE owner_jid=? ORDER BY id DESC LIMIT 1',actor.jid);
 if(last?.summary!==summary)append(actor.jid,topic,summary,14);
}
export function recentOwnerMemory(actor){
 if(!authenticated(actor))return '';
 const rows=db.prepare('SELECT summary FROM francisca_owner_notes WHERE owner_jid=? AND expires_at>? ORDER BY id DESC LIMIT 3').all(actor.jid,now());
 return rows.map(x=>x.summary).join('; ').slice(0,340);
}
