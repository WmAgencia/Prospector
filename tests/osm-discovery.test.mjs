import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLocation,resolveSegment,extractPhone,extractInstagram,makeQuery,prioritizeOSMResults} from '../dashboard/osm-discovery.mjs';
test('cidades, acentos e segmentos suportados',()=>{
 assert.equal(resolveLocation('São Paulo').label,'São Paulo');
 assert.equal(resolveLocation('Votorantim').label,'Votorantim');
 assert.equal(resolveSegment('psicólogo').value,'psychotherapist');
 assert.equal(resolveSegment('arquiteto').value,'architect');
 assert.equal(resolveSegment('fisioterapeuta').value,'physiotherapist');
 assert.equal(resolveSegment('psicóloga').value,'psychotherapist');
 assert.equal(resolveLocation('Local desconhecido'),null);
});
test('fontes públicas não inventam telefone, site ou permissões',()=>{
 assert.equal(extractPhone({}),null);
 assert.equal(extractPhone({phone:'+55 (15) 99999-8888'}),'5515999998888');
 assert.equal(extractPhone({'contact:whatsapp':'inválido','contact:phone':'+55 15 99999-8877'}),'5515999998877');
 assert.equal(extractPhone({mobile:'+55 15 99999-8855'}),'5515999998855');
 assert.equal(extractInstagram({'contact:instagram':'https://instagram.com/empresa.oficial'}),'empresa.oficial');
 const q=makeQuery(resolveLocation('Sorocaba'),resolveSegment('dentista'));
 assert.match(q,/nwr\["amenity"="dentist"\]\["name"\]/);
 assert.match(q,/out center 70/);
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
