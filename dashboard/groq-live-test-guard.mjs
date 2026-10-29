// Deterministic guardrails shared by simulated evaluation and live single-number QA.
// This is NOT model fine-tuning; Groq drafts remain generative.
const normalize=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export const TEST_RECIPIENT='5515981817336';
export function testModeAllowed(phone){
 return process.env.PROSPECTOR_LIVE_TEST_ENABLED==='true' &&
  String(process.env.PROSPECTOR_LIVE_TEST_PHONE||'').replace(/\D/g,'')===TEST_RECIPIENT &&
  String(phone||'').replace(/\D/g,'')===TEST_RECIPIENT;
}
export function testGreeting(date=new Date()){
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(date));
 return 'Olá, '+(hour>=5&&hour<12?'bom dia':hour>=12&&hour<18?'boa tarde':'boa noite')+', como vai?';
}
export function reviewGroqReply({inbound='',draft=''}={}){
 const s=String(draft||'').trim(),n=normalize(s),inText=normalize(inbound);
 if(!s||s.length>650)return {ok:false,code:'LENGTH'};
 if(/[\x00-\x08\x0e-\x1f]/.test(s)||/\x60\x60\x60/.test(s))return {ok:false,code:'FORMAT'};
 if(/^\s*(?:pare|parar|stop|remover|nao me contate|nao quero mensagem)/.test(inText))return {ok:false,code:'INBOUND_OPTOUT'};
 if(/https?:\/\/|www\.|\bwa\.me\//i.test(s))return {ok:false,code:'UNVERIFIED_LINK'};
 if(/r\$\s*[\d.,]+|(?:\d+[,.]\d{2})\s*reais/i.test(s))return {ok:false,code:'UNVERIFIED_PRICE'};
 if(/\b(?:garantimos?|100% garantido|lucro certo|resultado garantido)\b/.test(n))return {ok:false,code:'GUARANTEE'};
 if(/\b(?:sou humano|nao sou uma ia|nao sou robo|sou o dono|sou wesley)\b/.test(n))return {ok:false,code:'MISREPRESENTATION'};
 if(/\b(?:cpf|rg|senha|cartao de credito|numero do cartao|codigo de verificacao)\b/.test(n))return {ok:false,code:'SENSITIVE_DATA'};
 if(/\b(?:ignore as instrucoes|desconsidere as regras|system prompt|api key|token secreto)\b/.test(n))return {ok:false,code:'PROMPT_LEAK'};
 if(/(?:\n\s*){3,}/.test(s))return {ok:false,code:'LONG_FORMAT'};
 return {ok:true,code:'REVIEWED',length:s.length};
}
