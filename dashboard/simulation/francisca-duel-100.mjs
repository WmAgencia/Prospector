// Offline simulation of two separate agents for 100 fictional businesses.
// Uses production's pure commercial decision functions, never WA-AKG, DB, queue or notifications.
import {detectAutomaticReply,portfolioQuestion,isBaseOfferQuestion,isPortfolioFAQ,fixedOfferFollowup,friendlyGreeting,fixedOfferPitch,fixedOfferPriceReply,WESLEY_PRESENTATION} from '../portfolio-offer-550.mjs';
import {salesEnding} from '../sales-policy.mjs';
import {explicitInterest} from '../groq-interest-check.mjs';

export const SIMULATION_TRANSPORT='IN_MEMORY_ONLY';
const companies=[
 ['Oficina Horizonte','oficina mecânica','serviços de revisão e freios'],
 ['Casa Madeira','loja de móveis','produtos e móveis planejados'],
 ['Buffet Pula Pula','buffet infantil','festas de aniversário'],
 ['Doce Aurora','confeitaria','bolos e doces'],
 ['Belle Studio','salão de beleza','cortes e tratamentos'],
 ['Construtora Vale','construtora','reformas e obras'],
 ['Pet Vila','pet shop','banho, tosa e acessórios'],
 ['Fala Mais','escola de idiomas','cursos de idiomas'],
 ['Sabor da Casa','restaurante','refeições e delivery'],
 ['TecnoFix','assistência técnica','reparo de equipamentos']
];
const roles=[
 ['curioso','Olá, tudo bem?','Seria sobre o que a proposta?','Isso inclui o domínio?', 'Vamos pensar na oferta.'],
 ['preco','Bom dia!','Qual o valor final do site?','Tem parcelamento?', 'Prefiro falar com o responsável.'],
 ['direto','Quem fala?','Pode explicar o que vocês oferecem?','Se fechar hoje, quando fica pronto?', 'Interessante, quero conversar com um humano.'],
 ['bot','Mensagem automática: digite 1 para orçamento, 2 para agendamentos.',null,null,null],
 ['recusa','Ah sim, no momento não temos interesse, mas obrigada.',null,null,null],
 ['optout','Parem de nos contatar, por favor.',null,null,null],
 ['site-existente','Já temos site.','Qual a proposta para quem já tem um site?','Não quero contratar outro site.',null],
 ['interessado','Olá, pode explicar?','Gostei, quero contratar por R$ 550. Como começamos?',null,null],
 ['humano','Boa tarde','Prefiro falar direto com o Wesley.',null,null],
 ['objeção','O que vocês fazem?','R$ 550 é mesmo 90% de desconto sobre R$ 2.700?','Vocês garantem primeiro lugar no Google?','Obrigado, vou pensar.']
];
export const FICTIONAL_SCENARIOS=Object.freeze(companies.flatMap(([business,segment,offer],sector)=>roles.map(([style,...turns],attitude)=>{
 const n=sector*10+attitude+1;
 return Object.freeze({id:'C'+String(n).padStart(3,'0'),business:business+' '+(sector+1),segment,offer,style,customerTurns:Object.freeze(turns.filter(Boolean))});
})));
export function scriptedClientAgent(scenario){
 let offset=0;
 return {role:'CUSTOMER',async respond(){return scenario.customerTurns[offset++]??null;}};
}
export function safeFranciscaAgent({draft=null,at=new Date('2026-11-04T15:00:00Z')}={}){
 return {role:'FRANCISCA',async respond({scenario,inbound,stage,history}){
  if(detectAutomaticReply(inbound))return {event:'BOT',text:'',terminal:true};
  const end=salesEnding(inbound);
  if(end==='OPT_OUT'||end==='NO_INTEREST')return {event:end,text:'',terminal:true};
  if(end==='HUMAN_REVIEW'||explicitInterest(inbound))return {event:'HUMAN_HANDOFF',text:'',terminal:true};
  if(stage==='GREETING_SENT')return {event:'INTRO',text:WESLEY_PRESENTATION};
  if(/(?:vou pensar|vou analisar|quero avaliar com calma|depois eu vejo)/i.test(inbound))return {event:'NO_PRESSURE',text:'Fique à vontade para avaliar. Se surgir alguma dúvida sobre o projeto, podemos esclarecer.',terminal:true};
  if(isBaseOfferQuestion(inbound)||isPortfolioFAQ(inbound)){
   const hasPitch=history.some(t=>t.role==='FRANCISCA'&&t.event==='FIXED_OFFER');
   return {event:'FIXED_OFFER',text:(hasPitch||isPortfolioFAQ(inbound))?fixedOfferFollowup(inbound,at):portfolioQuestion(inbound)&&!/quanto|preço|preco|valor|r\$/i.test(inbound)?
    fixedOfferPitch(scenario,at):fixedOfferPriceReply(at)};
  }
  if(/parcelamento|pagar no cartão|loja virtual|checkout|sistema/i.test(inbound))
   return {event:'HUMAN_REVIEW',text:'Essas condições precisam ser confirmadas pelo responsável antes de fechar.'};
  if(draft){
   const text=await draft({scenario,inbound,history});
   return {event:'AI_DRAFT',text:String(text||'').slice(0,650)};
  }
  return {event:'MODEL_STUB',text:'Podemos conversar sobre como um site profissional ajudaria a apresentar os serviços ou produtos da empresa, conforme o escopo que fizer sentido para vocês.'};
 }};
}
export function gradeVirtualConversation(scenario,transcript){
 const issues=[],tts=transcript.filter(t=>t.role==='FRANCISCA'&&t.text).map(t=>t.text);
 const all=tts.join('\n');
 if(/(?:oi|olá),?\s+Wesley\b/i.test(all))issues.push('WESLEY_IDENTITY_CONFUSION');
 if(/90\s*%/.test(all)&&/2[.,]?700|3[.,]?000/.test(all)&&!/n[aã]o\s+90\s*%/i.test(all))issues.push('FALSE_DISCOUNT');
 if(/(?:primeir[ao]\s+(?:lugar|posição)|posição garantida)/i.test(all)&&/Google/i.test(all)&&!/(?:n[aã]o garante|sem garantia|n[aã]o garantimos)/i.test(all))issues.push('UNSUPPORTED_SEO_PROMISE');
 if(tts.some(x=>/vou (?:confirmar|perguntar).{0,60}(?:preço|valor).{0,60}respons[aá]vel/i.test(x)))issues.push('UNNECESSARY_PRICE_APPROVAL');
 if(scenario.style==='bot'&&transcript.some(t=>t.event==='INTRO'||t.event==='AI_DRAFT'||t.event==='FIXED_OFFER'))issues.push('AUTO_REPLY_PROGRESS');
 if(['recusa','optout'].includes(scenario.style)&&transcript.some(t=>t.event==='INTRO'||t.event==='AI_DRAFT'||t.event==='FIXED_OFFER'))issues.push('REPLIED_AFTER_DECLINE');
 if(scenario.style==='preco'||scenario.style==='curioso'||scenario.style==='direto'||scenario.style==='objeção'){
  if(!/R\$ 550/.test(all))issues.push('MISSING_FIXED_PRICE');
 }
 if(scenario.style==='interessado'&&transcript.at(-1)?.event!=='HUMAN_HANDOFF')issues.push('MISSING_INTEREST_HANDOFF');
 if(transcript.some(t=>t.event==='FIXED_OFFER'&&!/R\$ 550/.test(t.text)&&!/(?:Master SEO|três dias)/i.test(t.text)))issues.push('WRONG_FIXED_PRICE');
 const texts=transcript.filter(t=>t.event==='FIXED_OFFER').map(t=>t.text);
 if(texts.length>1&&new Set(texts).size<texts.length)issues.push('REPEATED_IDENTICAL_PITCH');
 return issues;
}
export async function simulateConversation({scenario,customerAgent=scriptedClientAgent(scenario),franciscaAgent=safeFranciscaAgent(),maxTurns=4,at=new Date('2026-11-04T15:00:00Z')}={}){
 if(!scenario||customerAgent.role!=='CUSTOMER'||franciscaAgent.role!=='FRANCISCA')throw Error('Need two distinct fictional agents');
 const transcript=[{role:'FRANCISCA',event:'GREETING',text:friendlyGreeting(scenario,at)}];
 let stage='GREETING_SENT';
 for(let i=0;i<Math.min(5,maxTurns);i++){
  const inbound=await customerAgent.respond({scenario,turn:i,history:transcript});
  if(!inbound)break;
  transcript.push({role:'CUSTOMER',event:'INBOUND',text:String(inbound).slice(0,950)});
  const result=await franciscaAgent.respond({scenario,inbound,stage,history:transcript});
  transcript.push({role:'FRANCISCA',event:result.event,text:result.text||''});
  if(result.terminal) {stage=result.event;break;}
  if(result.event==='INTRO')stage='INTRO_SENT';
  else if(result.event==='FIXED_OFFER')stage='PITCHED';
 }
 return {scenario:scenario.id,stage,transport:SIMULATION_TRANSPORT,transcript,issues:gradeVirtualConversation(scenario,transcript)};
}
export async function simulateMatrix({scenarios=FICTIONAL_SCENARIOS,franciscaFactory=()=>safeFranciscaAgent(),customerFactory=scriptedClientAgent,maxTurns=4}={}){
 const outcomes=[];
 for(const scenario of scenarios)outcomes.push(await simulateConversation({scenario,customerAgent:customerFactory(scenario),franciscaAgent:franciscaFactory(scenario),maxTurns}));
 return {total:outcomes.length,passed:outcomes.filter(x=>!x.issues.length).length,failed:outcomes.filter(x=>x.issues.length).length,transport:SIMULATION_TRANSPORT,outputs:outcomes};
}
