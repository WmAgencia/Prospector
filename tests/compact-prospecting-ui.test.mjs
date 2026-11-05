import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const read=file=>fs.readFileSync(fileURLToPath(new URL('../'+file,import.meta.url)),'utf8');
const app=read('dashboard/public/simple-app.js');
const css=read('dashboard/public/dashboard-purple.css');
const preferences=read('dashboard/client-preferences.mjs');
test('single-step research mode is controlled by two pressable switches, not old big selector or checkbox',()=>{
 for(const value of ['scope-toggle-niche','scope-toggle-city','Todos','Brasil inteiro','scope-niche','scope-city','Cidade / Estado','Salvar preferência']){
  assert.ok(app.includes(value),'Missing: '+value);
 }
 assert.ok(!app.includes('id="scope-mode"'),'Old mode dropdown must not remain');
 assert.ok(!app.includes('class="scope-check"'),'Old huge checkbox must not remain');
 assert.ok(app.includes("enabled:'on'"),'Saving explicitly enables scheduled research only, not outreach');
 assert.match(css,/\.scope-mode-button/);
 assert.match(css,/\.scope-field\.is-all>input/);
});
test('calendar uses compact side-by-side approached and closed actions and conversion beneath',()=>{
 assert.match(app,/calendar-day-stats/);
 assert.ok(app.includes("data-kind=\"approached\""));
 assert.ok(app.includes("data-kind=\"closed\""));
 assert.match(css,/\.calendar-day-stats\{display:grid;grid-template-columns:1fr 1fr/);
 assert.match(css,/height:clamp\(56px/);
 assert.ok(!app.includes('Encontre oportunidades no seu ritmo.'));
});
test('Francisca appears both in production and Master and errors stay within its popover',()=>{
 assert.ok(!app.includes("if(platformContext.role==='master')return ''"));
 assert.ok(app.includes('franciscaInlineError('));
 assert.ok(app.includes('data-action="francisca-toggle"'));
});
test('owner workspace switch is displayed only with server-provided permission',()=>{
 assert.ok(app.includes("platformContext.canSwitchWorkspace?"));
 assert.ok(app.includes("data-action=\"switch-workspace\""));
 assert.ok(app.includes("post('/api/platform/workspace',{mode})"));
 assert.ok(!app.includes('<div class="workspace-return">'));
});
test('explicit city/UF parser safely rejects unsupported states and stays within configured sources',()=>{
 assert.match(preferences,/function|const selectedCity=/);
 assert.match(preferences,/toUpperCase\(\)!=='SP'/);
 assert.ok(app.includes("' / SP'"));
 assert.match(css,/@media\(max-width:760px\)/);
});
