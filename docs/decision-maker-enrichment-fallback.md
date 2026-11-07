# Prospecção com enriquecimento de decisor e fallback (especificação aprovada)

## Objetivo e compatibilidade

Adicionar estágio **pré-envio** ao Prospector: descoberta de empresa -> identificação validada do CNPJ -> consulta escalonada a fontes gratuitas autorizadas -> identificação de sócio-administrador/decisor e contato profissional -> verificação de WhatsApp -> seleção de destinatário -> fila existente.

**Não modificar neste documento nem contornar:** orçamento/créditos, limites do tenant, limite transacional de 250 novas abordagens/dia/operação, intervalos existentes, horários de envio, opt-out e bloqueios, isolamento entre tenants, origem autorizada do contato, controles de aprovação, regra de responder apenas contatos iniciados pela operação, nem worker ativo atual.

## Agendamento

- Propor descoberta diária desde **00:00 America/Sao_Paulo** (em vez das 05:00 atualmente registradas no README), configurável por tenant. Separar o relógio de descoberta/enriquecimento do relógio de **envio**.
- Não disparar WhatsApp durante a madrugada. Manter janela atual documentada: seg–sex 08h–17h30, sáb 08h–17h, domingo sem novas abordagens, até alteração expressa.
- Pipeline idempotente, persistido, reentrante, retomável após reinício, processado em lotes com limite de chamadas e backoff.
- Só ativar em produção após testes, migração e confirmação operacional.

## Estratégia de resolução

1. Descobrir empresa de fontes já existentes (Maps/Apify etc.) e manter identidade original da fonte, telefone comercial, URL, nome e endereço.
2. Resolver CNPJ utilizando fonte legítima de consulta; nunca confiar unicamente em nome semelhante. Cruzar razão/nome fantasia, município/UF e endereço; se ambíguo, estado `cnpj_unverified` e seguir fallback, sem atribuir sócio de outra empresa.
3. Enriquecer exclusivamente por fontes gratuitas com termos que autorizem uso automatizado. Adaptadores com timeout, rate limit, circuit breaker, cache, status/fonte e versão; fornecedores candidatos OpenCNPJ, Minha Receita, bases abertas da Receita. Confirmar disponibilidade, campos e limites em testes antes de habilitar.
4. Extrair o **nome e função** do QSA. Importante: QSA não contém necessariamente número pessoal do sócio. **Telefone cadastral da empresa não é telefone direto do sócio.** Só marcar `decision_maker_phone` quando houver evidência independente de vínculo pessoa ↔ número profissional publicamente disponibilizado para negócios.
5. Normalizar números E.164 e verificar suporte WhatsApp somente por integração autorizada e conforme os limites aplicáveis. Não confundir “número consta no WhatsApp” com autorização para envio.
6. Prioridade A: contato profissional comprovado do decisor, canal elegível e WhatsApp confirmado -> personalizar primeiro texto: `Oi, tudo bem? Me chamo Wesley, queria falar com {primeiro_nome}.` Nome do apresentador deve ser configurável por tenant, não fixar Wesley globalmente.
7. Prioridade B: quando A falhar por ausência de dado, WhatsApp indisponível, canal não elegível, indisponibilidade do provedor ou baixa confiança -> validar contato comercial original do Maps e usar **mensagem inicial já configurada no sistema** (hoje ex.: “Olá, tudo bem?”). Nunca inventar nome.
8. Se nenhum número elegível, marcar `no_reachable_whatsapp`, não agendar envio. Se mensagem falhar depois da tentativa, classificar motivo e **não disparar automaticamente para segundo número** sem checar se primeira foi entregue/está incerta; evita duas abordagens.
9. Mesmo CNPJ, telefone ou `place_id` não geram abordagens redundantes; deduplicação global por tenant e restrições da fila existentes. Não reiniciar contatos com opt-out ou histórico.
10. Registrar decisão: `source=decision_maker|business_fallback|unreachable`, `cnpj_status`, `decision_maker_name`, `decision_maker_role`, `phone_source`, `whatsapp_status`, `verified_at`, `confidence`, `fallback_reason`, `last_enrichment_at`. Evitar expor telefones pessoais desnecessariamente.

## Estados esperados

`discovered -> cnpj_pending -> cnpj_resolved|cnpj_unverified -> enriching -> contact_selection -> whatsapp_check -> ready|unreachable -> queued -> reserved -> sent|uncertain|failed`.

As falhas de provedores de dados **não bloqueiam** fallback comercial, mas a indisponibilidade do sistema de validação do WhatsApp deve deixar o lead em pendência ou seguir uma política de envio já aprovada, nunca presumir `whatsapp=true`.

## Casos de teste obrigatórios

- CNPJ certo, QSA sem telefone: usa comercial; não inventa telefone do sócio.
- CNPJ ambíguo/homônimo: não envia ao decisor errado.
- Nome do decisor com WhatsApp profissional vinculado: mensagem personalizada.
- Número do decisor sem WhatsApp: fallback comercial validado.
- Sem WhatsApp em ambos: não enfileira.
- Primeiro envio status incerto: não duplica no fallback.
- Mesmo número para empresa e decisor: apenas um envio.
- Empresa/provedor lento, 429, 5xx: timeout, cache/backoff, fallback.
- Reinício durante enriquecimento ou envio: idempotência.
- Não envia antes da janela; descoberta pode ocorrer à 00h.
- Limite de 250 por tenant/dia mantém reserva transacional; domingos sem novos envios.
- Opt-out, lista de supressão, conta sem saldo ou pausada impedem envio.
- Tenants distintos não compartilham dados de contato sem base legítima ou permissões.
- Contactar pessoa física requer avaliação de base legal LGPD, transparência e mecanismo de oposição; respeitar termos de plataformas e regras antispam.

## Entrega técnica posterior

Identificar worker de descoberta, pipeline de normalização, persistência e fila de envio antes de alterar arquivos operacionais; implementar flags `DECISOR_ENRICHMENT_ENABLED=false` e `DISCOVERY_START_HOUR=0` (ou configuração persistida já existente), realizar testes de integração/aceitação e liberar progressivamente.

**Este documento não declara a funcionalidade implantada.** A branch foi criada para implementação isolada sem alterar a produção.
