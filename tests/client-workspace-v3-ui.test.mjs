import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const read=p=>fs.readFileSync(fileURLToPath(new URL('../'+p,import.meta.url)),'utf8');
const app=read('dashboard/public/simple-app.js'),css=read('dashboard/public/dashboard-purple.css');
const server=read('dashboard/server.mjs'),platform=read('dashboard/platform.mjs');
test('WhatsApp UI uses a single named list and blurred QR dialog, not full-width banner',()=>{
 assert.match(app,/function whatsappNotice\(\)\{return '';?\}/);
 assert.match(app,/wa-inline-connect/);
 assert.match(app,/wa-directory-list/);
 assert.match(app,/wa-modal-backdrop/);
 assert.match(app,/waModalCloseTimer=setTimeout/);
 assert.ok(!app.includes('INTEGRAÇÃO WHATSAPP'));
 assert.match(css,/backdrop-filter:blur\(11px\)/);
});
test('automatic search and monthly calendar replace manual list discovery UI',()=>{
 assert.match(app,/function prospecting\(\)/);
 assert.match(app,/scope-form/);
 assert.match(app,/calendar-days-grid/);
 assert.match(app,/data-action="calendar-day"/);
 assert.match(app,/\/api\/prospecting\/calendar/);
 assert.ok(!app.includes('<h2>Empresas não abordadas</h2>'));
 assert.ok(!app.includes('<h2>Pesquisar empresas</h2>'));
});
test('training has four steps, selected chats, transcribed audio and right-hand profile',()=>{
 for(const x of ['training-wizard-steps','training-ready-grid','training-record-toggle','training-analysis','training-all-confirm','training-profile','training-approve']){
  assert.ok(app.includes(x)||x==='training-profile'&&app.includes('trainingProfile('),x);
 }
 assert.match(app,/\/api\/training\/voice-note/);
 assert.match(server,/handleFranciscaPanel/);
});
test('Francisca is client scoped, supports recording and voice playback, without sending real messages',()=>{
 assert.match(app,/francisca-widget/);
 assert.match(app,/francisca-record-toggle/);
 assert.match(app,/\/api\/ai\/francisca-turn/);
 assert.match(app,/\/api\/ai\/francisca-speak/);
 assert.match(platform,/francisca-turn/);
 const handler=read('dashboard/francisca-panel.mjs');
 assert.match(handler,/PROSPECTOR_TENANT_ID/);
 assert.match(handler,/Não faça nenhuma alteração/);
});
test('settings show only key controls and account credentials route, hiding technical call metrics',()=>{
 assert.match(app,/outreach-hours-form/);
 assert.match(app,/account-credentials/);
 assert.match(app,/Pausar novas abordagens/);
 assert.match(platform,/changeCredentials/);
 assert.ok(!app.includes('Diagnóstico das ligações'));
 assert.match(css,/\.account-settings-grid/);
});
