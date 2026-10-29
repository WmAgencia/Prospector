# Francisca — administração via WhatsApp

Ações administrativas só podem ser acionadas a partir do número completo configurado em `PROSPECTOR_OWNER_PHONE`, em JID individual e sessão WA-AKG verificada. O nome do contato, sufixo do número e texto da mensagem não concedem permissões.

O proprietário pode pesquisar nichos/cidades, consultar o CRM, acompanhar filas, revisar campanhas e alterar configurações operacionais. Ações sensíveis usam código de confirmação de seis dígitos na própria conversa. Busca pública não constitui consentimento comercial. Envio inicial só pode incluir contatos com opt-in documentado, com deduplicação e intervalo de 90 segundos; resultados incertos não são repetidos.

O recurso não inclui acesso a senhas, tokens, SQL arbitrário ou shell por WhatsApp. A entrega real exige CI aprovado, deploy Railway e validação ponta a ponta com sessão conectada.
