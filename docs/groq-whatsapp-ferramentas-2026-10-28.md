# Assistente Groq WhatsApp — integração operacional

Atualização: 28/10/2026

## Arquitetura
- Recepção: WA-AKG → webhook HMAC verificado em `dashboard/waakg-bridge.mjs`.
- Identidade: o assistente só processa o JID de proprietário definido em `GROQ_OWNER_WHATSAPP` e a sessão selecionada do WA-AKG.
- Inteligência: `dashboard/groq-models.mjs`, que consulta modelos ativos de `GROQ_API_KEY`, usando `openai/gpt-oss-120b` para operações complexas e alternativas disponíveis.
- Executor: `dashboard/groq-owner-tools.mjs`. Nenhuma SQL ou credencial é exposta como ferramenta ao LLM.
- Fila: `dashboard/groq-owner.mjs` — serializa solicitações do proprietário e registra evento de webhook antes de processá-lo. Não repete envio quando a entrega é incerta.

## 22 ferramentas disponíveis
**Leitura e diagnóstico**:
`list_capabilities`, `system_status`, `system_diagnostics`, `list_prospects`, `search_leads`, `get_lead`, `list_conversations`, `read_conversation`, `whatsapp_status`, `list_whatsapp_chats`, `read_whatsapp_chat`, `list_meetings`, `list_workflows`, `read_audit_log`, `discovery_history`, `safe_settings`.

**Ações com validação**:
`create_lead`, `update_lead`, `set_pause`, `create_meeting`, `block_contact`, `search_businesses`, `prepare_message`.

Obs.: O inventário atual contém 23 ferramentas no total conforme o código, pois inclui 16 leituras e 7 operações. Se divergirem as contagens entre versões, consultar `GET /api/groq/capabilities` (autenticado).

## Controles de segurança
- `block_contact`: não bloqueia imediatamente; retorna código único que só executa após mensagem `CONFIRMAR 123456` do proprietário.
- `prepare_message`: permite **um** envio individual a quem comprovadamente iniciou conversa ou deu permissão; confirmação em até 10 minutos. Sem repetição automática diante de resultado desconhecido.
- `update_lead`: somente nome comercial, cidade, segmento, URL, observações e estágio. Campos validados; nada de alterações arbitrárias em SQL ou permissões de contato.
- `create_meeting`: cria registro CRM, sem convite externo em calendário.
- `set_pause`: não habilita automação de marketing ou envios em lote.
- Qualquer operação de alteração relevante é auditada no banco do Prospector.
- O conteúdo de chats e leads é considerado dado não confiável e nunca instrução para o modelo.

## Comandos ilustrativos no WhatsApp
- "Como está a saúde do Prospector? Veja erros e tarefas pendentes."
- "Procure a empresa Oficina Exemplo em Sorocaba e me mostre os dados."
- "Atualize a etapa do lead [ID] para INTERESTED e adicione a observação 'Pediu proposta'."
- "Liste minhas reuniões e cadastre uma reunião com o lead [ID] amanhã às 15h de São Paulo."
- "Quais conversas chegaram hoje e quais ainda não respondi?"
- "Quais foram as últimas alterações feitas pela IA?"
- "Busque oficinas mecânicas em Sorocaba e mostre as ainda não abordadas."
- "Bloqueie o contato do lead [ID]." (exige confirmação)
- "Prepare uma resposta individual para [telefone]." (exige confirmação para enviar)

## Testes realizados
- Sintaxe dos módulos Groq: passou.
- Mock de `safe_settings`, `search_leads`, `update_lead` e rejeição de etapa inválida: passou.
- Mock de `block_contact`: confirmação gerada e nenhuma ação executada antes da aprovação.
- Endpoints autenticados `/api/groq/capabilities` e `/api/groq/healthcheck`: HTTP 200; acesso anônimo: HTTP 401.
- Catálogo Groq na conta conectada: 11 modelos listados no diagnóstico.
- Teste sintético com modelo `openai/gpt-oss-120b` usando tool calling: `system_status` chamado corretamente com `tool_call_id`.
- Deploy Railway: **SUCCESS** e health check aprovado.

## Limitações
- Não há permissão para alterar código-fonte, Railway/Vercel, senhas, credenciais, webhooks ou executar SQL livre pelo WhatsApp.
- Prospecção em fontes públicas OpenStreetMap pode sofrer timeout e não é exaustiva.
- Mensagens externas e operações com impacto relevante exigem confirmação, não existe envio em massa.
- A conversa real após alteração das ferramentas pode ser validada pelo proprietário pelo próprio WhatsApp com os exemplos acima; o teste de ferramenta foi sintético e não alterou dados de clientes.
- Recomendado rotacionar a chave Groq compartilhada em chat e substituí-la somente no Railway.
