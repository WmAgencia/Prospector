// Classifies a customer's permission to HEAR an already-introduced proposal.
// Pure, deterministic and only usable after the written Wesley introduction.
// Greeting alone is not a permission to receive a sales recording.
const clean=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[’´`]/g,"'").replace(/\s+/g,' ').trim();
export const OWNER_PROPOSAL_INTENT=Object.freeze({ACCEPT:'ACCEPT',TEXT_ONLY:'TEXT_ONLY',DECLINE:'DECLINE',UNCLEAR:'UNCLEAR'});
export function classifyOwnerProposalIntent(value=''){
 const msg=clean(value);
 if(!msg||msg.length>900)return OWNER_PROPOSAL_INTENT.UNCLEAR;
 if(/(?:prefiro|quero|manda|envia|responde|explica) (?:por |em )?texto|sem audio|nao quero audio|nao manda audio|(?:audio|voz) nao|(?:por escrito|quero por escrito|prefiro por escrito|explicar em texto|explica em texto)/.test(msg))
  return OWNER_PROPOSAL_INTENT.TEXT_ONLY;
 // Hard precedence: NEVER interpret a negative with an embedded positive
 // word as affirmative ("não, obrigado, pode deixar").
 if(/(?:^|\b)(?:obrigado,? mas nao|obrigada,? mas nao|nao[,!. ]+obrigad[oa]|nao quero saber|nao quero receber propostas)(?:\b|[,.!?]|$)/.test(msg))return OWNER_PROPOSAL_INTENT.DECLINE;
 if(/(?:^|\b)(?:nao tenho interesse|sem interesse|nao quero|nao me mande|para de mandar|pare de enviar|me exclua|me remova|nao pode|nao vou|nao[, ]+obrigado|prefiro nao|nao quero ouvir|depois|agora nao|por enquanto nao|nao e o momento|nao estou interessado|nao me liga|nao quero proposta)(?:\b|[,.!?]|$)/.test(msg))
  return OWNER_PROPOSAL_INTENT.DECLINE;
 if(/(?:\b(?:estou ocupado|to ocupado|sem tempo|mais tarde|amanha|outro dia|agora nao|nao agora|me chama depois|pode deixar para depois)\b)/.test(msg))
  return OWNER_PROPOSAL_INTENT.DECLINE;
 // Short affirmatives remain affirmative even when conversational ("Beleza,
 // pode falar", "Sim, manda", "Pode prosseguir"). Negatives above win.
 // A short affirmative, contextual question or thumbs-up after Wesley's
 // written offer is approval to HEAR the proposal. These phrases never authorize
 // a first unsolicited message; the introduction state gates this classifier.
 if(/^(?:👍|👍🏻|👍🏼|👍🏽|👍🏾|👍🏿|✅|👌|🙌)(?:[\s.!?]*|[\s.!?]*👍)$/.test(msg))return OWNER_PROPOSAL_INTENT.ACCEPT;
 if(/^(?:ta|tá|bem|entendi|entendido|ok|okay|beleza|blz|tranquilo|perfeito|certo|pode|manda|fala|siga|continue|prossegue|prossiga)[\s,.:;!]*?(?:pode |pode me |me )?(?:falar|mandar|enviar|explicar|contar|continuar|prosseguir|seguir|apresentar|mostrar|passar)(?:[\s.!?]|$)/.test(msg))
  return OWNER_PROPOSAL_INTENT.ACCEPT;
 if(/^(?:do que se trata|sobre o que e|sobre o que seria|o que voce quer propor|e qual a proposta|qual proposta|que proposta|proposta de que|o que seria a proposta)(?:[?.!\s]|$)/.test(msg))
  return OWNER_PROPOSAL_INTENT.ACCEPT;
 if(msg.length<=160&&/^(?:sim|ss|s|ok|okay|blz|beleza|claro|certo|perfeito|pode sim|pode ser|pode falar|pode mandar|pode prosseguir|pode continuar|prossegue|prossiga|manda|me conta|vamos la|tranquilo|combinado|show|pois nao|ta bom|ta certo|tudo certo|to ouvindo|estou ouvindo|fico no aguardo)(?:[\s,.!?]|$)/.test(msg))
  return OWNER_PROPOSAL_INTENT.ACCEPT;
 const simple=/^(?:sim|ss|s|ok|okay|blz|beleza|claro|certo|perfeito|pode|pode sim|pois nao|com certeza|ta bom|ta|tudo bem|tudo certo|tranquilo|combinado|show|bora|isso|prossegue|prossiga|manda|manda ai|enviar|pode mandar|pode enviar|fale|falar|pode falar|pode prosseguir|pode continuar|continua|continue|pode explicar|me fala|me conta|vamos la|vamos nessa|estou ouvindo|to ouvindo|sou todo ouvidos|pode apresentar|fico no aguardo|no aguardo|manda ver|pode ser|ta certo)(?:[\s!.?,]+(?:pode (?:falar|mandar|prosseguir|enviar|seguir)|manda (?:ai|ver)|sim|claro|ok|blz|por favor|pfv|a proposta|mais detalhes|fique a vontade|me conta|pode explicar|sem problema|beleza))*[.!?\s]*$/;
 if(simple.test(msg))return OWNER_PROPOSAL_INTENT.ACCEPT;
 if(/(?:tenho interesse|estou interessado|to interessado|me interessei|me interessou|gostei da ideia|curti a ideia|quero ouvir|quero saber mais|quero entender|pode mostrar|me mostra|me apresenta)/.test(msg))
  return OWNER_PROPOSAL_INTENT.ACCEPT;
 if(/\b(?:quanto custa|quanto fica|qual o valor|qual o preco|qual o investimento)\b/.test(msg))return OWNER_PROPOSAL_INTENT.ACCEPT;
 // An explicit question about the offer is interest in hearing the details.
 if(/(?:qual|que|como|o que|sobre o que|do que se trata|explica|explique|me fala|me conta|queria saber|gostaria de saber|quero entender|tenho interesse|me interessa|pode me explicar).{0,110}(?:proposta|oferta|site|servico|projeto|trabalho|valor|preco|or[cç]amento)/.test(msg)||
  /(?:proposta|oferta|site).{0,65}(?:qual|que tipo|como funciona|do que se trata|explica|me explica)/.test(msg)||
  /(?:pode|poderia|podia) (?:me )?(?:falar|contar|explicar|enviar|mandar|mostrar)(?: (?:mais|sobre|a proposta|os detalhes|o audio))?/.test(msg)||
  /(?:prossegue|prossiga|pode falar|pode mandar|pode continuar|manda ai|manda ver|to ouvindo|estou ouvindo|pode apresentar|quero ouvir|pode enviar|pode explicar|me conta|fala ai|manda o audio|manda audio)/.test(msg))
  return OWNER_PROPOSAL_INTENT.ACCEPT;
 return OWNER_PROPOSAL_INTENT.UNCLEAR;
}
