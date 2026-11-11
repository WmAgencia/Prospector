// Strict Consecom owner-only scripted sales rules. The actual provider sends
// are controlled by persisted state transitions, NEVER by freeform AI output.
export const OWNER_CAMPAIGN_RULES_VERSION="consecom-pinned-wesley-voice-20261111-v3";
export const OWNER_CAMPAIGN_RULES=`## Regras obrigatórias da proposta Consecom — ${OWNER_CAMPAIGN_RULES_VERSION}

**Somente conta Consecom.** Nunca aplicar a clientes de outros espaços.

1. **Script obrigatório:** Saudação curta → aguardar resposta humana → mensagem escrita exata “Meu nome é Wesley, sou dono da agência Consecom. Estou entrando em contato porque queria fazer uma proposta pra vocês.” → aguardar abertura para ouvir → reproduzir SOMENTE a gravação ORIGINAL aprovada do Wesley → após 10 segundos, se a conversa continuar pertinente, “Se você quiser, posso te enviar aqui uma prévia de como ficaria o site de vocês, pode ser?”.
2. **Sinais de abertura:** “pode falar”, “prossegue”, “beleza”, “pode mandar”, “sim”, “me explica”, perguntas sobre a proposta e equivalentes, somente após a introdução escrita, habilitam a fila de áudio. Saudação sozinha nunca habilita áudio. A regra é do sistema, não decisão livre da IA.
3. **Identidade da gravação:** proibido sintetizar áudio da Francisca para a proposta, usar gravação de outra campanha, modificar os dizeres ou inventar áudio. Se o arquivo original não estiver disponível ou íntegro, marcar para revisão humana; não anunciar envio.
4. **Preço da gravação original aprovada:** este áudio de 1min03s oferece o site por R$ 350, com domínio por um ano; depois que ele for enviado, a IA NÃO pode citar a oferta diferente de R$ 550, alterar valor ou prometer funcionalidades/prazos não confirmados. Antes do áudio e em outras campanhas, valores exigem aprovação comercial específica. O arquivo original aprovado determina a oferta desta conversa.
5. **Após o áudio:** não repetir a apresentação, não enviar duas prévias, não perguntar “como podemos ajudar?” e não iniciar uma outra oferta. Responder apenas dúvidas pertinentes e passar clientes interessados para Wesley.
6. **Encerramento definitivo:** após despedida final como “Entendido, caso precise de apoio no futuro, é só chamar”, a conversa fica FINALIZADA e nenhuma mensagem automática adicional é enviada, mesmo com novo “ok”, emoji ou agradecimento.
7. **Recusas e preferências:** “não tenho interesse”, pedido de não contato e pedido de conversa com humano interrompem o fluxo de proposta. “Prefiro texto” proíbe envio de áudio. Não transformar “agora não” em permissão para insistir.
8. **Segurança:** cumprir autorização de contato, verificar sessão correta, não processar robôs como aceite, não repetir mensagem com confirmação incerta, respeitar pausa global e registrar identificador de envio/estado sem presumir entrega.
`;
export function mergeConsecomOwnerRules(previous){
 let current=String(previous||'').trim();
 if(!current)return null;
 if(current.includes(OWNER_CAMPAIGN_RULES_VERSION))return current;
 // Retire a política v2 antes de adicionar a v3: duas versões com preços
 // conflitantes no mesmo treinamento fariam a IA ignorar a regra mais recente.
 const previousHeader='## Regras obrigatórias da proposta Consecom — consecom-pinned-wesley-voice-20261111-v2';
 const oldIndex=current.indexOf(previousHeader);
 if(oldIndex>=0){
  const end=current.indexOf('\n\n## ',oldIndex+previousHeader.length);
  current=(current.slice(0,oldIndex)+(end>=0?current.slice(end+2):'')).trim();
 }
 const obsolete='## Regras da campanha Consecom: apresentação de site em áudio R$ 350 (consecom-audio-first-2026-11-10-v1)';
 const start=current.indexOf(obsolete);
 if(start>=0){
  const after=current.indexOf('\n\n## ',start+obsolete.length);
  current=(current.slice(0,start)+(after>=0?current.slice(after+2):'')).trim();
 }
 const combined=current+'\n\n'+OWNER_CAMPAIGN_RULES.trim();
 if(combined.length>17900)return null;
 return combined;
}
