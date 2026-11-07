import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../dashboard/public/simple-app.js',import.meta.url),'utf8');
const style=fs.readFileSync(new URL('../dashboard/public/dashboard-purple.css',import.meta.url),'utf8');
const start=source.indexOf('function franciscaOnboarding(){');
const end=source.indexOf('function shell(){',start);
assert.ok(start>=0&&end>start);
const fn=source.slice(start,end);
const render=(items,runs=[],minimized=false)=>vm.runInNewContext(fn+'franciscaOnboarding()',{
 platformContext:{role:'client'},waAccounts:items,wa:{connected:items.some(x=>x.connected)},
 trainingState:{profile:{id:'approved'},runs},trainingSetupMinimized:minimized,
 esc:x=>String(x),glyph:()=>'<svg></svg>'
});

test('a pair of connected WhatsApps completes step one despite an offline unused channel',()=>{
 const html=render([
  {session_id:'one',connected:true},{session_id:'two',connected:true},{session_id:'unused',connected:false}
 ]);
 assert.match(html,/2 de 3 etapas concluídas/);
 assert.match(html,/fr-setup-row done/);
 assert.match(html,/2 número\(s\) online/);
 assert.doesNotMatch(html,/Conectar todos os WhatsApps/);
});
test('guide closes after analysis of current channels and returns when a NEW channel connects',()=>{
 const prior=[{status:'REVIEW',details:{sessions:['one','two']}}];
 assert.equal(render([{session_id:'one',connected:true},{session_id:'two',connected:true}],prior),'');
 const refreshed=render([
  {session_id:'one',connected:true},{session_id:'two',connected:true},{session_id:'new',connected:true}
 ],prior);
 assert.match(refreshed,/Analisar novo WhatsApp/);
 assert.match(refreshed,/2 de 3 etapas concluídas/);
 assert.doesNotMatch(refreshed,/data-tab-target="connections"/);
 const completed=render([
  {session_id:'one',connected:true},{session_id:'two',connected:true},{session_id:'new',connected:true}
 ],[{status:'REVIEW',details:{sessions:['one','two','new']}}]);
 assert.equal(completed,'');
});
test('guide begins compact and stays completely above sidebar layering',()=>{
 assert.match(source,/trainingSetupMinimized=true/);
 const small=render([{session_id:'one',connected:true}],[],true);
 assert.match(small,/is-minimized/);
 assert.doesNotMatch(small,/fr-setup-row/);
 assert.match(style,/\.fr-setup-widget\{left:104px!important;bottom:18px!important/);
 assert.match(style,/z-index:120!important/);
 assert.match(style,/\.shell:has\(\.side\.mobile-open\)~\.fr-setup-widget\{display:none\}/);
});
