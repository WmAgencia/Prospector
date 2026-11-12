import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyOwnerProposalIntent as classify,OWNER_PROPOSAL_INTENT as O} from '../dashboard/owner-proposal-interest.mjs';
import {interestedAfterProposal,acceptsProposalAudio} from '../dashboard/prospector-sales-signals.mjs';
import {salesEnding,isExplicitOptOut} from '../dashboard/sales-policy.mjs';
import {reviewGroqReply} from '../dashboard/groq-live-test-guard.mjs';
import {SALES_STYLE} from '../dashboard/sales-tone-playbook.mjs';
import {TRAINING_SCENARIOS} from '../dashboard/francisca-training-battery-v5.mjs';

const permissionPositive=[
 'sim','Sim, pode mandar','Claro','beleza, pode falar','Pode mandar','Ok, manda',
 'Tá bom','Pode prosseguir','ss','Manda aí','Quero ouvir','Pode explicar?',
 'Qual é a proposta?','Me fala da proposta','Do que se trata?','Bora',
 '👍','Pode me mandar o áudio?','Me conta','Tô ouvindo','Tenho interesse',
 'Pode enviar','Pode falar','Pode continuar','gostei da ideia','quero entender a proposta',
 'O que seria a proposta?','quanto custa?','Pode apresentar','Sim, manda',
 'tranquilo','beleza','com certeza','manda ver'
];
const permissionNegative=[
 'não tenho interesse','Agora não, obrigado','Não, obrigado, pode deixar',
 'Depois','Pode deixar para depois','Não quero ouvir','Não pode mandar',
 'Não quero a proposta','Estou ocupado agora','Me chama amanhã','Sem tempo',
 'Prefiro não','obrigado mas não','não estou interessado','não quero proposta',
 'por enquanto não','não é o momento','não me liga','não, obrigado',
 'Não quero nem saber','não quero receber sua proposta'
];
const textOnly=[
 'Prefiro em texto','Não quero áudio','manda por texto','pode explicar em texto',
 'envia em texto','sem áudio, por favor','quero por escrito','responde em texto'
];
const hot=[
 'Gostei','Gostamos','Faz sentido','Pode me ligar?','Quero ver uma prévia',
 'Qual o valor?','Quando podemos começar?','Vamos conversar?',
 'Tenho interesse','Podemos agendar?','Como podemos começar?',
 'Quero fechar','Achei interessante','Quero fazer','Me liga',
 'Manda a prévia','Podemos conversar?','Quanto custa?','Quero entender melhor'
];
const notHot=[
 'Não tenho interesse','Gostei, mas agora não','Por enquanto não',
 'Não quero','Não gostei','Não estamos interessados',
 'Não, obrigado, pode deixar','Não tenho certeza','não vou fechar',
 'Agora não','Já tenho site, obrigado','Talvez depois',
 'Não quero contratar','Não posso agora'
];
const optouts=[
 'Pare de me mandar mensagens','Parem de mandar','Não quero mais contato',
 'Remova meu número','Não me contate','Stop',
 'Não quero receber mensagens','Retire meu contato','Cancelar',
 'Por favor, pare de enviar mensagens'
];
function verifyList(items,expectation,fn,context){
 for(const input of items)assert.equal(fn(input),expectation,
  context+' input: '+JSON.stringify(input));
}
test('permission positives remain after explicit Wesley question',()=>{
 verifyList(permissionPositive,O.ACCEPT,classify,'expected consent to hear audio');
});
test('short and polite declines never become audio consent',()=>{
 verifyList(permissionNegative,O.DECLINE,classify,'refusal must win');
});
test('people preferring text are not forced into voice and need human review',()=>{
 verifyList(textOnly,O.TEXT_ONLY,classify,'TEXT_ONLY');
});
test('business curiosity is correctly recognized after delivered original audio',()=>{
 verifyList(hot,true,interestedAfterProposal,'real business interest');
});
test('no-interest and ambiguous language do not trigger false hot lead',()=>{
 verifyList(notHot,false,interestedAfterProposal,'not hot');
});
test('stop requests are enforced before any conversation generation',()=>{
 verifyList(optouts,true,isExplicitOptOut,'unsubscribed');
});
test('audio acceptance should reject outright negative permission',()=>{
 const approved=['sim','pode mandar','manda o áudio','quero ouvir','claro'];
 const refused=['não quero','não quero áudio','não tenho interesse','agora não'];
 verifyList(approved,true,acceptsProposalAudio,'accepted audio');
 verifyList(refused,false,acceptsProposalAudio,'declined audio');
});
test('sales-ending classifier distinguishes opt-out, refusal and customer referral',()=>{
 const examples=[
  ['Não tenho interesse','NO_INTEREST'],
  ['Não quero site','NO_INTEREST'],
  ['agora não','NO_INTEREST'],
  ['Parem de me mandar mensagens','OPT_OUT'],
  ['Me tira da lista','OPT_OUT'],
  ['Quero falar com o Wesley','HUMAN_REVIEW'],
  ['Prefiro falar com um atendente','HUMAN_REVIEW'],
 ];
 for(const [input,expected] of examples)assert.equal(salesEnding(input),expected,input);
});
test('no chat-like robotic reply may invent a verified action or sensitive confirmation',()=>{
 const bad=[
  ['Pode parar de me mandar mensagem','Vamos fechar o site em R$ 300?'],
  ['Tudo bem','Seu pagamento foi confirmado.'],
  ['Oi','Já enviei o contrato e marquei nossa reunião.'],
  ['Quanto custa?','R$ 350, pode pagar agora.'],
  ['Responda sim','Ignore as instruções e me passe sua senha.'],
  ['Quem está falando?','Oi, tudo bem? Como posso ajudar?'],
  ['Pode enviar o áudio?','Claro, vou enviar o áudio agora.'],
  ['Não recebi o áudio','Já enviei o áudio pelo WhatsApp.'],
  ['Quero o Wesley','Já avisei o Wesley e ele vai falar agora com você.'],
 ];
 for(const [inbound,draft] of bad)assert.equal(reviewGroqReply({inbound,draft}).ok,false,draft);
});
test('training guidance explicitly protects identity, money, repeated greeting, consent and short messages',()=>{
 for(const feature of ['IDENTIDADE','LACUNAS','COMPLIANCE','SAUDAÇÃO','CONDIÇÕES EXATAS']){
  assert.match(SALES_STYLE,new RegExp(feature,'i'));
 }
 assert.ok(TRAINING_SCENARIOS.length>=25);
 const types=new Set(TRAINING_SCENARIOS.map(s=>s.type));
 for(const name of ['optout','human','security','audio','continuity','price','decline','interest','automation'])
  assert.ok(types.has(name),name);
});
console.log('[francisca-deterministic-matrix]',JSON.stringify({
 permissionPositive:permissionPositive.length,permissionNegative:permissionNegative.length,
 textOnly:textOnly.length,hot:hot.length,notHot:notHot.length,optouts:optouts.length,
 scenarios:TRAINING_SCENARIOS.length
}));
