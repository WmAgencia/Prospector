import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeAudioTranscripts} from '../dashboard/waakg-conversations.mjs';
test('WhatsApp remote chat shows one labeled verified audio transcription in chronological order',()=>{
 const remote=[{id:'first',direction:'in',body:'Oi',at:'2026-10-29T10:00:00Z'}];
 const transcript=[{provider_id:'consecom-principal:MSG1234',body:'Olá, quero um orçamento para meu site.',at:'2026-10-29T10:00:02Z'}];
 const result=mergeAudioTranscripts(remote,transcript);
 assert.equal(result.length,2);
 assert.equal(result[0].body,'Oi');
 assert.equal(result[1].transcript,true);
 assert.match(result[1].body,/🎙 Áudio transcrito: Olá, quero um orçamento/);
 assert.equal(result[1].direction,'in');
});
test('Chat merge does not fabricate transcriptions without verified audio records',()=>{
 const messages=[{id:'audio',direction:'in',body:'[Áudio]',at:'2026-10-29T10:00:00Z'}];
 assert.deepEqual(mergeAudioTranscripts(messages,[]),messages);
});
test('Chat merge respects last 100 messages',()=>{
 const many=Array.from({length:130},(_,i)=>({id:String(i),direction:'in',body:String(i),at:i*1000}));
 assert.equal(mergeAudioTranscripts(many,[]).length,100);
});
