// add-prospect.mjs — adiciona prospects ao JSONL de forma simples
// uso: node add-prospect.mjs <arquivo>
// Formato do arquivo (uma linha por prospect JSON):
// {"id":"pNNN","empresa":"...","contato_nome":"...","instagram":"...","segmento":"...","cidade":"...","whatsapp":"...","site":"...","status_site":"...","status":"QUALIFICADO","origem":"...","observ":"..."}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARQ = process.argv[2];
const DEST = path.join(__dirname, 'data', 'prospects.jsonl');

if (!ARQ) {
  console.error('uso: node add-prospect.mjs <arquivo-de-prospects.jsonl>');
  process.exit(2);
}

const novos = fs.readFileSync(ARQ, 'utf8').split('\n').filter(Boolean);
const existentes = fs.existsSync(DEST)
  ? fs.readFileSync(DEST, 'utf8').split('\n').filter(Boolean)
  : [];

const mapExist = new Map();
for (const l of existentes) {
  try {
    const o = JSON.parse(l);
    mapExist.set(o.id, o);
  } catch {}
}

let adicionados = 0;
for (const l of novos) {
  try {
    const o = JSON.parse(l);
    if (mapExist.has(o.id)) continue;
    existentes.push(JSON.stringify(o));
    adicionados++;
  } catch (e) {
    console.error('linha inválida:', l);
  }
}

fs.writeFileSync(DEST, existentes.join('\n') + '\n');
console.log(`${adicionados} prospects adicionados (${existentes.length} total).`);