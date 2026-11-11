import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'owner-recorded-offer-'));
process.env.FRANCISCA_TTS_ENABLED='false';
process.env.PROSPECTOR_PITCH_AUDIO_ENABLED='false';
const db=await import('../dashboard/db.mjs');
const {ownerApprovedOriginalOffer350}=await import('../dashboard/groq-sales-automation.mjs');
const {OWNER_CAMPAIGN_RULES_VERSION,mergeConsecomOwnerRules}=await import('../dashboard/consecom-owner-profile-rules.mjs');
test('only a completed original recording activates the R$350 offer guard',()=>{
 for(const stage of [undefined,null,'PENDING_AUDIO','AUDIO_ACCEPTED','UNKNOWN','NEEDS_REVIEW','CANCELLED'])
  assert.equal(ownerApprovedOriginalOffer350(stage?{stage}:null),false,String(stage));
 assert.equal(ownerApprovedOriginalOffer350({stage:'DONE'}),true);
});
test('v3 owner training correctly replaces old v2 instructions',()=>{
 const v2='## Regras obrigatórias da proposta Consecom — consecom-pinned-wesley-voice-20261111-v2\nOld R$ 550 marketing\n\n';
 const result=mergeConsecomOwnerRules('# Sales\n\n'+v2+'## Outros assuntos\nSem alteração.');
 assert.match(result,new RegExp(OWNER_CAMPAIGN_RULES_VERSION));
 assert.match(result,/áudio de 1min03s oferece o site por R\$ 350/);
 assert.doesNotMatch(result,/Old R\$ 550 marketing/);
 assert.match(result,/## Outros assuntos/);
 assert.equal(mergeConsecomOwnerRules(result),result);
});
test('sales engine must not render R$550 once R$350 original voice completed',()=>{
 const content=fs.readFileSync('dashboard/groq-sales-automation.mjs','utf8');
 assert.match(content,/originalOwnerAudio350=ownerApprovedOriginalOffer350\(pendingPitch\)/);
 assert.match(content,/audioOffer350=originalOwnerAudio350\|\|portfolioAudioSentFor/);
 assert.match(content,/originalOwnerAudio350\|\|portfolioPitchAudioEnabled\(\)/);
 assert.match(content,/fixedOffer=portfolioAllowed&&!campaign350&&!audioOffer350/);
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
