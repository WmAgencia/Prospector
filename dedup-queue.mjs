// dedup-queue.mjs — limpa duplicatas da fila
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE = path.join(__dirname, 'data', 'queue.jsonl');
const SENT = path.join(__dirname, 'data', 'sent.jsonl');

const q = fs.existsSync(QUEUE) ? fs.readFileSync(QUEUE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const sent = fs.existsSync(SENT) ? fs.readFileSync(SENT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

const sentKeys = new Set();
const sentPhones = new Set();
for (const s of sent) {
  if (s.prospect_id) sentKeys.add(s.prospect_id);
  if (s.to) sentPhones.add(String(s.to).replace(/\D/g, ''));
}

const seen = new Set();
const limpa = [];
for (const it of q) {
  const pid = it.prospect_id;
  const phone = String(it.to).replace(/\D/g, '');
  // pula se já enviado
  if (sentKeys.has(pid) || sentPhones.has(phone)) continue;
  // pula duplicata na própria fila
  if (seen.has(pid) || seen.has(phone)) continue;
  seen.add(pid);
  seen.add(phone);
  limpa.push(it);
}

fs.writeFileSync(QUEUE, limpa.map(o => JSON.stringify(o)).join('\n') + (limpa.length ? '\n' : ''));
console.log(`Fila: ${q.length} → ${limpa.length} (removidos ${q.length - limpa.length} duplicatas ou já enviados)`);