import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const read=p=>fs.readFileSync(fileURLToPath(new URL('../'+p,import.meta.url)),'utf8');
const app=read('dashboard/public/simple-app.js');
const css=read('dashboard/public/dashboard-purple.css');
const api=read('dashboard/server.mjs');
const platform=read('dashboard/platform.mjs');
test('QR modal replaces the full-width offline alert and closes after connection',()=>{
 assert.ok(app.includes("function whatsappNotice(){return '';"));
 for(const x of ['wa-header-connect','qr-modal-backdrop','waQrConnectedAt','Conectar mais um WhatsApp','data-action="close-qr"','waQrOpen'])assert.ok(app.includes(x),x);
 assert.ok(!app.includes('class="connect-layout"'));
});
test('automated research modes and calendar replace the old selectable lead table',()=>{
 for(const x of ['prospect-preference-form','niche_all_cities','niche_city','calendar-day','calendar-kind','calendar-next','calendar-prev','prospect-calendar-grid'])assert.ok(app.includes(x),x);
 assert.ok(!app.includes('Empresas não abordadas</h2>'));
 assert.match(api,/\/api\/prospecting\/calendar/);
 assert.match(api,/\/api\/prospecting\/preferences/);
});
test('training wizard, browser dictation, credentials and Francisca voice panel are reachable',()=>{
 for(const x of ['training-wizard-progress','trainingStep===1','trainingStep===2','trainingStep===3','training-reconfigure','training-dictate','SpeechRecognition','training-configured-grid','client-hours-form','account-profile','francisca-widget','toggleFranciscaRecording','francisca-interrupt'])assert.ok(app.includes(x),x);
 assert.ok(platform.includes('assistant\\/panel'));
 assert.ok(api.includes("handlePanelAssistant"));
 assert.ok(css.includes('.francisca-fab'));
 assert.match(css,/prefers-reduced-motion/);
});
test('hour preferences cannot expand the current policy window',()=>{
 assert.match(api,/start<480/);
 assert.match(api,/end>1050/);
 assert.match(api,/end-start<30/);
});
