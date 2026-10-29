import test from 'node:test';
import assert from 'node:assert/strict';
import {newCallContext,voiceInterruptionHint} from '../dashboard/francisca-voice-context.mjs';
import {InterruptionLedger,BackchannelPolicy} from '../waakg-voice/conversation-runtime.mjs';

test('Related correction and additional requirement retain the previous task and incomplete answer',()=>{
 const c=newCallContext();
 c.remember({heard:'Construa uma agenda com lembretes para clientes',
  spoken:'Vou criar a agenda com notificações e calendário.',
  replyId:'123e4567-e89b-12d3-a456-426614174000',totalMs:5000});
 assert(c.noteInterruption({replyId:'123e4567-e89b-12d3-a456-426614174000',playedMs:1700,totalMs:5000}));
 const note=c.systemNote('Não, inclui também confirmação por WhatsApp');
 assert.match(note,/CORTADA/);
 assert.match(note,/34%/);
 assert.match(note,/agenda/);
 assert.match(note,/ADIÇÃO OU CORREÇÃO/);
 assert.deepEqual(c.messages().map(x=>x.role),['user','assistant']);
 assert.match(c.messages()[0].content,/lembretes/);
});
test('Explicit switch discards immediate focus but retains prior history for later',()=>{
 const c=newCallContext();
 c.remember({heard:'Faça uma integração de agenda',spoken:'Vou integrar agenda e CRM.',
  replyId:'123e4567-e89b-12d3-a456-426614174000',totalMs:3000});
 c.noteInterruption({replyId:'123e4567-e89b-12d3-a456-426614174000',playedMs:300,totalMs:3000});
 const note=c.systemNote('Não, não, muda de assunto, responde isso aqui rapidinho');
 assert.match(note,/MUDANÇA EXPLÍCITA/);
 assert.match(note,/CORTADA/);
 assert.equal(voiceInterruptionHint('Vamos falar de outra coisa'),'switch');
 assert.equal(voiceInterruptionHint('Pode colocar mais detalhes?'),'infer');
 assert.equal(voiceInterruptionHint('Adiciona pagamento por PIX'),'extend');
 assert.equal(c.messages().length,2);
});
test('Unrelated speech can be classified semantically by model while continuity remains',()=>{
 const c=newCallContext();
 c.remember({heard:'Conclua o relatório',spoken:'O relatório indica crescimento.',
  replyId:'123e4567-e89b-12d3-a456-426614174001',totalMs:1400});
 const note=c.systemNote('Qual a previsão para amanhã?');
 assert.match(note,/claramente independente/);
 assert.equal(voiceInterruptionHint('Qual a previsão para amanhã?'),'infer');
 assert.equal(c.noteInterruption({replyId:'other',playedMs:500,totalMs:1000}),false);
 assert.doesNotMatch(c.systemNote('Continue'),/CORTADA/);
});
test('Context is bounded and cleared at the end of the call',()=>{
 const c=newCallContext();
 for(let i=0;i<22;i++)c.remember({heard:'Pergunta '+i,spoken:'Resposta '+i,replyId:'id'+i,totalMs:1000});
 assert.equal(c.messages().length,24);
 assert.match(c.messages()[0].content,/Pergunta 10/);
 c.clear();
 assert.equal(c.messages().length,0);
 assert.equal(c.last(),null);
});
test('Ledger correctly reflects partial answer only if its playback id matches',()=>{
 const l=new InterruptionLedger();
 assert(!l.begin('fake',1000));
 assert(l.begin('123e4567-e89b-12d3-a456-426614174000',4000));
 l.progress(400);l.progress(1100);l.progress(700);
 assert(l.interrupt());
 assert.deepEqual(l.take(),{replyId:'123e4567-e89b-12d3-a456-426614174000',playedMs:1100,totalMs:4000});
 assert.equal(l.take(),null);
 assert(l.unseen('123e4567-e89b-12d3-a456-426614174001',3000));
 assert.equal(l.take().playedMs,0);
 l.clear();
 assert.equal(l.take(),null);
});
test('Backchannels are sparse: only long speech, never while answering, cooldown and one per utterance',()=>{
 const p=new BackchannelPolicy();
 const eligible={voicedSamples:16000*4,now:100000};
 assert(!p.canPlay({...eligible,voicedSamples:16000}));
 assert(!p.canPlay({...eligible,replying:true}));
 assert(!p.canPlay({...eligible,playing:true}));
 assert(!p.canPlay({...eligible,ended:true}));
 assert(p.canPlay(eligible));
 assert.equal(p.played(100000),'aham');
 assert(!p.canPlay({...eligible,now:130000}));
 p.resetTurn();
 assert(!p.canPlay({...eligible,now:110000}));
 assert(p.canPlay({...eligible,now:130000}));
 assert.equal(p.played(130000),'aham');
 p.resetTurn();
 assert.equal(p.played(146000),'hum');
});
