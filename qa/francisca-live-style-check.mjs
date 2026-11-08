// Isolated executable quality audit of the same production Groq adapter.
// No WhatsApp clients, owner secrets, leads, billing actions, or live customer data.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'francisca-audit-'));
process.env.FRANCISCA_NATURAL_V1_ENABLED='true';
process.env.FRANCISCA_COMMERCIAL_BRAIN_V2_ENABLED='true';
delete process.env.PROSPECTOR_TENANT_ID;
delete process.env.PROSPECTOR_TENANT_INTERNAL;
const {aiDraft}=await import('../dashboard/ai-groq.mjs');
const {nextConversationState}=await import('../dashboard/francisca-conversation-state.mjs');
const {findStyleExamples}=await import('../dashboard/francisca-style-examples.mjs');
const {conversationalToneSignals}=await import('../dashboard/francisca-natural-conversation.mjs');
const {approvedLabFactReply,labModelReplySafe}=await import('../dashboard/francisca-lab-safety.mjs');
const {reviewGroqReply}=await import('../dashboard/groq-live-test-guard.mjs');
const {db}=await import('../dashboard/db.mjs');
console.log('QA_START',JSON.stringify({liveGroqKeyConfigured:!!process.env.GROQ_API_KEY,model:process.env.GROQ_MODEL||'auto',synthetic:true,whatsapp:false,realCustomers:false,db:'temporary',cases:13}));
if(!process.env.GROQ_API_KEY){console.log('QA_ABORT',JSON.stringify({reason:'NO_GROQ_KEY_REFERENCE'}));process.exit(2);}
const results=[];
const short=s=>String(s||'').replace(/\s+/g,' ').slice(0,440);
async function oneTurn(label,incoming,withStyle,history=[]){
 process.env.FRANCISCA_STYLE_EXAMPLES_V1_ENABLED=withStyle?'true':'false';
 const state=nextConversationState({},[...history.map(m=>({direction:m.role==='user'?'in':'out',body:m.text})),{direction:'in',body:incoming}]);
 const extra='SIMULAÇÃO INTERNA DE CONVERSA COM CLIENTE FICTÍCIO. Não há WhatsApp, lead, pagamento nem envio.\n'+
  history.map(m=>(m.role==='user'?'Cliente: ':'Consecom: ')+m.text.replace(/[\r\n]+/g,' ')).join('\n');
 let response;
 try{response=await aiDraft({text:incoming,context:extra,audience:'PROSPECT_APPROACHED',commercialMode:'SIMULATION',dialogueState:{hasAssistantReply:history.some(x=>x.role==='assistant'),salesMemory:state}});}
 catch(err){response={ok:false,code:'THREW_'+String(err.message||err).slice(0,80)};}
 const draft=response.ok?response.draft:'';
 const after=response.ok?labModelReplySafe({incoming,history,draft}):null;
 const review=response.ok?reviewGroqReply({inbound:incoming,draft}):null;
 const tone=conversationalToneSignals(draft);
 const chosen=withStyle?findStyleExamples({incoming,limit:3}).map(x=>({example:x.incoming,score:x.score})):[];
 const row={label,withStyle,model:response.model||null,ok:!!response.ok,error:response.code||null,
  input:short(incoming),raw:short(draft),lab:short(after?.answer||''),labGuard:after?.source||null,
  productionReview:review?.code||null,styleExamples:chosen,question:tone.hasQuestion,
  corporate:tone.corporate,genericOpening:tone.genericOpening,chars:tone.chars,turns:history.length};
 results.push(row);
 console.log('QA_RESULT',JSON.stringify(row));
 return {role:'assistant',text:response.ok?after?.answer||draft:'[Resposta indisponível]'};
}
const cases=[
 ['site_atual_lento','Já tenho um site, mas ele demora muito para abrir no celular'],
 ['objecao_de_preco','Achei caro, acho que não compensa pagar isso'],
 ['incompreensao_informal','kkkk não entendi nada, fala mais simples'],
 ['decisao_com_socio','Vou falar com meu sócio primeiro e depois vejo'],
 ['desconfianca','Achei barato demais, como eu sei que é confiável?']
];
for(const [name,text] of cases){await oneTurn(name,text,false);await oneTurn(name,text,true);}
const history=[];
for(const input of ['Oie, estou olhando esse site aí','Eu já tenho um site, mas ele é lento','E o que você faria no meu caso?']){
 const answer=await oneTurn('conversa_multi_'+(history.length/2+1),input,true,history);
 history.push({role:'user',text:input},answer);
}
// Verified-fact messages in the lab must NOT invoke Groq at all.
const fixedHistory=[{role:'user',text:'Quero pagar no Pix'}, {role:'assistant',text:'Pode ser por aqui'}];
for(const input of ['Vocês fazem Master SEO?','Eu quero comprar o site, qual é o valor?','Como recebo a chave Pix?','Pode enviar por aqui mesmo']){
 const fixed=approvedLabFactReply({incoming:input,history:fixedHistory});
 const row={label:'lab_factual',input,result:short(fixed),blockedRealPayment:!!fixed};
 console.log('QA_FIXED',JSON.stringify(row));
}
const pairs=cases.map(([name])=>{const a=results.find(x=>x.label===name&&!x.withStyle),b=results.find(x=>x.label===name&&x.withStyle);return {name,before:a?.raw||null,after:b?.raw||null,ok:a?.ok&&b?.ok,deltaChars:(b?.chars||0)-(a?.chars||0),deltaQuestions:Number(b?.question===true)-Number(a?.question===true)};});
const summary={
 modelCalls:results.length,success:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,
 styleMatches:results.filter(x=>x.withStyle&&x.styleExamples.length>0).length,
 corporateWithStyle:results.filter(x=>x.withStyle&&x.corporate).length,
 genericOpeningWithStyle:results.filter(x=>x.withStyle&&x.genericOpening).length,
 notApprovedByProductionReview:results.filter(x=>x.ok&&x.productionReview!=='REVIEWED').map(x=>({label:x.label,withStyle:x.withStyle,code:x.productionReview})),
 comparison:pairs,
 note:'Real Groq responses on isolated synthetic inputs. Style lift requires human judgment; a single run is not a conversion trial.'
};
console.log('QA_SUMMARY',JSON.stringify(summary));
try{db.close();}catch{}
try{fs.rmSync(process.env.PROSPECTOR_DATA_DIR,{recursive:true,force:true});}catch{}
if(summary.failed===summary.modelCalls)process.exitCode=2;
