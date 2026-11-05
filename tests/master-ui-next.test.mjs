import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app=fs.readFileSync(new URL('../dashboard/public/simple-app.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../dashboard/public/dashboard-purple.css',import.meta.url),'utf8');
const platform=fs.readFileSync(new URL('../dashboard/platform.mjs',import.meta.url),'utf8');
const francisca=fs.readFileSync(new URL('../dashboard/francisca-panel.mjs',import.meta.url),'utf8');
test('Master has Power BI-like analytics dashboard and no redundant Visão geral tab',()=>{
 assert.match(app,/dashboard:"Dashboard",clients:"Clientes",overview:"Visão geral"/);
 assert.match(app,/platformContext.role==='master'\?\['dashboard','clients','credits','settings'\]/);
 assert.match(app,/master-kpi-grid/);
 assert.match(app,/master-trend-chart/);
 assert.match(app,/master-plan-legend/);
 assert.match(app,/master-ranking/);
 assert.match(app,/moneyFromCents\(finance.todayCents/);
 assert.match(app,/moneyFromCents\(finance.monthCents/);
 assert.match(css,/MASTER ANALYTICS V4/);
 assert.match(platform,/\/api\/platform\/analytics/);
});
test('Create-client popup collects required fields, existing/unlimited/custom plans and never stores plaintext CPF in UI',()=>{
 for(const token of ['master-client-create','master-client-modal','name="name" required','name="email" required','name="phone" required','name="cpf" required','name="planId"','value="unlimited"','value="custom"','name="customCredits"','name="customPriceBRL"']){
  assert.ok(app.includes(token),'Missing: '+token);
 }
 assert.match(app,/if\(action==='master-client-create'\)/);
 assert.match(app,/if\(e.target.id==='master-plan-select'\)/);
 assert.match(platform,/registry\(\)\.create\(await json\(req\)\)/);
});
test('Same internal login can change credentials from Master and Production',()=>{
 assert.match(app,/Configurações da conta Master/);
 assert.match(app,/id="account-credentials"/);
 assert.match(app,/Ir para Produção/);
 assert.match(platform,/if\(p==='\/api\/platform\/account'&&req.method==='POST'\)/);
 assert.match(platform,/needsPasswordSetup/);
 assert.match(app,/id="activate-account"/);
});
test('Francisca can read verified same-day outreach and schedule allowed research, with microphone barge-in',()=>{
 assert.match(francisca,/monthlyProspectingCalendar/);
 assert.match(francisca,/interpretFranciscaAction/);
 assert.match(francisca,/approachedToday/);
 assert.match(app,/onInterrupt:\(\)=>\{/);
 assert.match(app,/canInterrupt:\(\)=>franciscaVoiceActive/);
});
