# Prospecção de contatos comerciais públicos

A busca por nicho e cidade pode incluir empresas com telefone comercial público, sem exigir consentimento prévio para **descoberta, organização, análise e preparação manual de contatos**.

## Fluxos separados

- **Contato individual operado por pessoa:** a lista apresenta um link direto `wa.me` para empresas elegíveis, com uma saudação respeitosa preenchida. O link abre o WhatsApp, e somente o operador decide se envia a mensagem. A geração do link não chama a API de envio, não insere um envio no banco e não faz disparos.
- **Fila automática do WA-AKG:** continua exigindo autorização documentada do destinatário. Um número público, por si só, não é convertido em `contact_permission=true` nem em evidência de opt-in.
- **Supressões, contatos existentes, cadência e números sem telefone:** nunca são reabilitados automaticamente. A seleção de empresas públicas não modifica a política de opt-out.

## Garantias de regressão

Os testes verificam que a pesquisa pública gera acesso para contato manual, mas não envia; contatos bloqueados ou já abordados não têm link de nova prospecção; e leads sem autorização não podem entrar na fila automática.

O bloqueio de **descoberta e preparação manual** por ausência de autorização de envio seria uma regressão de produto. Já as regras de envio em canais de terceiros devem continuar sujeitas às respectivas condições, à legislação aplicável e a revisões futuras.
