// Prospector - bot completo (escuta + envio + cadência + fila + áudio PTT)
// Mantém 1 conexão Baileys única
// Lê comandos de data/queue/pending.jsonl para envio
// Escuta mensagens recebidas → data/inbox.jsonl

import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, jidNormalizedUser } from '@whiskeysockets/baileys';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'wa-session');
const DATA = path.join(__dirname, 'data');
const LOG_FILE = path.join(__dirname, 'logs', 'bot.log');
const OUTBOX = path.join(DATA, 'outbox.jsonl');
const INBOX = path.join(DATA, 'inbox.jsonl');
const QUEUE = path.join(DATA, 'queue.jsonl');
const SENT = path.join(DATA, 'sent.jsonl');
const AUDIO_SENT = path.join(DATA, 'audio-sent.jsonl');
const OUTBOX_DONE = path.join(DATA, 'outbox-done.jsonl');
const OPTOUT = path.join(DATA, 'optout.jsonl');
const DNC = path.join(DATA, 'do-not-contact.json');
const STATE = path.join(DATA, 'state.json');
// ÁUDIO DE ABORDAGEM (o "áudio laranja" que o Wesley deixa pré-programado).
// O arquivo antigo (Downloads, 07/10) foi apagado do computador. Agora o bot
// procura nesta ordem e, se não achar, NÃO envia nada e avisa no log.
// >>> Basta salvar o áudio como  D:\Prospector\audio\abordagem.ogg  <<<
const AUDIO_DIR = path.join(__dirname, 'audio');
const AUDIO_CANDIDATOS = [
  path.join(AUDIO_DIR, 'abordagem.ogg'),
  path.join(AUDIO_DIR, 'abordagem.opus'),
  path.join(AUDIO_DIR, 'abordagem.mp3'),
  path.join(AUDIO_DIR, 'abordagem.m4a'),
  path.join('C:', 'Users', 'junin', 'Downloads', 'WhatsApp Audio 2026-10-07 at 08.43.40.ogg'),
];
function acharAudio() {
  for (const p of AUDIO_CANDIDATOS) if (fs.existsSync(p)) return p;
  if (fs.existsSync(AUDIO_DIR)) {
    const f = fs.readdirSync(AUDIO_DIR).filter((x) => /\.(ogg|opus|mp3|m4a|wav)$/i.test(x)).sort().pop();
    if (f) return path.join(AUDIO_DIR, f);
  }
  return null;
}
const LID_MAP = path.join(DATA, 'lid-map.json');

// LISTEN_ONLY=1 → conecta e SÓ ESCUTA: registra inbox + mapeamento LID, não envia nada,
// não toca na fila. Usado para recuperar conversas pendentes sem disparar a fila.
const LISTEN_ONLY = process.env.LISTEN_ONLY === '1';

if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
if (!fs.existsSync(path.join(__dirname, 'logs'))) fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });

