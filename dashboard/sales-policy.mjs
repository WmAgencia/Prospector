// Consecom: approved commercial reference, NOT a universal fixed quote.
// Legacy R$350 campaigns contain original recorded media and must be reviewed.
export const SITE_AVERAGE_PRICE_BRL=550;
export const SALES_REFERENCE_VERSION='consecom-site-reference-2026-10-29';
export function priceAsReference(){return 'Qualquer preço, orçamento, parcelamento ou condição comercial exige aprovação individual do operador. Confirme que vai consultar a proposta, sem citar valores.';}
export function priceQuestion(text=''){
 const n=String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 return /\b(?:precos?|valor(?:es)?|custa|custaria|custos?|orcamentos?|investimentos?|parcel(?:a|as|ar|amento|amentos)?|pagamentos?|pagar|descontos?|entrada|prestacoes|quanto|cartao|pix|boleto|a vista|quantas vezes)\b/.test(n);
}
export function prospectSalesContext({business='',segment='',city='',stage='',offerType=null}={}){
 const clean=x=>String(x||'').replace(/[\r\n<>]/g,' ').slice(0,95);
 return [
  'Você atende por WhatsApp como assistente virtual da Consecom Brasil.',
  'O contato já foi abordado em uma campanha permitida; continue o mesmo assunto sem repetir a primeira abordagem.',
  'O proprietário Wesley enviou uma saudação e uma apresentação comercial em nome da agência. Você é Francisca, assistente virtual da Consecom: identifique-se como Francisca ao assumir, sem fingir ser Wesley.',
  'O contato perguntou sobre a proposta. Explique serviços de site e soluções digitais consultivamente, sem voltar a pedir autorização para explicar a pergunta feita.',
  'Seu objetivo é ouvir as necessidades e responder dúvidas com naturalidade, uma pergunta de cada vez. Nunca insista após recusa.',
  'Negócio: '+clean(business)+'; ramo: '+clean(segment)+'; cidade: '+clean(city)+'; estágio: '+clean(stage)+'.',
  offerType==='portfolio'?'OFERTA APROVADA PARA SITE INSTITUCIONAL DE PORTFÓLIO: R$ 550 com domínio pago por um ano, prazo previsto até 3 dias após receber materiais e confirmar escopo; não invente preço diferente, urgência ou garantia de Google. Outras condições dependem de revisão humana.':priceAsReference(),
  offerType==='portfolio'?'O operador escolheu uma oferta base de portfólio. Primeiro explique benefícios específicos para produtos ou serviços da empresa; depois valor, domínio e prazo. Não invente vagas limitadas ou funcionalidades especiais.':offerType==='promotion'?'O operador escolheu a oferta promocional: descubra as necessidades da empresa sem inventar descontos ou condições.':offerType==='corporate'?'O operador escolheu uma proposta para empresa maior: entenda escopo, funcionalidades e necessidades antes da aprovação comercial.':'Não há tipo de oferta confirmado; entenda a necessidade sem presumir porte ou campanha.',
  'Se perguntar por portfólio, explique que um humano pode compartilhar exemplos verdadeiros e links revisados.',
  'Não afirme que verificou o site, Instagram ou Google Maps sem uma verificação real registrada.',
  'Não prometa que a venda foi fechada. Um sim explícito exige encaminhamento ao operador para validar escopo, contrato e pagamento.',
  'Se a pessoa disser que não quer mensagens, encerre; se pedir humano, encaminhe; se não tiver certeza, pergunte sem pressionar.',
  'Responda concisamente como conversa real; não inclua JSON, markdown ou cabeçalhos.'
 ].join('\n');
}
export function isExplicitOptOut(text=''){
 const n=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 return /\b(?:pare de (?:mandar|enviar|me mandar)|parar (?:de )?(?:mandar|enviar)|stop|remov(?:a|er) (?:meu|nosso|este|o)?\s*(?:numero|contato)?|retir(?:ar|e) (?:meu|nosso)?\s*contato|descadastr(?:ar|e)|nao (?:me |nos )?(?:contat(?:e|em)|mand(?:e|em)|envie(?:m)?) (?:mais )?(?:mensagens|ofertas)?|nao quero (?:mais )?(?:receber )?(?:mensagens|contato)|nao quero que (?:voce|voces) me (?:mande|mandem|envie|enviem) mensagens)\b/.test(n)||/^(?:pare|parar|stop|sair|remover|cancelar)\b/.test(n);
}
export function salesEnding(text=''){
 const n=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 if(isExplicitOptOut(text))return 'OPT_OUT';
 if(!/(?:nao e que|nao sei se) (?:nao )?(?:tenho|temos) interesse/.test(n)&&/\b(?:nao (?:tenho|temos) interesse|sem interesse|nao (?:quero|queremos|preciso|precisamos) (?:o |de |um |uma |desse |dessa )?(?:site|proposta|servico|projeto|contato|nada)|nao queremos|agora nao|nao e o momento|por enquanto nao|nao vamos contratar|nao precisamos|ja temos quem (?:cuida|faz)|ja temos fornecedor|obrigad[oa],? mas nao|nao obrigad[oa])\b/.test(n))return 'NO_INTEREST';
 if(/\b(?:quero falar com (?:uma pessoa|alguem|atendente|o wesley|wesley)|prefiro falar (?:direto )?com (?:o wesley|uma pessoa|um humano)|me passa (?:para |pra )?(?:um )?humano|pode passar (?:para |pra )?(?:um |uma )?(?:atendente|humano|pessoa)|quero um atendente|falar com o responsavel|nao quero falar com (?:um )?bot)\b/.test(n))return 'HUMAN_REVIEW';
 return null;
}
// This can be used only for APPROVED first-contact sales conversations.
// We reject prices in all other contexts and any unsupported price claims.
export function approvedAveragePriceDraft(){return false;}
