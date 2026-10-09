// send.mjs — envia mensagem de teste para o próprio Wesley
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'wa-session');

async function main() {
  const target = process.argv[2];
  const msg = process.argv.slice(3).join(' ');
  if (!target || !msg) {
    console.error('uso: node send.mjs <jid> <mensagem>');
    process.exit(2);
  }
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state, printQRInTerminal: false });
  sock.ev.on('creds.update', saveCreds);
  await new Promise(r => sock.ev.on('connection.update', ({ connection }) => { if (connection === 'open') r(); }));
  console.log('conectado, enviando...');
  await sock.sendMessage(target, { text: msg });
  console.log('OK enviado para', target);
  await new Promise(r => setTimeout(r, 1500));
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });