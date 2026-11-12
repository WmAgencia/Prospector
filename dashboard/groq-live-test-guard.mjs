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
 if(/\b(?:como posso (?:te )?ajudar|em que posso ajudar|posso ajudar sua empresa|posso ajudar seu negocio)\b/.test(n))return {ok:false,code:'GENERIC_HELP_DESK'};
 if(/\b(?:vou|iremos|vamos) (?:te )?(?:mandar|enviar|encaminhar) (?:o |um |essa |a )?(?:audio|gravacao|proposta)\b/.test(n))return {ok:false,code:'UNVERIFIED_AUDIO_PROMISE'};
 if(/\b(?:ja|acabei de) (?:mandei|enviei|reenviei) (?:o |um |essa )?(?:audio|gravacao)\b/.test(n))return {ok:false,code:'UNVERIFIED_AUDIO_ACTION'};
 if(/\b(?:ja encaminhei|ja passei|ja avisei) (?:ao |o |para o )?(?:wesley|responsavel)\b/.test(n))return {ok:false,code:'UNVERIFIED_HANDOFF'};
 // A text draft is NOT an attachment, an ACK, or an authorized retry.
 if(/\b(?:segue|aqui esta|aqui vai|em anexo) (?:o |um |esse |a )?(?:audio|gravacao)\b/.test(n))return {ok:false,code:'AUDIO_ATTACHMENT_NOT_PRESENT'};
 if(/\b(?:(?:o |esse |um )?(?:audio|gravacao) (?:ja )?(?:foi enviad[oa]|foi encaminhad[oa]|esta enviad[oa]|foi entregue)|(?:entrega|recebimento) (?:do |da )?(?:audio|gravacao) (?:foi |esta )?confirmad[oa])\b/.test(n))
  return {ok:false,code:'UNVERIFIED_AUDIO_DELIVERY'};
 if(/\b(?:posso|vou|podemos|iremos) (?:tentar )?(?:reenviar|repassar|mandar novamente|enviar novamente)(?: (?:o|um|a) (?:audio|gravacao|proposta))?\b/.test(n))return {ok:false,code:'AUDIO_RETRY_UNAUTHORIZED'};
 if(/\b(?:vou|iremos|podemos|posso) (?:te )?(?:preparar|montar|escrever|criar|enviar|mandar) (?:um |uma |o |a )?(?:resumo|versao escrita|proposta|texto)\b/.test(n))return {ok:false,code:'UNAPPROVED_TEXT_PROPOSAL'};
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
 if(/\b(?:confirmad[oa] para (?:amanha|hoje|as \d+)|agendamento confirmado|reuniao marcada|retirado (?:da|de) lista|removido (?:da|de) (?:nossa|minha) lista|ja (?:enviei|encaminhei) (?:o contrato|a proposta|seus dados))\b/.test(n))return {ok:false,code:'UNVERIFIED_ACTION'};
 if(/(?:\n\s*){3,}/.test(s))return {ok:false,code:'LONG_FORMAT'};
 return {ok:true,code:'REVIEWED',length:s.length};
}
