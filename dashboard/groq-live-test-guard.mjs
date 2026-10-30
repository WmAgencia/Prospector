// Deterministic guardrails shared by simulated evaluation and live single-number QA.
// This is NOT model fine-tuning; Groq drafts remain generative.
const normalize=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
// Phone is not hardcoded: require the COMPLETE operator-approved destination.
export function testModeAllowed(phone){
 const configured=String(process.env.PROSPECTOR_LIVE_TEST_PHONE||'').replace(/\D/g,'');
 const normalized=configured.length===11?'55'+configured:configured;
 return process.env.PROSPECTOR_LIVE_TEST_ENABLED==='true'&&
  /^55\d{10,11}$/.test(normalized)&&
  String(phone||'').replace(/\D/g,'')===normalized;
}
export function testGreeting(date=new Date()){
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(date));
 return 'Olá, '+(hour>=5&&hour<12?'bom dia':hour>=12&&hour<18?'boa tarde':'boa noite')+', como vai?';
}
export function reviewGroqReply({inbound='',draft='',allowAveragePrice=false}={}){
 const s=String(draft||'').trim(),n=normalize(s),inText=normalize(inbound);
 if(!s||s.length>650)return {ok:false,code:'LENGTH'};
 if(/[\x00-\x08\x0e-\x1f]/.test(s)||/\x60\x60\x60/.test(s))return {ok:false,code:'FORMAT'};
 if(/^\s*(?:pare|parar|stop|remover|nao me contate|nao quero mensagem)/.test(inText))return {ok:false,code:'INBOUND_OPTOUT'};
 if(/https?:\/\/|www\.|\bwa\.me\//i.test(s))return {ok:false,code:'UNVERIFIED_LINK'};
 if(/\breais\b|r\$/.test(n))return {ok:false,code:'UNVERIFIED_PRICE'};
 if(/r\$\s*[\d.,]+|\d+(?:[,.]\d+)?\s*reais|\b(?:valor|custa|preco|investimento|fica|sai|por)\s*(?:e |de |em )?\d|\b(?:350|550|1500)\b|\b(?:trezentos e cinquenta|quinhentos e cinquenta|mil e quinhentos)\b/i.test(n))return {ok:false,code:'UNVERIFIED_PRICE'};
 if(/\b(?:um|uma|dois|duas|tres|1|2|3) dias?\b|\b(?:80|90)\s*%/.test(n))return {ok:false,code:'UNAPPROVED_TERMS'};
 if(/%|\bpor cento\b|\b(?:\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s*(?:horas?|dias?|semanas?|meses)\b/.test(n))return {ok:false,code:'UNAPPROVED_TERMS'};
 if(/\b(?:garantimos?|100% garantido|lucro certo|resultado garantido)\b/.test(n))return {ok:false,code:'GUARANTEE'};
 if(/\b(?:sou humano|nao sou uma ia|nao sou robo|sou o dono|sou wesley)\b/.test(n))return {ok:false,code:'MISREPRESENTATION'};
 if(/\b(?:cpf|rg|senha|cartao de credito|numero do cartao|codigo de verificacao)\b/.test(n))return {ok:false,code:'SENSITIVE_DATA'};
 if(/\b(?:ignore as instrucoes|desconsidere as regras|system prompt|api key|token secreto)\b/.test(n))return {ok:false,code:'PROMPT_LEAK'};
 if(/(?:\n\s*){3,}/.test(s))return {ok:false,code:'LONG_FORMAT'};
 return {ok:true,code:'REVIEWED',length:s.length};
}
