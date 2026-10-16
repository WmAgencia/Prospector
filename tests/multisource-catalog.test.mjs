import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-b2b-catalog-'));
const db=await import('../dashboard/db.mjs');
const {catalogQuery,catalogSummary}=await import('../dashboard/lead-catalog.mjs');
const {importOfficial,parseCSV,MAX_OFFICIAL_BATCH}=await import('../dashboard/official-import.mjs');
const {googleIndexStatus,googleResearchTick,searchGoogleIds,chooseGoogleResearch}=await import('../dashboard/google-places-index.mjs');
test('an official batch over 200 rows is accepted and searchable by city, niche and type',()=>{
 const records=Array.from({length:305},(_,i)=>({
  cnpj:String(12000000000000+i),
  nome_fantasia:'Estabelecimento '+i,
  municipio:i%2?'Votorantim':'Sorocaba',
  atividade:i%2?'Nutrição':'Dentistas',
  tipo_estabelecimento:i%2?'Autônomo':'Clínica',
  telefone:i%7===0?String(15990000000+i):''
 }));
 const result=importOfficial({source:'cnpj',records});
 assert.equal(result.added,305);
 assert.equal(result.invalid,0);
 assert.equal(importOfficial({source:'cnpj',records}).duplicates,305);
 const summary=catalogSummary();
 assert.equal(summary.total,305);
 assert.equal(summary.cities.find(x=>x.label==='Sorocaba').count,153);
 const first=catalogQuery({city:'Sorocaba',segment:'Dentistas',businessType:'Clínica',limit:12});
 assert.equal(first.total,153);assert.equal(first.leads.length,12);
 assert.ok(first.nextOffset!==null);
 const second=catalogQuery({city:'Sorocaba',segment:'Dentistas',businessType:'Clínica',offset:12,limit:12});
 assert.equal(second.leads.length,12);
 assert.notEqual(first.leads[0].id,second.leads[0].id);
 assert.equal(catalogQuery({quality:'A'}).total,0);
 assert.ok(catalogQuery({quality:'C'}).total>200);
 const id=first.leads.find(x=>x.phone)?.id||db.one('SELECT id FROM leads WHERE phone IS NOT NULL LIMIT 1').id;
 db.run("UPDATE leads SET website_status='NO_WEBSITE' WHERE id=?",id);
 assert.equal(catalogQuery({quality:'A'}).total,1);
 assert.ok(MAX_OFFICIAL_BATCH>=5000);
});
test('CSV parser allows large datasets and rejects malformed headers',()=>{
 const lines=['cnpj;nome_fantasia;municipio',...Array.from({length:350},(_,i)=>String(12000000000900+i)+';Empresa '+i+';Sorocaba')];
 assert.equal(parseCSV(lines.join('\n')).length,350);
 assert.throws(()=>parseCSV('cnpj;cnpj\n1;2\n'),/duplicado/);
});
test('Google Places requires its own key and never stores Google listing details in CRM',async()=>{
 const old=process.env.GOOGLE_PLACES_API_KEY;
 delete process.env.GOOGLE_PLACES_API_KEY;
 // OSM é a única fonte automática; o adaptador Google continua testável isoladamente.
 assert.equal((await googleResearchTick()).status,'DISABLED');
 db.setSetting('google_places_auto_enabled',true);
 db.setSetting('discovery_sources',{osm:true,google_places:true,cnpj:true});
 assert.equal((await googleResearchTick()).status,'NEEDS_API_KEY');
 const leadTotal=catalogSummary().total;
 process.env.GOOGLE_PLACES_API_KEY='fake-test-key';
 try{
  db.setSetting('cities','Sorocaba,Votorantim');
  db.setSetting('segments','dentista,nutricionista');
  db.setSetting('discovery_sources',{osm:true,google_places:true,cnpj:true});
  db.setSetting('google_places_auto_enabled',true);
  db.setSetting('google_daily_queries',4);
  let calls=0;
  const f=async(url,args)=>{
   calls++;assert.match(url,/places:searchText/);
   assert.equal(args.headers['X-Goog-FieldMask'],'places.id,nextPageToken');
   assert.ok(!args.body.includes('websiteUri'));assert.ok(!args.body.includes('internationalPhoneNumber'));
   const payload=JSON.parse(args.body);
   const page=payload.pageToken?'2':'1';
   return {ok:true,json:async()=>({places:[{id:'ChIJ_TestPlace_'+page}],nextPageToken:page==='1'?'NEXT':undefined})};
  };
  const stamp=new Date('2026-10-16T13:00:00.000Z');
  const r=await googleResearchTick(stamp,{fetcher:f});
  assert.equal(r.status,'COMPLETE');assert.equal(r.found,2);assert.equal(r.added,2);
  assert.equal(calls,2);
  assert.equal(googleIndexStatus(stamp).placeIdsIndexed,2);
  assert.equal(catalogSummary().total,leadTotal);
  const first=chooseGoogleResearch();
  assert.notEqual(first.city+'|'+first.segment,r.city+'|'+r.segment);
  const c=await googleResearchTick(new Date(stamp.getTime()+1000),{fetcher:f});
  assert.equal(c.status,'COOLDOWN');
  const raw=await searchGoogleIds('Sorocaba','Dentistas',{fetcher:f});
  assert.equal(raw.ids.length,2);
  assert.equal(db.one('SELECT COUNT(*) n FROM google_place_index').n,2);
  assert.equal(db.one("SELECT COUNT(*) n FROM leads WHERE source='google_places'").n,0);
 }finally{if(old===undefined)delete process.env.GOOGLE_PLACES_API_KEY;else process.env.GOOGLE_PLACES_API_KEY=old;}
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
