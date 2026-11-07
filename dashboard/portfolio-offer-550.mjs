// Canonical, operator-authorized base offer for approved site portfolio conversations.
// Pure logic: no database, WhatsApp, owner notifications, or network calls.
import {classifyInboundAutomation} from './inbound-automation.mjs';
import {leadFirstName} from './lead-salutation.mjs';
export const PORTFOLIO_OFFER_VERSION="consecom-portfolio-550-2026-11-06-business-days";
export const PORTFOLIO_PRICE_BRL=550;
export const PORTFOLIO_DOMAIN_MONTHS=12;
export const WESLEY_PRESENTATION="Meu nome é Wesley, sou dono da agência Consecom. Entrei em contato porque queria fazer uma proposta para vocês.";
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
const clean=s=>String(s||"").replace(/[\r\n\t<>]/g," ").replace(/\s+/g," ").trim();
export function detectAutomaticReply(text=""){
 return classifyInboundAutomation(text).blocked;
}
export function portfolioQuestion(text=""){
 const n=norm(text);
 if(proposalRequestWhileBusy(text)||/\b(?:(?:o )?que (?:seria|e) isso|que proposta (?:e essa|seria)|qual seria essa proposta)\b/.test(n))return true;
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
// Only a personal name explicitly present in a person field or associated
// with a professional title is safe to use. NEVER fall back to the first word
// of the establishment: "Clínica", "Oficina", "Loja", etc.
export function greetingName(lead={}){
 return leadFirstName(lead);
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
 const target=new Date(Date.UTC(parts.year,parts.month-1,parts.day,12));
 let counted=0;
 while(counted<3){target.setUTCDate(target.getUTCDate()+1);const weekday=target.getUTCDay();if(weekday!==0&&weekday!==6)counted++;}
 // Calendar holidays require verified local information; avoid firm dates before prerequisites.
 return new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC",day:"numeric",month:"long",year:"numeric"}).format(target);
}
export function proposalRequestWhileBusy(text=''){
 const n=norm(text);
 return /(?:estou|to) (?:com.{0,30}clientes?|atendendo)|\b(?:ocupad[oa]|desocupando|quando (?:eu )?puder|vejo depois)\b/.test(n)&&
  /(?:deix[ae]|mand[ae]|envi[ae]|pode deixar).{0,45}(?:proposta|detalhes|informacoes)/.test(n);
}
export function fixedOfferPitch(lead={},at=new Date(),{busy=false}={}){
 const what=siteFocus(lead.segment,lead.business);
 // Initial explanation: short and natural. Only clarify delivery dates when specifically requested.
 const first='A ideia é fazer um site profissional pra vocês, com '+what+'. Estamos ampliando nosso portfólio nesse segmento.';
 const second='O site fica em R$ 550, com domínio pago por um ano e Master SEO, sem promessa de posição no Google. O prazo é de até 3 dias úteis após pagamento confirmado e recebimento dos materiais.';
 return first+'\\n\\n'+second+(busy?' Pode olhar com calma quando conseguir.':' Faz sentido pra vocês?');
}
export function fixedOfferPriceReply(at=new Date()){
 return 'O site profissional de portfólio fica em R$ 550, com domínio pago por um ano. O prazo é de até 3 dias úteis após pagamento confirmado e recebimento dos materiais. Recursos extras, como checkout e integrações especiais, são avaliados à parte.';
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
  return 'O prazo é de até três dias úteis, contados após a confirmação do pagamento e a entrega de todos os materiais necessários. Antes disso, a contagem ainda não começa.';
 if(/(?:quanto|preco|valor|custa|r\$\s*550)/.test(n))return fixedOfferPriceReply(at);
 return 'Me conta qual parte ficou confusa que eu explico de outro jeito, sem repetir tudo.';
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
