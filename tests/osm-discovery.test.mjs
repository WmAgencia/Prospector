import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLocation,resolveSegment,extractPhone,extractInstagram,makeQuery,discoveryBoundingBox,prioritizeOSMResults,overpassEndpoints,DEFAULT_OVERPASS_ENDPOINT,FALLBACK_OVERPASS_ENDPOINT} from '../dashboard/osm-discovery.mjs';
test('cidades, acentos e segmentos suportados',()=>{
 assert.equal(resolveLocation('São Paulo').label,'São Paulo');
 assert.equal(resolveLocation('Votorantim').label,'Votorantim');
 assert.equal(resolveSegment('psicólogo').value,'psychotherapist');
 assert.equal(resolveSegment('arquiteto').value,'architect');
 assert.equal(resolveLocation('Local desconhecido'),null);
});
test('fontes públicas não inventam telefone, site ou permissões',()=>{
 assert.equal(extractPhone({}),null);
 assert.equal(extractPhone({phone:'+55 (15) 99999-8888'}),'5515999998888');
 assert.equal(extractInstagram({'contact:instagram':'https://instagram.com/empresa.oficial'}),'empresa.oficial');
 const q=makeQuery(resolveLocation('Sorocaba'),resolveSegment('dentista'));
 assert.match(q,/nwr\["amenity"="dentist"\]\["name"\]/);
 assert.match(q,/out center 120/);
 assert(!q.includes('around:'),'no unbounded radius scan');
 const center=discoveryBoundingBox(resolveLocation('Sorocaba'));
 const adjacent=discoveryBoundingBox(resolveLocation('Sorocaba'),1);
 assert.notEqual(center,adjacent);
 assert(q.includes('('+center+')'));
 assert.equal(discoveryBoundingBox(resolveLocation('Sorocaba'),9),center);
 assert.equal(extractPhone({'contact:whatsapp':'incompleto',phone:'+55 15 99999-8888'}),'5515999998888');
 assert.equal(extractPhone({'contact:mobile':'+55 (15) 99999-1111'}),'5515999991111');
 assert.equal(extractPhone({'phone:mobile':'+55 (15) 98888-7777'}),'5515988887777');
});

test('prioritiza telefone publicado sem descartar registros sem contato',()=>{
 const items=[
  {type:'node',id:1,tags:{name:'Empresa A'}},
  {type:'node',id:2,tags:{name:'Empresa B',phone:'+55 (15) 99999-0000'}},
  {type:'node',id:3,tags:{name:'Empresa C',website:'https://example.org'}},
  {type:'node',id:4,tags:{name:'Empresa D','contact:instagram':'https://instagram.com/teste.loja'}}
 ];
 const ordered=prioritizeOSMResults(items);
 assert.deepEqual(ordered.map(x=>x.id),[2,4,3,1]);
 assert.deepEqual(items.map(x=>x.id),[1,2,3,4]);
 assert.equal(ordered.length,4);
});

test('mirrors Overpass têm endpoints distintos e verificáveis, sem o alias legado desativado',()=>{
 const defaultHosts=overpassEndpoints('');
 assert.deepEqual(defaultHosts,[DEFAULT_OVERPASS_ENDPOINT,FALLBACK_OVERPASS_ENDPOINT]);
 assert.deepEqual(overpassEndpoints(DEFAULT_OVERPASS_ENDPOINT),defaultHosts);
 assert.deepEqual(overpassEndpoints('https://overpass-api.de/api/interpreter'),[
  'https://overpass-api.de/api/interpreter',DEFAULT_OVERPASS_ENDPOINT,FALLBACK_OVERPASS_ENDPOINT]);
 assert(defaultHosts.every(x=>!x.includes('kumi.systems')));
});
