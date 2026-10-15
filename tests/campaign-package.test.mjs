import test from 'node:test';
import assert from 'node:assert/strict';
import {extractStoredZip,buildCampaignSteps} from '../dashboard/campaign-package.mjs';
// Pequeno ZIP local não compactado, somente para teste do parser sem mídias reais.
function stored(name,data){
 const body=Buffer.from(data),file=Buffer.from(name);
 const b=Buffer.alloc(30);
 b.writeUInt32LE(0x04034b50,0);
 b.writeUInt16LE(20,4);
 b.writeUInt32LE(body.length,18);
 b.writeUInt32LE(body.length,22);
 b.writeUInt16LE(file.length,26);
 return Buffer.concat([b,file,body]);
}
const eof=Buffer.from([0x50,0x4b,0x01,0x02]);
test('imports three named media/manifest members with a strict stored ZIP',()=>{
 const bytes=Buffer.concat([stored('campaign.json','{"version":1}'),stored('audio.ogg','OggS'),stored('video.mp4','movie'),eof]);
 const p=extractStoredZip(bytes);
 assert.equal(p['audio.ogg'].toString(),'OggS');
 assert.equal(p['video.mp4'].toString(),'movie');
 assert.equal(p['campaign.json'].toString(),'{"version":1}');
});
test('rejects missing, duplicate and unexpected ZIP members',()=>{
 assert.throws(()=>extractStoredZip(Buffer.concat([stored('audio.ogg','a'),eof])),/incompleto/);
 assert.throws(()=>extractStoredZip(Buffer.concat([stored('audio.ogg','a'),stored('audio.ogg','b'),eof])),/duplicado/);
 assert.throws(()=>extractStoredZip(Buffer.concat([stored('../secret.txt','foo'),eof])),/não permitido/);
});
test('creates the confirmed-interest handover flow, not a website sample task',()=>{
 const steps=buildCampaignSteps({intro:'Posso apresentar uma proposta?',delay_seconds:45,description:'Áudio gravado pelo Wesley',farewell:'Obrigado pelo retorno!',audioId:'ogg-id',videoId:'mp4-id'});
 assert.deepEqual(steps.map(s=>s.type),['message','wait_reply','delay','audio','video','wait_reply','decision','end']);
 assert.equal(steps[3].media_id,'ogg-id');
 assert.equal(steps[4].media_id,'mp4-id');
 assert.equal(steps[6].yes_action,'handover');
 assert.equal(steps[6].no_action,'end');
 assert.equal(steps[6].no_text,'Obrigado pelo retorno!');
 assert.ok(!JSON.stringify(steps).includes('request_sample'));
});