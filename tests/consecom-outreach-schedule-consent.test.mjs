import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {explicitlyAcceptsProposal,explicitlyDeclinesProposal} from '../dashboard/proposal-acceptance.mjs';
import {APPROACH_CADENCE,chooseApproachInterval} from '../dashboard/approach-cadence.mjs';

test('first proposal permission must be explicit; vague greetings never trigger pitch',()=>{
 const agreed=['Sim, pode mandar!','Olá, tudo bem? Pode enviar a proposta.','Pode falar','Pode explicar','Hum, queria saber mais','Claro!','Quanto custa?'];
 const refused=['Oi, tudo bem?','Tudo bem!','Não','Não, obrigado','Sem interesse','Sim, mas não quero proposta','Mensagem automática','Ok','Legal'];
 for(const text of agreed)assert.equal(explicitlyAcceptsProposal(text),true,'accepted: '+text);
 for(const text of refused)assert.equal(explicitlyAcceptsProposal(text),false,'refused/unclear: '+text);
});
test('negative answers terminate the pending proposal; vague replies do not authorize',()=>{
 for(const msg of ['Não','não, obrigado','Sem interesse','Agora não','prefiro não','não estou interessado'])
  assert.equal(explicitlyDeclinesProposal(msg),true,msg);
 for(const msg of ['Olá, tudo bem?','Tudo bem','Sim, pode enviar','Hum, queria saber mais'])
  assert.equal(explicitlyDeclinesProposal(msg),false,msg);
 const introduction=fs.readFileSync(new URL('../dashboard/prospecting-introduction.mjs',import.meta.url),'utf8');
 const bridge=fs.readFileSync(new URL('../dashboard/waakg-bridge.mjs',import.meta.url),'utf8');
 assert.match(introduction,/if\(explicitlyDeclinesProposal\(body\)\)/);
 assert.match(bridge,/state='NO_INTEREST'/);
 assert.match(bridge,/grantAutonomousFirstReply\(lead\.id,content,intro\.greeting_id\)/);
 assert.doesNotMatch(bridge,/PROSPECTOR_AUTONOMOUS_FIRST_REPLY==='true'/);
});
test('every randomized interval remains 90–110 seconds and differs by 5 seconds',()=>{
 assert.equal(APPROACH_CADENCE.minSeconds,90);
 assert.equal(APPROACH_CADENCE.maxSeconds,110);
 for(let prev=90000;prev<=110000;prev+=1000){
  let n=0;chooseApproachInterval(prev,size=>{n=size;return 0;});
  assert.ok(n>=10&&n<=21);
  for(let i=0;i<n;i++){
   const v=chooseApproachInterval(prev,()=>i);
   assert.ok(v>=90000&&v<=110000);
   assert.ok(Math.abs(v-prev)>=5000);
  }
 }
});
test('no consent bypass; typing signal precedes outbound first send',()=>{
 const queue=fs.readFileSync(new URL('../dashboard/prospecting-queue.mjs',import.meta.url),'utf8');
 const first=queue.indexOf("presence:'composing'");
 const sent=queue.indexOf("const result=await send('/api/messages/");
 assert.ok(first>=0&&sent>first);
 assert.match(queue,/if\(requiresDocumentedOptIn\(\)&&!documentedOptIn\(l\.id\)\)return null/);
 assert.match(queue,/presence:'paused'/);
 const greeting=fs.readFileSync(new URL('../dashboard/prospecting-introduction.mjs',import.meta.url),'utf8');
 assert.match(greeting,/Olá, tudo bem\? Me chamo Wesley, sou dono da Consecom/);
 assert.match(greeting,/if\(!explicitlyAcceptsProposal\(body\)\)/);
});
test('auto Google Maps research starts at midnight São Paulo but no WhatsApp consent is inferred',()=>{
 const maps=fs.readFileSync(new URL('../dashboard/gosom-maps.mjs',import.meta.url),'utf8');
 assert.match(maps,/AUTO_MAPS_RESEARCH_START_HOUR_SP=0/);
 assert.match(maps,/auto_discovery=1/);
 assert.match(maps,/contact_permission:false/);
});
