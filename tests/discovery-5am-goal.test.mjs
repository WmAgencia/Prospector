import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-discovery-5am-'));
const db=await import('../dashboard/db.mjs');
const osm=await import('../dashboard/osm-discovery.mjs');
const radar=await import('../dashboard/radar.mjs');
const localDay=radar.daySP();
const localAt=(hour,minute=0)=>new Date(localDay+'T'+String(hour+3).padStart(2,'0')+':'+String(minute).padStart(2,'0')+':00.000Z');
test('discovery starts at 05:00 even while messaging is paused, and has no 18h stop',()=>{
 db.setSetting('paused',true);
 db.setSetting('business_start',8);db.setSetting('business_end',18);
 db.setSetting('discovery_start_hour',5);
 assert.deepEqual(osm.discoveryWindow(localAt(4,59),5),{hour:4,start:5,allowed:false});
 assert.equal(osm.discoveryWindow(localAt(5),5).allowed,true);
 assert.equal(osm.discoveryWindow(localAt(18,30),5).allowed,true);
 const budget=radar.budgetConfig(localAt(6));
 assert.equal(budget.start,8);assert.equal(budget.end,18);
 assert.equal(radar.canSendInitial(localAt(6)),false);
 const snapshot=radar.radarSnapshot(localAt(5));
 assert.notEqual(snapshot.discoveryReason,'PAUSED');
 assert.equal(snapshot.discoveryStartHour,5);
});
test('progressive OSM discovery counts unique new leads and stops exactly at 150',async()=>{
 db.setSetting('paused',true);
 db.setSetting('discovery_auto_enabled',true);
 db.setSetting('discovery_sources',{osm:true});
 db.setSetting('discovery_start_hour',5);
 db.setSetting('discovery_target_daily',150);
 db.setSetting('cities','Sorocaba,Votorantim,Campinas');
 db.setSetting('segments','dentista,nutricionista,psicólogo');
 const original=globalThis.fetch;
 let calls=0;
 globalThis.fetch=async ()=>{
  calls++;
  const elements=Array.from({length:70},(_,i)=>({type:'node',id:calls*10000+i,tags:{name:'Empresa de teste '+calls+'-'+i}}));
  return {ok:true,status:200,text:async()=>JSON.stringify({elements})};
 };
 try{
  const before=await osm.dailyLocalDiscovery(localAt(4,59));
  assert.equal(before.status,'BEFORE_START');assert.equal(calls,0);
  const first=await osm.dailyLocalDiscovery(localAt(5));
  assert.equal(first.added,70);assert.equal(calls,1);
  const pausedStillTrue=db.getSetting('paused',false);assert.equal(pausedStillTrue,true);
  const cooldown=await osm.dailyLocalDiscovery(localAt(5,20));assert.equal(cooldown.status,'COOLDOWN');
  const second=await osm.dailyLocalDiscovery(localAt(5,46));
  assert.equal(second.added,70);assert.equal(calls,2);
  const third=await osm.dailyLocalDiscovery(localAt(6,32));
  assert.equal(third.added,10);assert.equal(calls,3);
  const snapshot=radar.radarSnapshot();
  assert.equal(snapshot.foundToday,150);
  assert.equal(snapshot.discoveryReason,'TARGET_REACHED');
  const later=await osm.dailyLocalDiscovery(localAt(19));
  assert.equal(later.status,'TARGET_REACHED');
  assert.equal(calls,3,'no extra provider requests after the target');
  assert.equal(db.one('SELECT COUNT(*) n FROM leads').n,150);
  assert.equal(db.one('SELECT COUNT(*) n FROM leads WHERE contact_permission=1').n,0);
 }finally{globalThis.fetch=original;}
});
test('user-defined initial approach window stays between 08 and 18, with 150 cap',()=>{
 const conf=radar.budgetConfig(localAt(12));
 assert.equal(conf.limit,150);
 assert.equal(conf.start,8);
 assert.equal(conf.end,18);
 assert.equal(conf.intervalSeconds,240);
});

test('limite de consultas públicas expandido sem eliminar o espaçamento',()=>{
 assert.equal(osm.OSM_DAILY_MAX_SEARCHES,12);
 assert.equal(osm.OSM_COOLDOWN_MS,45*60000);
});
