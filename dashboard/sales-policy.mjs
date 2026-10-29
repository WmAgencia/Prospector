// Consecom: approved commercial reference, NOT a universal fixed quote.
// Legacy R$350 campaigns contain original recorded media and must be reviewed.
export const SITE_AVERAGE_PRICE_BRL=550;
export const SALES_REFERENCE_VERSION='consecom-site-reference-2026-10-29';
export function priceAsReference(){
 return 'O investimento médio de referência para um site é R$ 550, sujeito ao escopo e a uma proposta confirmada pela equipe. Não é preço fixo, promoção ou promessa de entrega.';
}
export function prospectSalesContext({business='',segment='',city='',stage=''}={}){
 const clean=x=>String(x||'').replace(/[\r\n<>]/g,' ').slice(0,95);
 return [
  'Você atende por WhatsApp como assistente virtual da Consecom Brasil.',
  'O contato já foi abordado em uma campanha permitida; continue o mesmo assunto sem repetir a primeira abordagem.',
  'Seu objetivo é ouvir as necessidades e responder dúvidas com naturalidade, uma pergunta de cada vez. Nunca insista após recusa.',
  'Negócio: '+clean(business)+'; ramo: '+clean(segment)+'; cidade: '+clean(city)+'; estágio: '+clean(stage)+'.',
  priceAsReference(),
  'Se a pessoa perguntar quanto custa, mencione R$ 550 APENAS como média aproximada, e explique que a proposta depende do escopo.',
  'Nunca ofereça o valor antigo de R$ 350, descontos, 80% ou 90% off, garantia de resultados, prazos ou links que não foram aprovados.',
  'Se perguntar por portfólio, explique que um humano pode compartilhar exemplos verdadeiros e links revisados.',
  'Não afirme que verificou o site, Instagram ou Google Maps sem uma verificação real registrada.',
  'Não prometa que a venda foi fechada. Um sim explícito exige encaminhamento ao operador para validar escopo, contrato e pagamento.',
  'Se a pessoa disser que não quer mensagens, encerre; se pedir humano, encaminhe; se não tiver certeza, pergunte sem pressionar.',
  'Responda concisamente como conversa real; não inclua JSON, markdown ou cabeçalhos.'
 ].join('\n');
}
export function salesEnding(text=''){
 const n=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 if(/^(?:pare|parar|stop|sair|remover|cancelar|nao me contate|nao quero receber mensagens|nao me mande mensagens)\b/.test(n))return 'OPT_OUT';
 if(/^(?:nao tenho interesse|sem interesse|nao quero|agora nao|nao e o momento|nao preciso|obrigado mas nao|obrigada mas nao|nao obrigado|nao obrigada)\b/.test(n))return 'NO_INTEREST';
 if(/\b(?:quero falar com (?:uma pessoa|alguem|atendente)|me passa (?:para |pra )?(?:um )?humano|quero um atendente|falar com o responsavel)\b/.test(n))return 'HUMAN_REVIEW';
 return null;
}
// This can be used only for APPROVED first-contact sales conversations.
// We reject prices in all other contexts and any unsupported price claims.
export function approvedAveragePriceDraft(text='',draft=''){
 const figures=[...String(draft).matchAll(/r\$\s*([\d.,]+)/gi)].map(x=>x[1].replace(/\./g,'').replace(',','.'));
 if(figures.length!==1||Number(figures[0])!==SITE_AVERAGE_PRICE_BRL)return false;
 if(!/\b(?:media|medio|media aproximada|referencia|aproximad|em torno|costuma|dependendo do escopo|escopo)\b/i.test(String(draft).normalize('NFD').replace(/[\u0300-\u036f]/g,'')))return false;
 return /(?:preco|valor|custa|investimento|quanto|orcamento|reais|r\$)/i.test(String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,''));
}