const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`;
  process.stdout.write(line);
  fs.appendFileSync(LOG_FILE, line);
};

const sockLog = (...a) => log('[sock]', ...a);

function loadState() {
  if (fs.existsSync(STATE)) {
    try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
  }
  return {};
}
function saveState(s) { fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); }

function appendJsonl(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

function readQueue() {
  if (!fs.existsSync(QUEUE)) return [];
  return fs.readFileSync(QUEUE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
function writeQueue(arr) { fs.writeFileSync(QUEUE, arr.map(o => JSON.stringify(o)).join('\n') + (arr.length ? '\n' : '')); }

function normalizePhoneToJid(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length >= 10 && digits.length <= 15) {
    return digits + '@s.whatsapp.net';
  }
  return null;
}

let sock = null;
let myJid = null;
let myLid = null;
let queueTimer = null;
let outboxTimer = null;

// CADÊNCIA DE NOVAS ABORDAGENS: mínimo 5 minutos entre abordagens (requisito do Wesley).
// ~12/h, teto ~96 em 8h. 96 é TETO, não meta obrigatória.
let cadenceMs = 5 * 60 * 1000;
let audioDelayMs = 60 * 1000; // 1 minuto após resposta do lead, envia áudio

// AUTO_AUDIO=1 → envia o áudio PTT automático 1min após resposta humana.
// DESLIGADO por padrão: enviar áudio automático é irreversível e pode ir
// para quem acabou de recusar (já aconteceu de disparar sem lead humano).
const AUTO_AUDIO = process.env.AUTO_AUDIO === '1';

// Janela permitida para NOVAS abordagens (horário de Brasília).
// Respostas (outbox) NÃO sofrem essa trava: resposta tem prioridade.
const JANELA_INICIO = 8;
const JANELA_FIM = 21;
const OUTBOX_GAP_MS = 25 * 1000; // folga anti-spam entre respostas

const digits = (x) => String(x || '').replace(/\D/g, '');

function loadDNC() {
  if (!fs.existsSync(DNC)) return [];
  try { return JSON.parse(fs.readFileSync(DNC, 'utf8')); } catch { return []; }
}

// Checa a lista de nunca-contatar (OPT_OUT, recusa explícita, conversa pessoal)
function isBlocked(jidOrPhone) {
  const d = digits(jidOrPhone);
  if (!d) return null;
  return loadDNC().find((e) => digits(e.phone || e) === d) || null;
}

// Saudação correta pelo horário de Brasília (Bom dia / Boa tarde / Boa noite)
function horaBR(at = new Date()) {
  return Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(at));
}
function saudacaoBR(at = new Date()) {
  const h = horaBR(at);
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}
function dentroDaJanela() {
  const h = horaBR();
  return h >= JANELA_INICIO && h < JANELA_FIM;
}

// Detecção de OPT_OUT: pedido de parada / remoção / desinteresse explícito
const OPTOUT_RX = /(n[aã]o\s+tenho\s+interesse|sem\s+interesse|n[aã]o\s+quero|n[aã]o\s+(me\s+)?(mande|mandar|manda|chame|chama|perturbe|contate)|para\s+de\s+(me\s+)?(mandar|enviar|chamar)|pare\s+de\s+(me\s+)?(mandar|enviar|chamar)|me\s+(remove|remova|tira|tire|exclui|exclua|apaga|apague)|tira\s+meu\s+(numero|n[uú]mero)|descadastr|nao\s+me\s+contat)/i;

function registrarOptOut(from, phone, text) {
  const d = digits(phone || from);
  appendJsonl(OPTOUT, { ts: new Date().toISOString(), from, phone: d, text });
  const list = loadDNC();
  if (d && !list.some((e) => digits(e.phone || e) === d)) {
    list.push({ phone: d, motivo: 'OPT_OUT', desde: new Date().toISOString(), evidencia: String(text || '').slice(0, 120) });
    fs.writeFileSync(DNC, JSON.stringify(list, null, 2));
  }
  log('[optout] OPT_OUT registrado', d, '::', String(text || '').slice(0, 90));
}

// ---------------------------------------------------------------------------
// MOTOR DETERMINÍSTICO (engine/) — decisão explicável de parada/recusa.
// Sem IA. Requisito do brief: "LEAD DIZER NÃO TENHO INTERESSE E RECEBER
// VÍDEO/ÁUDIO DEPOIS" é IMPOSSÍVEL. Auditoria de 08/10: a regex acima deixava
// passar 63% das recusas (inclusive "já tem uma empresa fazendo pra gente",
// que só foi bloqueada à mão). O motor cobre negação, escopo de negação e
// 40+ variações. Se o módulo não carregar, cai para a regex — o bot não morre.
let engine = null;
try {
  engine = await import('./engine/index.mjs');
  log('[engine] núcleo determinístico carregado v' + engine.ENGINE_VERSION);
} catch (e) {
  log('[engine] INDISPONÍVEL — usando somente a regex:', e.message);
}

// Ledger de primeira abordagem (regra nº1): trava atômica em disco, sobrevive
// a restart, fila reescrita e webhook duplicado. data/ledger/
let ledger = null;
if (engine) {
  try {
    ledger = new engine.InitialContactLedger(path.join(DATA, 'ledger'));
    log('[engine] ledger de primeira abordagem pronto em data/ledger');
  } catch (e) {
    log('[engine] ledger indisponível:', e.message);
  }
}

// Decide se a mensagem encerra a automação e se mídia pode sair.
function decidirParada(text) {
  const viaRegex = OPTOUT_RX.test(String(text || ''));
  if (engine) {
    try {
      const r = engine.classify(String(text || ''));
      const parar = r.intent === 'OPT_OUT' || r.intent === 'NOT_INTERESTED';
      return { parar: parar || viaRegex, permiteMidia: !parar && !viaRegex && r.allow_media, resultado: r };
    } catch (e) {
      log('[engine] falha ao classificar:', e.message);
    }
  }
  return { parar: viaRegex, permiteMidia: !viaRegex, resultado: null };
}

// Recusa explícita (≠ pedido de bloqueio) também não pode ser abordada de novo:
// registra distinguível de OPT_OUT, com a frase que disparou (auditoria).
function registrarSemInteresse(from, phone, text, resultado) {
  const d = digits(phone || from);
  appendJsonl(OPTOUT, {
    ts: new Date().toISOString(), categoria: 'NOT_INTERESTED', from, phone: d, text,
    intent: resultado?.intent ?? null, confianca: resultado?.confidence ?? null,
    regras: (resultado?.matched_rules || []).map((r) => `${r.rule}:${r.phrase}`),
  });
  const list = loadDNC();
  if (d && !list.some((e) => digits(e.phone || e) === d)) {
    list.push({ phone: d, motivo: 'SEM_INTERESSE', desde: new Date().toISOString(), evidencia: String(text || '').slice(0, 120) });
    fs.writeFileSync(DNC, JSON.stringify(list, null, 2));
  }
  log('[optout] NOT_INTERESTED registrado', d, '::', String(text || '').slice(0, 90));
}

// Controle de follow-up de áudio: jid → timestamp da primeira msg do lead após abordagem
const leadResponseAt = new Map();

function readSent() {
  if (!fs.existsSync(SENT)) return [];
  return fs.readFileSync(SENT, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

async function processQueue() {
  // NOVAS ABORDAGENS só dentro da janela (Brasília). Fora dela, espera.
  if (!dentroDaJanela()) {
    log('[queue] fora da janela de abordagem (', saudacaoBR(), ') — rechecagem em 15min');
    queueTimer = setTimeout(processQueue, 15 * 60 * 1000);
    return;
  }
  // CADÊNCIA PELO HISTÓRICO, não só pelo timer em memória.
  // Incidente real de 08/10: reiniciar o bot (ou reescrever a fila) fazia o timer
  // zerar e duas abordagens saíram com 1min06s de diferença (p803 → p2004).
  // Agora a última abordagem é lida do sent.jsonl, então reiniciar NÃO fura os 5 min.
  const sent = readSent();
  const ultimaAbordagem = sent
    .filter((s) => s.motivo === 'abordagem' || (!s.motivo && s.prospect_id && s.prospect_id !== 'self-test'))
    .map((s) => new Date(s.ts).getTime())
    .sort((a, b) => b - a)[0];
  if (ultimaAbordagem) {
    const decorrido = Date.now() - ultimaAbordagem;
    if (decorrido < cadenceMs) {
      const falta = cadenceMs - decorrido;
      log('[queue] cadência: última abordagem há', Math.round(decorrido / 1000), 's; esperando', Math.round(falta / 1000), 's.');
      queueTimer = setTimeout(processQueue, falta + 2000);
      return;
    }
  }

  const q = readQueue();
  if (!q.length) {
    queueTimer = setTimeout(processQueue, 30 * 1000);
    return;
  }
  const now = Date.now();
  const idx = q.findIndex(it => !it.scheduled_at || it.scheduled_at <= now);
  if (idx < 0) {
    const nextAt = q[0].scheduled_at || now;
    const wait = Math.max(5000, nextAt - now);
    log('[queue] aguardando', Math.round(wait / 1000), 's para próximo item');
    queueTimer = setTimeout(processQueue, wait);
    return;
  }
  const item = q[idx];
  const alvo = digits(item.to);

  // DEDUPLICAÇÃO REAL: a versão antiga comparava telefone ("5516...") com JID
  // ("5516...@s.whatsapp.net") e por isso NUNCA casava. Agora compara dígitos
  // e também o prospect_id. Regra: nunca abordar a mesma empresa duas vezes.
  const dupTel = sent.some(s => digits(s.to) === alvo);
  const dupId = item.prospect_id && sent.some(s => s.prospect_id === item.prospect_id);
  if (dupTel || dupId) {
    q.splice(idx, 1); writeQueue(q);
    log('[queue] duplicata ignorada', item.prospect_id || '', item.to);
    queueTimer = setTimeout(processQueue, 1000);
    return;
  }

  const blocked = isBlocked(item.to);
  if (blocked) {
    q.splice(idx, 1); writeQueue(q);
    log('[queue] descartado (do-not-contact):', item.to, blocked.motivo);
    queueTimer = setTimeout(processQueue, 1000);
    return;
  }

  const jid = item.jid || normalizePhoneToJid(item.to);
  if (!jid) {
    q.splice(idx, 1); writeQueue(q);
    log('[queue] jid inválido para', item.to);
    queueTimer = setTimeout(processQueue, 1000);
    return;
  }

  // Saudação recalculada no momento do envio: os itens da fila foram gerados
  // com "Bom dia" fixo e virariam saudação errada à noite.
  const text = String(item.text || '')
    .replace(/Bom dia|Boa tarde|Boa noite/g, saudacaoBR())
    .replace(/\{saudacao\}/g, saudacaoBR());

  // REGRA Nº1: antes de QUALQUER primeira abordagem, reserva atômica por
  // chave de idempotência (initial-contact:{prospect_id}). Se dois processos
  // rodarem juntos, um único vence; o outro simplesmente não envia.
  let reserva = null;
  if (ledger && item.prospect_id) {
    try {
      reserva = ledger.reserve(item.prospect_id, { to: jid, canal: 'whatsapp', keys: [alvo] });
    } catch (e) {
      // Ledger com problema NÃO pode derrubar o bot; mas também não deixa
      // passar sem trava: sem reserva, não envia (falha segura da regra nº1).
      log('[ledger] ERRO na reserva de', item.prospect_id, '— não enviando:', e.message);
      queueTimer = setTimeout(processQueue, 30 * 1000);
      return;
    }
    if (!reserva.ok) {
      q.splice(idx, 1); writeQueue(q);
      log('[ledger] abordagem BLOQUEADA (', reserva.motivo, ') para', item.prospect_id, '— nada foi enviado');
      queueTimer = setTimeout(processQueue, 1000);
      return;
    }
  }

  try {
    log('[queue] enviando para', jid, '— texto:', text.slice(0, 90));
    const enviada = await sock.sendMessage(jid, { text });
    q.splice(idx, 1); writeQueue(q);
    appendJsonl(SENT, { to: jid, text, ts: new Date().toISOString(), prospect_id: item.prospect_id || null, fase: item.fase || 1, motivo: 'abordagem', message_id: enviada?.key?.id || null });
    if (reserva && ledger) ledger.confirm(item.prospect_id, { message_id: enviada?.key?.id || null, to: jid });
    log('[queue] enviado OK para', jid);
  } catch (e) {
    log('[queue] ERRO envio para', item.to, e.message);
    // Nada saiu de verdade: libera a reserva (ato auditado) para tentar depois.
    // Se o processo morrer entre reservar e enviar, a reserva permanece e o
    // lead NÃO é abordado duas vezes (falha segura da regra nº1).
    if (reserva && ledger) ledger.release(item.prospect_id, 'falha de envio no WhatsApp; a mensagem não saiu');
    item.scheduled_at = Date.now() + 60 * 1000;
    q[idx] = item; writeQueue(q);
  }
  queueTimer = setTimeout(processQueue, cadenceMs);
}

// ---------------------------------------------------------------------------
// OUTBOX: mensagens explícitas (respostas a leads, follow-ups combinados).
// Diferente da fila: responde MESMO em LISTEN_ONLY, porque responder quem
// já falou com a gente tem prioridade sobre manter cadência de prospecção.
// Cada item: {"to":"5511..."|"<jid>","text":"...","fase":2,"motivo":"...","prospect_id":"p901"}
// ---------------------------------------------------------------------------
function readOutbox() {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs.readFileSync(OUTBOX, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function writeOutbox(arr) {
  fs.writeFileSync(OUTBOX, arr.map(o => JSON.stringify(o)).join('\n') + (arr.length ? '\n' : ''));
}

async function processOutbox() {
  const q = readOutbox();
  if (!q.length) {
    outboxTimer = setTimeout(processOutbox, 20 * 1000);
    return;
  }
  const item = q[0];
  const rest = q.slice(1);

  // IDEMPOTÊNCIA do outbox: item com idempotency_key só sai UMA vez, mesmo que
  // o arquivo seja reescrito ou o bot reinicie (regra nº1 aplicada a respostas).
  if (item.idempotency_key) {
    const jaFeito = fs.existsSync(OUTBOX_DONE) &&
      fs.readFileSync(OUTBOX_DONE, 'utf8').split('\n').filter(Boolean).some((l) => {
        try { return JSON.parse(l).idempotency_key === item.idempotency_key; } catch { return false; }
      });
    if (jaFeito) {
      log('[outbox] duplicata ignorada (idempotency_key):', item.idempotency_key);
      writeOutbox(rest); outboxTimer = setTimeout(processOutbox, 1000); return;
    }
  }

  const raw = String(item.to || '');
  const jid = /@(s\.whatsapp\.net|lid|g\.us)$/.test(raw) ? raw : normalizePhoneToJid(raw);

  if (!jid) {
    log('[outbox] destino inválido:', raw);
    appendJsonl(OUTBOX_DONE, { ...item, status: 'destino_invalido' });
    writeOutbox(rest); outboxTimer = setTimeout(processOutbox, 1000); return;
  }
  const blocked = isBlocked(jid);
  if (blocked) {
    log('[outbox] BLOQUEADO (do-not-contact):', raw, blocked.motivo);
    appendJsonl(OUTBOX_DONE, { ...item, status: 'bloqueado', motivo_bloqueio: blocked.motivo });
    writeOutbox(rest); outboxTimer = setTimeout(processOutbox, 1000); return;
  }

  const text = String(item.text || '').replace(/\{saudacao\}/g, saudacaoBR());
  try {
    log('[outbox] enviando para', jid, '—', text.slice(0, 90));
    await sock.sendMessage(jid, { text });
    appendJsonl(SENT, {
      to: jid, text, ts: new Date().toISOString(),
      prospect_id: item.prospect_id || null, fase: item.fase || null,
      motivo: item.motivo || 'resposta', lead_nome: item.lead_nome || null,
    });
    appendJsonl(OUTBOX_DONE, { ...item, text, status: 'enviado', enviado_em: new Date().toISOString() });
    log('[outbox] enviado OK para', jid);
  } catch (e) {
    log('[outbox] ERRO envio para', jid, e.message);
    appendJsonl(OUTBOX_DONE, { ...item, status: 'erro', erro: e.message });
  }
  writeOutbox(rest);
  outboxTimer = setTimeout(processOutbox, OUTBOX_GAP_MS);
}

async function sendAudioPtt(jid) {
  try {
    const file = acharAudio();
    if (!file) {
      log('[audio] NENHUM audio encontrado. Salve o audio pre-programado em',
        path.join(AUDIO_DIR, 'abordagem.ogg'), '— nada foi enviado para', jid);
      return false;
    }
    const ext = path.extname(file).toLowerCase();
    const ehOpus = ext === '.ogg' || ext === '.opus';
    const audioBuffer = fs.readFileSync(file);
    log('[audio] enviando para', jid, '| arquivo:', path.basename(file), '| bytes:', audioBuffer.length, '| ptt:', ehOpus);
    await sock.sendMessage(jid, ehOpus
      ? { audio: audioBuffer, ptt: true, mimetype: 'audio/ogg; codecs=opus' }
      : { audio: audioBuffer, ptt: false, mimetype: ext === '.mp3' ? 'audio/mpeg' : ext === '.m4a' ? 'audio/mp4' : 'audio/wav' });
    appendJsonl(AUDIO_SENT, { to: jid, ts: new Date().toISOString(), file });
    log('[audio] enviado OK para', jid, ehOpus ? '(nota de voz)' : '(arquivo de audio)');
    return true;
  } catch (e) {
    log('[audio] ERRO envio para', jid, e.message);
    return false;
  }
}

// Resolve LIDs pendentes ("@lid") para o telefone real, usando o mapeamento
// que o próprio WhatsApp mantém na sessão. Serve para atribuir corretamente
// quem respondeu (antes, resposta em @lid nunca casava com o envio em telefone)
// e para nunca abordar duas vezes a mesma empresa.
async function resolvePendingLids() {
  const file = path.join(DATA, 'resolve-lids.json');
  if (!fs.existsSync(file)) return;
  let lids = [];
  try { lids = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
  if (!Array.isArray(lids) || !lids.length) return;
  const map = fs.existsSync(LID_MAP) ? JSON.parse(fs.readFileSync(LID_MAP, 'utf8')) : {};
  const res = {};
  for (const lid of lids) {
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(lid);
      res[lid] = pn || null;
      if (pn) map[lid] = pn;
      log('[lid-resolve]', lid, '→', pn || '(nao resolvido)');
    } catch (e) {
      res[lid] = null;
      log('[lid-resolve] erro', lid, e.message);
    }
  }
  fs.writeFileSync(LID_MAP, JSON.stringify(map, null, 2));
  fs.writeFileSync(path.join(DATA, 'lid-resolved.json'), JSON.stringify({ ts: new Date().toISOString(), map: res }, null, 2));
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  log('Baileys', version, isLatest ? '(latest)' : '(older)');

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: { level: 'silent', trace: () => {}, debug: () => {}, info: () => {}, warn: sockLog, error: sockLog, fatal: sockLog, child: () => ({ level: 'silent', trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, fatal: () => {}, child: () => ({ level: 'silent' }) }) },
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      log('QR gerado. Salvo em D:\\Prospector\\logs\\qr.png');
      try {
        const qrcode = await import('qrcode');
        const png = await qrcode.toBuffer(qr, { type: 'png', width: 360 });
        fs.writeFileSync(path.join(__dirname, 'logs', 'qr.png'), png);
      } catch {}
    }
    if (connection === 'open') {
      log('✅ Conectado ao WhatsApp');
      try {
        const me = sock.user;
        if (me?.id) myJid = jidNormalizedUser(me.id);
        if (me?.lid) myLid = me.lid;
        log('meu JID:', myJid, 'LID:', myLid);
        const st = loadState();
        st.myJid = myJid;
        st.myLid = myLid;
        st.connected_at = new Date().toISOString();
        saveState(st);
      } catch (e) { log('erro ao obter próprio JID:', e.message); }
      resolvePendingLids().catch(e => log('[lid-resolve] falhou:', e.message));

      // Outbox (respostas explícitas) roda SEMPRE, inclusive em LISTEN_ONLY.
      // Resposta a quem já falou tem prioridade sobre cadência de prospecção.
      if (outboxTimer) clearTimeout(outboxTimer);
      outboxTimer = setTimeout(processOutbox, 3000);
      if (LISTEN_ONLY) {
        log('⚠️  MODO LISTEN_ONLY ativo: fila de abordagens ignorada (outbox de respostas segue ativo).');
      } else {
        if (queueTimer) clearTimeout(queueTimer);
        queueTimer = setTimeout(processQueue, 5000);
        log('[queue] modo ATIVO — cadência', Math.round(cadenceMs / 1000), 's | janela', JANELA_INICIO + 'h-' + JANELA_FIM + 'h (Brasília) | AUTO_AUDIO=' + AUTO_AUDIO);
      }
    }
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      log('Conexão fechada. Motivo:', reason, lastDisconnect?.error?.message);
      if (reason === DisconnectReason.loggedOut) {
        log('Sessão deslogada. Apague', SESSION_DIR, 'e reescaneie QR.');
        process.exit(2);
      }
      if (reason === 515) {
        log('Restart requerido, subindo de novo em 3s...');
        setTimeout(start, 3000);
        return;
      }
      log('Aguardando 60s antes de tentar de novo...');
      setTimeout(start, 60000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      if (!m.message) continue;
      const from = m.key.remoteJid;
      const isFromMe = m.key.fromMe;
      // ignora mensagens enviadas por mim
      if (isFromMe) continue;
      // ignora newsletters
      if (from.endsWith('@newsletter')) continue;
      // ignora status broadcast
      if (from === 'status@broadcast') continue;
      // ignora LID do próprio aparelho (eco)
      if (from === myLid || from === myJid) continue;

      const text =
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        m.message?.videoMessage?.caption ||
        m.message?.documentMessage?.caption ||
        '';
      const isAudio = !!m.message?.audioMessage;
      const audioPtt = m.message?.audioMessage?.ptt === true;
      const entry = {
        ts: new Date().toISOString(),
        from,
        jidAlt: m.key.remoteJidAlt || null,
        addressingMode: m.key.addressingMode || null,
        isFromMe,
        pushName: m.pushName,
        text,
        id: m.key.id,
        type: isAudio ? (audioPtt ? 'audio_ptt' : 'audio_file') : 'text',
      };
      appendJsonl(INBOX, entry);

      // DECISÃO DO MOTOR (uma vez por mensagem, usada também no portão do áudio):
      // OPT_OUT → nunca-contatar; NOT_INTERESTED explícito → também não abordar
      // de novo; INTERESSADO/QUESTÃO/INCERTO → registra para o humano.
      const decisao = (!isFromMe && !from.endsWith('@g.us') && text)
        ? decidirParada(text)
        : { parar: false, permiteMidia: true, resultado: null };
      if (decisao.resultado?.intent === 'OPT_OUT') {
        registrarOptOut(from, m.key.remoteJidAlt || null, text);
      } else if (
        decisao.resultado?.intent === 'NOT_INTERESTED' &&
        decisao.resultado.confidence >= 0.9 &&
        !decisao.resultado.flags.mixed_signals
      ) {
        registrarSemInteresse(from, m.key.remoteJidAlt || null, text, decisao.resultado);
      } else if (decisao.resultado && (decisao.resultado.requires_human || decisao.resultado.intent === 'INTERESTED')) {
        log('[engine]', decisao.resultado.intent, '(' + decisao.resultado.confidence + ')',
          m.pushName || from, '→', decisao.resultado.kanban_target);
      }

      // Persiste o mapeamento LID <-> telefone.
      // Bug corrigido: respostas chegam como '@lid' e o sent.jsonl guarda o telefone,
      // então NENHUMA resposta casava e o follow-up nunca disparava.
      try {
        const alt = m.key.remoteJidAlt;
        if (alt && from && from !== alt) {
          const map = fs.existsSync(LID_MAP) ? JSON.parse(fs.readFileSync(LID_MAP, 'utf8')) : {};
          if (map[from] !== alt) {
            map[from] = alt;
            fs.writeFileSync(LID_MAP, JSON.stringify(map, null, 2));
            log('[lid] mapeado', from, '<->', alt, '| pushName:', m.pushName || '?');
          }
        }
      } catch (e) { log('[lid] erro ao salvar mapa:', e.message); }
      log('MSG', isFromMe ? 'OUT' : 'IN ', from, '→', isAudio ? `[áudio${audioPtt ? '/ptt' : ''}]` : JSON.stringify(text).slice(0, 120));
      // se é conversa individual (não grupo), considerar pra follow-up de áudio
      // Follow-up de áudio: só com AUTO_AUDIO=1 explícito.
      if (AUTO_AUDIO && !isFromMe && !from.endsWith('@g.us')) {
        // casa a resposta tanto pelo @lid quanto pelo telefone (remoteJidAlt)
        const pnAlt = m.key.remoteJidAlt || null;
        // NUNCA mandar áudio de venda para quem recusou / pediu para parar
        // (motor: OPT_OUT e NOT_INTERESTED bloqueiam) nem para resposta
        // automática de robô (atendimento eletrônico já visto no inbox).
        const autoReply = engine
          ? engine.isLikelyAutoReply(text || '', { pushName: m.pushName })
          : { is_auto_reply: false, matched: [] };
        if (isBlocked(from) || (pnAlt && isBlocked(pnAlt)) || !decisao.permiteMidia) {
          log('[audio] ignorado: recusa/parada detectada (', decisao.resultado?.intent || 'regex', ').');
        } else if (autoReply.is_auto_reply) {
          log('[audio] ignorado: resposta automática (', autoReply.matched.join(', '), ').');
        } else {
        // já mandamos FASE 1 para este lead?
        if (fs.existsSync(SENT)) {
          const sent = fs.readFileSync(SENT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
          const already = sent.some(s => (s.to === from || (pnAlt && s.to === pnAlt)) && s.text && /^(Olá|Bom|Boa|Buenas)/.test(s.text));
          if (already) {
            // já enviamos áudio pra esse lead?
            const audioJaEnviado = fs.existsSync(AUDIO_SENT) &&
              fs.readFileSync(AUDIO_SENT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
                .some(a => a.to === from);
            if (!audioJaEnviado) {
              const lastSent = leadResponseAt.get(from) || 0;
              const now = Date.now();
              if (now - lastSent < audioDelayMs) {
                // já tem timer em andamento
                log('[audio] já tem agendamento para', from);
              } else {
                leadResponseAt.set(from, now);
                log('[audio] lead respondeu, agendando PTT em 60s para', from);
                setTimeout(() => sendAudioPtt(from), audioDelayMs);
              }
            } else {
              log('[audio] PTT já enviado para', from, '— não reenvia');
            }
          }
        }
        }
      }
    }
  });
}

start().catch(e => { log('FATAL', e.stack || e.message); process.exit(1); });