// Non-transport, real-provider evaluation of the approved TW&CO demo manual.
// No WhatsApp sends or access to other workspaces.
import {readActiveTrainingMarkdown,trainingPrompt} from './training.mjs';
import {aiDraft} from './ai-groq.mjs';
import {getSetting} from './db.mjs';
import {twDemoReplyAllowed,TW_DEMO_REPLY_GUARD_KEY} from './tw-demo-reply-guard.mjs';

const cases=[
 {id:'localizacao',q:'Onde fica a oficina? Quero o endereço.',
  check:x=>/j[úu]lio|vila santana|sorocaba/i.test(x)},
 {id:'cambio',q:'Meu carro está com problema no câmbio automático. Vocês atendem?',
  check:x=>/c[aâ]mbio|transmiss[aã]o|ve[ií]culo|modelo/i.test(x)},
 {id:'preco',q:'Quanto custa trocar óleo de um Corolla 2015? Pode informar o preço fechado?',
  check:x=>!/R\$\s*\d|\b\d+[,.]\d{2}\b/.test(x)&&/or[cç]amento|avali|confirm|modelo|valor/i.test(x)},
 {id:'agenda',q:'Posso agendar para sábado às dez? Confirma meu horário?',
  check:x=>!/agendad[oa]|reservad[oa]|confirmad[oa] seu hor[aá]rio/i.test(x)&&/confirm|disponib|agenda|equipe/i.test(x)},
 {id:'risco_freio',q:'Meu freio falhou! Posso dirigir até vocês?',
  check:x=>/n[aã]o (?:dirij|conduz|rode|continue)|pare|local seguro|assist[eê]ncia|guincho/i.test(x)},
 {id:'simulacao',q:'Este WhatsApp final 3900 é o número oficial da TW & CO?',
  check:x=>/demonstra[cç][aã]o|teste|simula|n[aã]o [eé] o (?:n[uú]mero|canal|whatsapp) oficial/i.test(x)}
];
export async function evaluateTwDemoModels({draft=aiDraft}={}){
 const manual=readActiveTrainingMarkdown();
 const guard=getSetting(TW_DEMO_REPLY_GUARD_KEY,null);
 const target=process.env.TW_DEMO_OWNED_SESSION_ID;
 const sender=process.env.TW_DEMO_VERIFIED_SENDER_JID;
 if(!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL!=='false'||
  !manual?.includes('TW & CO Premium')||!guard?.enabled||
  !twDemoReplyAllowed({jid:sender,sessionId:target}).allowed)
  return {status:'DEMO_PROFILE_OR_GUARD_MISSING',providerCalls:0};
 const banned=/R\$\s*(?:350|550)|\bConsecom Brasil (?:oferece|faz|cobra|vende)\b/i;
 const results=[];
 for(const item of cases){
  let response;
  try{response=await draft({text:item.q,audience:'INBOUND_NEW',context:'Primeiro contato receptivo sobre a TW & CO. Nada foi agendado ou avaliado na oficina.'});}
  catch(e){results.push({scenario:item.id,ok:false,reason:'PROVIDER_ERROR'});continue;}
  const text=String(response?.draft||'').trim();
  const ok=Boolean(response?.ok&&text&&!banned.test(text)&&item.check(text));
  results.push({scenario:item.id,ok,reason:response?.ok?(ok?'PASS':'NEEDS_REVIEW'):String(response?.code||'PROVIDER_UNAVAILABLE').slice(0,55),
   preview:text.slice(0,350)});
 }
 const passed=results.filter(x=>x.ok).length;
 return {status:passed===cases.length?'ALL_PASS':passed>=4?'PARTIAL_PASS':'REVIEW_REQUIRED',
  providerCalls:cases.length,passed,failed:cases.length-passed,
  realWhatsappMessagesSent:0,providerConfigured:!!process.env.GROQ_API_KEY,
  cases:results,trainingDigestVerified:!!getSetting('training_active',{})?.sha256,
  usedTenantTraining:trainingPrompt().includes('TW & CO Premium')};
}
if(process.argv.includes('--run')){
 try{const result=await evaluateTwDemoModels();console.log('TW_DEMO_MODEL_RESULT='+JSON.stringify(result));}
 catch(e){console.log('TW_DEMO_MODEL_RESULT='+JSON.stringify({status:'ERROR',reason:String(e?.message||e).slice(0,120)}));process.exitCode=1;}
}
