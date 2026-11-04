// Canonical, operator-authorized base offer for approved site portfolio conversations.
// Pure logic: no database, WhatsApp, owner notifications, or network calls.
export const PORTFOLIO_OFFER_VERSION="consecom-portfolio-550-2026-11";
export const PORTFOLIO_PRICE_BRL=550;
export const PORTFOLIO_DOMAIN_MONTHS=12;
export const WESLEY_PRESENTATION="Meu nome é Wesley, sou dono da agência Consecom. Entrei em contato porque queria fazer uma proposta para vocês.";
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
const clean=s=>String(s||"").replace(/[\r\n\t<>]/g," ").replace(/\s+/g," ").trim();
export function detectAutomaticReply(text=""){
 const n=norm(text);
 return /(?:mensagem|resposta|atendimento)\s+automatic[ao]|(?:assistente|robo|bot|menu)\s+(?:virtual|automatic[ao])|(?:digite|escolha|selecione|pressione)\s+(?:[0-9#*]|uma opcao)|(?:para (?:agendar|orcamento|atendimento|suporte|continuar).{0,45}(?:informe|digite|selecione))|(?:informe (?:seu )?nome.{0,80}(?:modelo|ano|data|motor|servico|defeito))|(?:nosso horario de atendimento.{0,80}(?:digite|opcao))/.test(n);
}
export function portfolioQuestion(text=""){
 const n=norm(text);
 return /(?:sobre o que(?: seria| e| se trata)?)|(?:do que (?:se trata|seria))|(?:qual (?:e |seria )?(?:a |essa |sua )?(?:proposta|oferta|ideia))|(?:me explica|explica|pode explicar|pode me falar|queria entender|pode falar|do que se trata)|(?:quanto (?:custa|fica|sai))|(?:qual (?:e )?o (?:preco|valor))|(?:valor do site|preco do site|a proposta)|(?:e o valor|e o preco)/.test(n);
}
export function isBaseOfferQuestion(text=""){
 const n=norm(text);
 if(/(?:parcelamento|parcelar|pagamento|pix|boleto|cartao|entrada|mensalidade|loja virtual|checkout|sistema|integracao|ecommerce|e-commerce)/.test(n))return false;
 return portfolioQuestion(text)||/(?:r\$\s*550|site\s+(?:profissional|simples)|valor\s+(?:final|do site))/.test(n);
}
export function verifiedPersonName(lead={}){
 // Public business names are never proof of a personal name.
 if(lead.contact_name_verified!==true&&lead.name_verified!==true)return "";
 const name=clean(lead.contact_name||lead.name);
 if(!name||name.length>35||/[|/\\&@0-9]/.test(name))return "";
 if(/(?:autoeletrica|mecanica|oficina|loja|empresa|buffet|solucoes|servicos|ltda|comercio|clinica|studio|eletrotec)/i.test(norm(name)))return "";
 return name;
}
// Fallback aprovado pelo operador: sem nome pessoal, usa o primeiro nome da
// empresa; sem nada utilizável, só a saudação. Nunca inventa nome.
export function greetingName(lead={}){
 const person=verifiedPersonName(lead);
 if(person)return person;
 const business=String(lead.business||'').replace(/\b(?:ltda|me|eireli|epp|s\.?a\.?)\b\.?/gi,' ').trim();
 const first=business.split(/[\s\-–—|•,./]+/).filter(Boolean)[0]||'';
 if(!/^[\p{L}][\p{L}'’.-]{1,29}$/u.test(first))return '';
 if(/^(?:a|o|os|as|de|da|do|das|dos|e|em|para|com|a|à|ao)$/i.test(first))return '';
 if(/^(?:whatsapp|tudo|aqui|empresa|comercio|servicos|servico|loja|clinica|oficina|bar|restaurante)$/i.test(first))return '';
 return first.charAt(0).toUpperCase()+first.slice(1);
}
export function friendlyGreeting(lead={},at=new Date()){
 const h=Number(new Intl.DateTimeFormat("en-GB",{hour:"2-digit",hourCycle:"h23",timeZone:"America/Sao_Paulo"}).format(at));
 const period=h>=5&&h<12?"bom dia":h>=12&&h<18?"boa tarde":"boa noite";
 const name=greetingName(lead);
 return "Olá"+(name?", "+name:"")+", "+period+"! Tudo bem?";
}
export function siteFocus(segment="",business=""){
 const n=norm(segment+" "+business);
 if(/(?:loja|moveis|papelaria|produto|roupas|moda|ecommerce|eletronicos|pet shop|confeitaria)/.test(n))return "produtos, diferenciais, localização e contato pelo WhatsApp";
 if(/(?:restaurante|lanchonete|pizzaria|cafe)/.test(n))return "cardápio, localização, horários e contato pelo WhatsApp";
 if(/(?:buffet|festa|evento)/.test(n))return "serviços para eventos, fotos, diferenciais e contato pelo WhatsApp";
 return "serviços, diferenciais, localização e contato pelo WhatsApp";
}
export function brDeliveryDate(at=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(at).filter(x=>x.type!=="literal").map(x=>[x.type,Number(x.value)]));
 const target=new Date(Date.UTC(parts.year,parts.month-1,parts.day+3,12));
 return new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC",day:"numeric",month:"long",year:"numeric"}).format(target);
}
export function fixedOfferPitch(lead={},at=new Date()){
 const what=siteFocus(lead.segment,lead.business);
 // The dates of a separate portfolio presentation are NOT asserted unless independently verified.
 const first="A proposta é criar um site profissional para vocês, apresentando "+what+". Também incluímos uma estrutura de Master SEO, que ajuda o site a ser encontrado nas buscas orgânicas do Google, sem garantia de posição.";
 const second="Estamos ampliando nosso portfólio nesse segmento e oferecemos esse site por R$ 550, já com o domínio pago por um ano. A previsão é de até 3 dias após recebermos o conteúdo e confirmarmos o escopo. Se tudo for combinado hoje, a referência é "+brDeliveryDate(at)+". Faz sentido para vocês?";
 return first+"\n\n"+second;
}
export function fixedOfferPriceReply(at=new Date()){
 return "Para o site profissional de portfólio, o valor definido é R$ 550, com domínio pago por um ano. A previsão é de até 3 dias depois de recebermos as informações e confirmarmos o escopo; se isso ocorrer hoje, a referência é "+brDeliveryDate(at)+". Se precisar de loja virtual, sistema ou integrações extras, avaliamos o escopo com o responsável.";
}
export function approvedPortfolioText(text,at=new Date()){
 const n=norm(text);
 if(n.includes("90%")||n.includes("primeira posicao")||n.includes("ranking garantido"))return false;
 return text===fixedOfferPriceReply(at)||text===fixedOfferPitch({},at);
}

export function isPortfolioFAQ(value=''){
 const n=norm(value);
 if(/(?:parcelamento|parcelar|cartao|pix|boleto|entrada|mensalidade|loja virtual|checkout|sistema|integracao especial)/.test(n))return false;
 return /(?:google|seo|ranking|primeira posicao|dominio|entrega|prazo|tres dias|3 dias|90%|desconto)/.test(n);
}
export function fixedOfferFollowup(question='',at=new Date()){
 const n=norm(question);
 if(/(?:90\s*%|desconto|2[.,]?700|3[.,]?000)/.test(n))
  return 'A conta correta é aproximadamente 80% de redução em relação a R$ 2.700–3.000, não 90%. A proposta do site base é de R$ 550, com domínio pago por um ano.';
 if(/(?:google|seo|ranking|primeira posicao)/.test(n))
  return 'Incluímos uma estrutura técnica de Master SEO para melhorar a presença do site nas buscas orgânicas. Isso não garante a primeira posição no Google nem um número específico de clientes.';
 if(/dominio/.test(n))
  return 'Sim. No site base de portfólio, o domínio fica pago por um ano e já está incluído no valor de R$ 550. Renovações futuras e outros serviços são combinados separadamente.';
 if(/(?:prazo|entrega|pronto|quando|3 dias|tres dias)/.test(n))
  return 'Para o site base, a previsão é de até três dias corridos após recebermos os materiais e confirmarmos o escopo. Se isso acontecer hoje, a data de referência é '+brDeliveryDate(at)+'.';
 if(/(?:quanto|preco|valor|custa|r\$\s*550)/.test(n))return fixedOfferPriceReply(at);
 return 'A proposta base continua sendo um site profissional por R$ 550, com domínio pago por um ano e prazo previsto de até três dias após receber o material e validar o escopo. Posso esclarecer algum ponto específico?';
}

export function safeGeneralReply(question='',lead={}){
 const n=norm(question);
 if(/(?:ja tenho site|ja temos site|nosso site (?:ja )?(?:funciona|existe))/.test(n))
  return 'Se o site de vocês já atende bem, não faz sentido sugerir outro sem necessidade. Podemos avaliar melhorias pontuais de conteúdo, apresentação e contato, caso seja útil.';
 if(/(?:quem fala|quem e voce|quem esta falando|com quem)/.test(n))
  return 'Aqui é a Francisca, assistente virtual da Consecom. Estou dando continuidade à proposta apresentada pelo Wesley e posso explicar o que a agência oferece.';
 if(/(?:anuncio|trafego pago|meta ads|google ads)/.test(n))
  return 'A Consecom trabalha com publicidade e tecnologia. A criação do site e a gestão de anúncios são serviços diferentes, com escopos que precisam ser alinhados antes da contratação.';
 if(/(?:agendar|agenda|reserva|loja virtual|pagamento|parcelamento)/.test(n))
  return 'Essa funcionalidade precisa ser avaliada com nossa equipe antes de confirmar escopo, valor ou prazo. Posso encaminhar sua dúvida ao responsável.';
 const focus=siteFocus(lead.segment,lead.business);
 return 'A ideia é desenvolver um site profissional que organize '+focus+'. Se você quiser, posso explicar a proposta base e como ela ajudaria a empresa.';
}
