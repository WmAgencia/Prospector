import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLocation,resolveSegment,extractPhone,extractInstagram,makeQuery} from '../dashboard/osm-discovery.mjs';
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
 assert.match(q,/out center 70/);
});
