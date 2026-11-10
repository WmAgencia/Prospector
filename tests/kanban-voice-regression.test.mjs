import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {wantsPortfolioPitchAudio} from '../dashboard/portfolio-pitch-audio.mjs';
import {loadCurrentPortfolioVoice,CURRENT_VOICE_PITCH_TEXT,CURRENT_VOICE_OFFER_BRL} from '../dashboard/portfolio-pitch-voice-550.mjs';

test('natural proposal questions trigger current portfolio voice',()=>{
 for(const phrase of ['Que tipo de proposta?', 'Qual o tipo de oferta?', 'Como assim essa proposta?', 'Qual seria essa proposta?', 'Pode me explicar a proposta?']){
  assert.equal(wantsPortfolioPitchAudio(phrase),true,phrase);
 }
 assert.equal(wantsPortfolioPitchAudio('Olá, bom dia'),false);
 assert.equal(wantsPortfolioPitchAudio('Não quero receber ofertas'),false);
});
test('generated voice mentions approved R$550 rather than an obsolete R$350 recording',async()=>{
 assert.equal(CURRENT_VOICE_OFFER_BRL,550);
 assert.match(CURRENT_VOICE_PITCH_TEXT,/R\$ 550/);
 assert.doesNotMatch(CURRENT_VOICE_PITCH_TEXT,/R\$ 350/);
 const before=process.env.FRANCISCA_TTS_ENABLED;
 process.env.FRANCISCA_TTS_ENABLED='true';
 try{
  const asset=await loadCurrentPortfolioVoice({synthesize:async(text)=>{
   assert.equal(text,CURRENT_VOICE_PITCH_TEXT);
   return {bytes:Buffer.alloc(1200,21)};
  }});
  assert.equal(asset.offerBRL,550);
  assert.equal(asset.source,'FRANCISCA_TTS');
  assert.ok(asset.bytes.length>256);
 }finally{
  if(before===undefined)delete process.env.FRANCISCA_TTS_ENABLED;
  else process.env.FRANCISCA_TTS_ENABLED=before;
 }
});
test('Kanban shows two cards per column then allows document scroll to metrics',()=>{
 const css=readFileSync(new URL('../dashboard/public/dashboard-purple.css',import.meta.url),'utf8');
 const js=readFileSync(new URL('../dashboard/public/simple-app.js',import.meta.url),'utf8');
 assert.match(css,/kanban-dashboard \.kanban-columns\s*\{[^}]*height:448px!important/s);
 assert.match(css,/kanban-dashboard \.kanban-column-items\s*\{[^}]*overflow-y:auto!important;overscroll-behavior-y:auto!important/s);
 const board=js.indexOf("'<div class=\"kanban-columns\"");
 const metrics=js.indexOf('overviewDimensionSection()+',board);
 assert.ok(board>=0&&metrics>board,'city/niche metrics follow the Kanban');
});
