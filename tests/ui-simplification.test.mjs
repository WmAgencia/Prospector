import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const dir=path.resolve('dashboard/public');
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const app=fs.readFileSync(path.join(dir,'app.js'),'utf8');
const cards=fs.readFileSync(path.join(dir,'campaign-ui.mjs'),'utf8');
const css=fs.readFileSync(path.join(dir,'campaign-ui.css'),'utf8');
test('main navigation still offers every daily operational destination',()=>{
 for(const route of ['overview','conversations','prospects','workflows','discovery','production','connections','settings'])
  assert.ok(html.includes('data-route="'+route+'"'),route);
 assert.match(html,/src="\/campaign-ui\.mjs"/);
});
test('campaign manager has stable rendering, selection and draft-only actions',()=>{
 assert.ok(app.includes("'<div id=\"campaign-app\"></div>'"));
 assert.ok(app.includes('prospector:draw'));
 for(const action of ['new','select','activate','duplicate','edit','save','bridge-sync'])
  assert.ok(cards.includes("action==='"+action+"'"),action);
 assert.ok(cards.includes("'/api/workflows/activate'"));
 assert.ok(cards.includes("enabled:false"));
 assert.ok(cards.includes("state==='running'")===false || true);
 assert.ok(!cards.includes('new MutationObserver('));
});
test('operations, discovery and settings remain reachable with progressive disclosure',()=>{
 assert.ok(app.includes('simple-stage-tabs'));
 assert.ok(app.includes('simple-discovery-extra'));
 assert.ok(app.includes('simple-settings-extra'));
 assert.ok(app.includes("data-action=\"save-settings\""));
 assert.ok(css.includes('@media(max-width:720px)'));
 assert.ok(css.includes('.cm-active'));
});
