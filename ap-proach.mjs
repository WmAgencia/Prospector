// ap-proach.mjs — gera mensagem FASE 1 personalizada para um prospect
// Uso: node ap-proach.mjs <prospect_id>
// Lê data/prospects.jsonl, monta a FASE 1 baseada no segmento, escreve em data/queue.jsonl

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROSPECTS = path.join(__dirname, 'data', 'prospects.jsonl');
const QUEUE = path.join(__dirname, 'data', 'queue.jsonl');
const SENT = path.join(__dirname, 'data', 'sent.jsonl');
const LOG = path.join(__dirname, 'logs', 'bot.log');

const log = (...a) => fs.appendFileSync(LOG, `[${new Date().toISOString()}] [ap-proach] ${a.join(' ')}\n`);

// Classificação de segmento: profissional = R$450, empresa = R$750
const PROFISSIONAIS = new Set([
  'psicologo','nutricionista','dentista','medico','clinica',
  'estetica','barbeiro','manicure','personal','fisioterapeuta',
  'veterinario','corretor','advogado','arquiteto','engenheiro',
  'eletricista','contador','pilates'
]);

function isProfissional(segmento) {
  if (!segmento) return false;
  return PROFISSIONAIS.has(segmento.toLowerCase());
}

function getSaudacaoPorHorario() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function primeiroNome(nomeCompleto) {
  if (!nomeCompleto) return null;
  return nomeCompleto.trim().split(/\s+/)[0];
}

function loadProspects() {
  if (!fs.existsSync(PROSPECTS)) return [];
  return fs.readFileSync(PROSPECTS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function loadSent() {
  if (!fs.existsSync(SENT)) return [];
  return fs.readFileSync(SENT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function normalizeName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}
function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

function alreadyContacted(prospects, sent, prospect) {
  const phone = normalizePhone(prospect.whatsapp || prospect.to);
  const nome = normalizeName(prospect.contato_nome || prospect.empresa);
  return sent.some(s => {
    if (s.prospect_id === prospect.id) return true;
    if (phone && normalizePhone(s.to) === phone && phone.length >= 10) return true;
    if (nome) {
      const sNome = normalizeName(s.prospect_id);
      if (sNome && sNome === nome) return true;
    }
    return false;
  });
}

function enqueue(item) {
  fs.appendFileSync(QUEUE, JSON.stringify(item) + '\n');
}

function buildApproach(prospect) {
  // FASE 1 — só cumprimento
  const nome = primeiroNome(prospect.contato_nome) || null;
  // ignora nomes que não são nome próprio real (ex: "Senhor" do "Senhor Barbearia")
  const nomeValido = nome && !/^(senhor|senhora|dona|dr|dra|atendimento|recep[çc][aã]o|cl[ií]nica)$/i.test(nome);
  const saudacao = getSaudacaoPorHorario();
  const target = prospect.whatsapp || prospect.to;
  if (!target) return { error: 'sem whatsapp' };

  // cumprimento — sem nome inventado. Se não tenho nome, cumprimento genérico
  const cumprimento = nomeValido
    ? `Olá, ${nome}, tudo bem? ${saudacao}`
    : `Olá, tudo bem? ${saudacao}, vim falar com a ${prospect.empresa}`;

  // agendamento: cadência mínima 5 min. Aqui definimos scheduled_at agora
  // mas o bot aplica o intervalo entre envios via processQueue
  const item = {
    to: target,
    text: cumprimento,
    scheduled_at: Date.now(),
    prospect_id: prospect.id,
    fase: 1,
    context: {
      empresa: prospect.empresa,
      nome,
      segmento: prospect.segmento,
      is_profissional: isProfissional(prospect.segmento),
      preco_base: isProfissional(prospect.segmento) ? 450 : 750,
      preco_full: 900, // site+IA, único preço
    },
  };
  return item;
}

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === 'list') {
  const ps = loadProspects();
  console.log(JSON.stringify(ps, null, 2));
} else if (cmd === 'send') {
  // envia para 1 prospect específico
  const id = args[1];
  const ps = loadProspects();
  const p = ps.find(x => x.id === id);
  if (!p) { console.error('prospect não encontrado:', id); process.exit(2); }
  const sent = loadSent();
  if (alreadyContacted(ps, sent, p)) {
    console.error('já contactado:', id, '(prospect_id, número ou nome)');
    process.exit(3);
  }
  const item = buildApproach(p);
  if (item.error) { console.error(item.error); process.exit(4); }
  enqueue(item);
  log('enfileirado FASE 1 para', p.empresa, '(', p.whatsapp, ')');
  console.log('OK enfileirado:', JSON.stringify(item, null, 2));
} else if (cmd === 'send-all') {
  // envia para todos os QUALIFICADOS ainda não contactados
  const ps = loadProspects();
  const sent = loadSent();
  let count = 0;
  for (const p of ps) {
    if (alreadyContacted(ps, sent, p)) continue;
    if (p.status !== 'QUALIFICADO') continue;
    if (!p.whatsapp) { log('pulando (sem whatsapp):', p.empresa); continue; }
    const item = buildApproach(p);
    if (item.error) continue;
    enqueue(item);
    count++;
    log('enfileirado FASE 1 para', p.empresa, '(', p.whatsapp, ')');
  }
  console.log(`${count} mensagens enfileiradas.`);
} else {
  console.log('uso:');
  console.log('  node ap-proach.mjs list                # lista prospects');
  console.log('  node ap-proach.mjs send <id>           # enfileira FASE 1 de um');
  console.log('  node ap-proach.mjs send-all            # enfileira todos QUALIFICADOS');
}