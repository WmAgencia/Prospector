import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/groq-channel-');
const db=await import('../dashboard/db.mjs');
const channel=await import('../dashboard/groq-reply-channels.mjs');
const samples=[
 ['Me responde por texto, não em áudio','TEXT',false],
 ['Me envia uma mensagem em texto, não em áudio','TEXT',false],
 ['Prefiro que responda por escrito','TEXT',false],
 ['Pode mandar só texto?','TEXT',false],
 ['Por favor envie os dois, texto e áudio','BOTH',false],
 ['Quero áudio e texto juntos','BOTH',false],
 ['Me manda em áudio, por favor','VOICE',false],
 ['Manda uma nota de voz','VOICE',false],
 ['Daqui pra frente, me responda só por texto','TEXT',true],
 ['De agora em diante, prefiro mensagens em áudio','VOICE',true],
 ['Sempre envie os dois, texto e áudio','BOTH',true],
 ['Pode analisar o texto do meu site? ',null,false],
 ['Quais são as opções do nosso site?',null,false]
];
test('Explicit mode and persistent preference are detected across Brazilian phrasing',()=>{
 for(const [message,expected,persistent] of samples){
  const instruction=channel.explicitChannelRequest(message);
  assert.equal(instruction?.mode||null,expected,message);
  if(instruction)assert.equal(instruction.persistent,persistent,message);
 }
});
test('Explicit TEXT overrides incoming audio and reports',()=>{
 const actual=channel.chooseReplyChannel({inbound:'Me explica o relatório só por texto, sem áudio',
  draft:'Resumo do relatório de vendas.',wasAudio:true,isOperatorTest:true,voiceAvailable:true});
 assert.equal(actual.mode,'TEXT');assert.equal(actual.voice,false);assert.equal(actual.text,true);
});
test('Reports prefer both; urgent client notices and formal records prefer text',()=>{
 const cases=[
  ['Me explica o relatório de campanhas','Tudo certo!','BOTH'],
  ['Qual foi o desempenho das campanhas?','Aqui está o resumo de resultados','BOTH'],
  ['Cliente da oficina precisa de você agora, telefone 15999999999','Cliente solicitou contato','TEXT'],
  ['Preciso do contrato por escrito','Vou preparar os dados','TEXT'],
  ['O pagamento vence amanhã','Vou verificar os dados','TEXT'],
  ['Quem é você?','Sou uma assistente virtual','VOICE']
 ];
 for(const [inbound,draft,expected] of cases)
  assert.equal(channel.chooseReplyChannel({inbound,draft,isOperatorTest:true,voiceAvailable:true}).mode,expected,inbound);
});
test('Default textual chat stays text; simple voice chats get Francisca; disabled TTS falls back to text',()=>{
 assert.equal(channel.chooseReplyChannel({inbound:'Oi',isOperatorTest:false,wasAudio:false,voiceAvailable:true}).mode,'TEXT');
 assert.equal(channel.chooseReplyChannel({inbound:'Oi',isOperatorTest:false,wasAudio:true,voiceAvailable:true}).mode,'VOICE');
 assert.equal(channel.chooseReplyChannel({inbound:'Oi',isOperatorTest:true,wasAudio:true,voiceAvailable:false}).mode,'TEXT');
 assert.equal(channel.chooseReplyChannel({inbound:'Envie em áudio',voiceAvailable:false}).mode,'TEXT');
});
test('Saved preferences remain scoped to exactly one chat',()=>{
 assert.equal(channel.saveChannelPreference('5515981817336@s.whatsapp.net','TEXT'),true);
 assert.equal(channel.channelPreference('5515981817336@s.whatsapp.net'),'TEXT');
 assert.equal(channel.channelPreference('5515999999999@s.whatsapp.net'),null);
 assert.equal(channel.saveChannelPreference('bad', 'TEXT'),false);
});
test('Delivery ledger is idempotent per provider and channel',()=>{
 assert.equal(channel.reservePart('qa:message-1','TEXT'),true);
 assert.equal(channel.reservePart('qa:message-1','TEXT'),false);
 channel.acceptPart('qa:message-1','TEXT');
 assert.match(channel.partsFor('qa:message-1'),/TEXT:ACCEPTED/);
 assert.equal(channel.reservePart('qa:message-1','VOICE'),true);
 assert.match(channel.partsFor('qa:message-1'),/VOICE:UNKNOWN/);
});
test.after(()=>{db.db.close();fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});});
