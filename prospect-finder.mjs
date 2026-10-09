// Prospect Finder — pesquisa pública (sem login)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const PROSPECTS_FILE = path.join(DATA_DIR, 'prospects.jsonl');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Categorias-alvo baseadas no briefing do Wesley
const SEGMENTS = [
  'psicologo', 'nutricionista', 'dentista', 'medico', 'clinica',
  'estetica', 'advogado', 'arquiteto', 'engenheiro',
  'eletricista', 'personal trainer', 'fisioterapeuta',
  'veterinario', 'pet shop', 'barbearia', 'salao',
  'restaurante', 'padaria', 'academia', 'pilates',
  'imobiliaria', 'corretor', 'contador'
];

// Regiões (Sorocaba foco + SP capital como expansão)
const REGIONS = [
  'Sorocaba', 'Votorantim', 'Itu', 'Salto', 'Araçoiaba da Serra',
  'São Paulo', 'Campinas', 'Jundiaí'
];

// Anúncios públicos (não precisa de login pra ver resultado de busca do Google)
const SEARCH_QUERIES = [
  // Combinando segmento + região + intenção de busca (sem exigir login)
  (s, r) => `${s} ${r} whatsapp contato`,
  (s, r) => `${s} ${r} instagram`,
  (s, r) => `${s} em ${r} site`,
  (s, r) => `${s} ${r} anuncio instagram`,
];

const args = process.argv.slice(2);
const cmd = args[0];

function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`;
  process.stdout.write(line);
  fs.appendFileSync(path.join(__dirname, 'logs', 'prospect.log'), line);
}

function loadProspects() {
  if (!fs.existsSync(PROSPECTS_FILE)) return [];
  return fs.readFileSync(PROSPECTS_FILE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function saveProspect(p) {
  fs.appendFileSync(PROSPECTS_FILE, JSON.stringify(p) + '\n');
}

function alreadyKnown(prospects, key) {
  return prospects.some(x => x.key === key);
}

if (cmd === 'list') {
  const ps = loadProspects();
  console.log(JSON.stringify(ps, null, 2));
} else if (cmd === 'queries') {
  // gera lista de queries para alimentar o WebSearch
  const out = [];
  for (const s of SEGMENTS.slice(0, 3)) {
    for (const r of REGIONS.slice(0, 2)) {
      for (const q of SEARCH_QUERIES) {
        out.push({ segment: s, region: r, query: q(s, r) });
      }
    }
  }
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log('Uso: node prospect-finder.mjs [list|queries]');
}