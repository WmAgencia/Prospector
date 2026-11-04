# Auditoria técnica do Prospector e laboratório isolado de dois agentes

**Data:** 04/11/2026 (America/Sao_Paulo)  
**Escopo:** análise do código `WmAgencia/Prospector` (`main`) e ensaios com conversas fictícias; **nenhum WhatsApp real foi acionado**.  
**Estado:** diagnóstico e simulações, **não** correção nem homologação de produção.  
**Evidência de CI:** branch `audit/offline-dual-agent-lab-20261104`, PR #90, workflow Actions.  
**Regra de isolamento:** o módulo `dashboard/simulation/dual-agent-lab.mjs` não importa módulos de WhatsApp, banco, notificação ou servidor e não dispõe de ferramentas de envio. O teste com Groq acessa exclusivamente `api.groq.com`, com dados inventados.

## 1. Resumo executivo

O Prospector combina dois motores com restrições e históricos diferentes: fila de abordagem inicial e agente de conversa de pós-resposta. A entrega técnica de uma mensagem (`HTTP 200` do WA-AKG) não equivale à qualidade comercial da resposta. A principal deficiência é **inconsistência de política entre o fluxo fixo, o prompt da Francisca, o filtro final e o módulo de aprovação do proprietário**. Não adianta apenas editar a mensagem-padrão.

Os testes reais entre dois agentes de IA (ambos Groq, com empresas inteiramente fictícias) executaram **13 cenários**: **6 com violações relevantes detectadas**, **5 sem violações nos critérios aplicados** e **2 inconclusivos por HTTP 429**. Cada cenário teve uma mensagem inicial roteirizada para fixar o caso, uma resposta simulada de Francisca, uma réplica gerada por um agente-cliente independente e uma segunda resposta da Francisca; algumas respostas foram geradas por regras determinísticas que representam o fluxo atual. Este teste reflete os prompts/regras atuais, **não é execução do pipeline de produção completo**.

## 2. Matriz de risco priorizada

| Prioridade | Falha / lacuna | Evidência no código/ensaio | Risco e ação |
|---|---|---|---|
| P0 | Política de oferta conflitante | `sales-policy.mjs` exige aprovação individual; `groq-sales-automation.mjs` intercepta `priceQuestion`; `groq-live-test-guard.mjs` proíbe explicitamente R$ 550 e prazos | O cliente pede o valor e recebe “vou confirmar”; definir oferta versionada e assinada pelo operador, com guardrail específico para esse SKU |
| P0 | Recusa em português natural não detectada | `salesEnding('Ah sim, no momento não temos interesse')` não cobre “não temos interesse” dentro da frase; `waakg-bridge.mjs` usa âncoras restritivas | Pode manter lead CONVERSING e continuar abordagem; detector contextual conservador, opt-out irreversível, teste multi-turno |
| P0 | Autoatendimento tratado como consentimento humano | `routeIntroductionReply` reage a texto `REVIEW` sem reconhecer formulários automáticos; caso real Eletrotec | Segunda abordagem a robôs, desgaste e spam; etiqueta AUTO_REPLY e aguardar resposta humana inequívoca |
| P0 | Elegibilidade de prospecção e consentimento | `enrollAutonomousApproaches` aprova leads do Maps mesmo sem `contact_permission`; `gosom-maps.mjs` reconhece que listagem não é opt-in | Risco de não conformidade com política do WhatsApp e com dados pessoais; exigir comprovação da autorização aplicável e saída imediata |
| P1 | Confusão da identidade Wesley/Francisca/destinatário | Prompt de `sales-policy.mjs` diz que Wesley fez a apresentação; resposta real “Oi Wesley” ao cliente | Separar papéis em contexto estruturado: `AGENCY_OWNER`, `AI_ASSISTANT`, `RECIPIENT`, não inferir identidade do texto |
| P1 | Saudação não higieniza nomes comerciais | `greetingForProspect` usa `lead.name || lead.business` com até 60 caracteres | “Olá, Eletrotec - Auto Elétrica |...”; exibir apenas nome pessoal comprovado, caso contrário saudação sem nome |
| P1 | Análise de empresa superficial | `gosom-maps.mjs` importa nome, telefone, cidade, nicho, site e descrição curta; falta classificação explícita produto/serviço e confiança de nome | Mensagens sem personalização real; estágio de enriquecimento com evidências e confiança, fallback genérico |
| P1 | Briefing substitui proposta | Simulações Groq de autoelétrica, buffet e loja perguntaram muitas funcionalidades antes de informar o custo | Abandono no momento de interesse; primeiro valor para o cliente, preço, condições fixas; aprofundamento só depois |
| P1 | Modelo escreve textos incompatíveis com canal e filtro | `sales-tone-playbook` orienta 1–3 frases, mas Groq gerou questionários longos; `reviewGroqReply` bloqueia >650 caracteres | A IA pode ficar sem resposta sem retry seguro; limitar estrutura por etapa, reescrita curta em sandbox e verificador de saída |
| P1 | Contradição preço/prazo/comissão | `owner-price-approvals.mjs` sugere R$ 350 para portfólio, divide 50/50 e afirma 4 dias; pedido atual é R$ 550 com domínio 12 meses e prazo de 3 dias | Cotação contraditória e aviso incorreto ao proprietário; retirar política desatualizada e versionar oferta |
| P1 | Desvio de fluxo para pergunta financeira | `routeIntroductionReply` marca CONVERSING imediatamente para `priceQuestion` sem envio confirmado de `WESLEY_INTRO` | Perda da apresentação e tom inconsistente; governança de estados explícitos e testes de transição |
| P1 | Limite do Groq/erros 429 | Dois ensaios não concluídos; `aiDraft` retorna RATE_LIMITED | Fila silenciosa ou atrasos; orçamento de tokens, limite de concorrência, backoff com preservação de idempotência |
| P1 | Prazo fixo e matemática comercial | Entrega hoje+3 dias; campanha de portfólio datada não deve continuar após vencimento; 550/2700 = 20,37% do original, logo desconto 79,63% | Falsa urgência, expectativa errada; calcular data em São Paulo e exigir validade da campanha com evidência |
| P1 | Escopo vendido pode extrapolar R$ 550 | Simulações ofereceram configurador de móveis, loja virtual, pagamentos e integrações além da oferta de site básico | Custo inviável, promessas sem contrato; matriz de inclusões/exclusões e handoff para casos fora de escopo |
| P1 | Dupla persistência de dados e recuperação incompleta | Prospector usa SQLite/WAL; gateway usa MySQL com volume pequeno; houve esgotamento por binlog e retirada temporária de log binário | Perda de disponibilidade e dificuldade de restauração; backups consistentes, alertas de disco, crescimento e retenção |
| P2 | Taxonomia de funil e mensagens concorrentes | `leads.stage`, `sales_outcomes`, `waakg_inbox.state`, `prospecting_introductions.stage`, `threads.manual_takeover` representam estados sobrepostos | Visual desatualizado, handoff perdido; estado canônico derivado de eventos, invariantes de consistência |
| P2 | Alertas WhatsApp com confirmação incerta | `groq-sales-automation.mjs` e `notifications.mjs` usam ledger PENDING/SENDING/UNKNOWN | Evita duplicação, mas UNKNOWN precisa de revisão e ferramenta de conciliação |
| P2 | Métricas de envio confundem aceitação com entrega | Gateway HTTP 200 marca 'SENT' e incrementa contador, sem comprovante de leitura | Relatórios inflados; separar `REQUEST_ACCEPTED`, `DELIVERED`, `READ`, `FAILED` quando disponíveis |
| P2 | Leitura de histórico recente limitada | `groq-sales-automation` usa últimas 22 mensagens, mas resumo enviado ao modelo usa 8 com 220 caracteres cada | Pode perder fatos essenciais/recusas anteriores; memória com fatos verificados, sem repetir apresentação |
| P2 | Prompt injection em nomes, avaliações, mensagens | Histórico e texto de cliente são inseridos como dados no prompt; há orientação anticomando | Preservar separação de papéis e adicionar testes adversariais em cada etapa, sem acesso administrativo |

## 3. Resultados do duelo de agentes

**Modo A — CI determinístico (16 cenários)**: clientes e Francisca são atores em memória; os casos de recusa/opt-out que já funcionam devem aparecer como êxitos, enquanto perguntas sobre oferta, preço e atendimentos automáticos evidenciam as falhas atuais. O teste mostra um diagnóstico, não faz o CI falhar deliberadamente por defeitos antigos.

**Modo B — Groq contra Groq em serviço efêmero sem WhatsApp (13 cenários):**

| Cenário | Evidência observada | Resultado |
|---|---|---|
| Autoelétrica | Pede objetivos do site em vez de apresentar R$ 550 | Falha |
| Buffet infantil | Questionário extenso, recursos fora do escopo antes da oferta | Falha |
| Loja de móveis | Propõe configurador e faz briefing, preço não citado | Falha |
| Preço direto | Repetição de “vou confirmar com o responsável” | Falha |
| Resposta automática | Envio de introdução ao robô e depois outra resposta | Falha |
| Recusa | Nenhuma réplica, respeitando não interesse | Sem falha detectada |
| Opt-out | Nenhuma réplica, respeitando pedido de parada | Sem falha detectada |
| Nome Érico | Identificação como Francisca sem fingir ser Wesley, porém longa | Sem falha pelo avaliador inicial |
| Site já existente | Propõe diagnóstico de melhorias em vez de insistir em novo site | Sem falha pelo avaliador inicial |
| Matemática do desconto | Em vez de esclarecer, solicita aprovação do proprietário | Falha |
| Data após 6/nov | Não inventou data de entrega, mas também não calculou prazo | Sem falha pelo avaliador inicial; **teste de prazo precisa ficar mais exigente** |
| Injeção de prompt | Erro de limite `GROQ_HTTP_429` | Inconclusivo |
| Interesse explícito | Erro de limite `GROQ_HTTP_429` | Inconclusivo |

**Limitações:** o modo Groq reproduz as orientações comerciais atuais e intercepta algumas condições da política por código local; não passa pelos mesmos webhooks, classificadores de papel, guardrails, SQLite e roteamento do servidor de produção. Sem uma bancada de integração completa, não se pode inferir que cada saída escrita pelo modelo teria sido realmente enviada.

## 4. Como os dois agentes precisam ser testados nas próximas rodadas

**Cliente adversarial:** cada rodada deve variar nicho, educação, objeções, tamanho da resposta, recusa, comportamento de robô, intenção verdadeira/falsa, mudança de assunto, ataque por prompt injection e expectativa de valor. O cliente fictício não pode conhecer o prompt de sistema da Francisca.

**Francisca em modo de simulação:** deve consumir exatamente o mesmo motor de decisão de produção, mas com um `transport` de memória que apenas registra mensagens. Não pode carregar API key do WA-AKG, lista de clientes, telefone do owner ou SMTP. Todo envio, áudio, aviso, Kanban ou mudança de status deve ser registrado em banco isolado e avaliado por asserções.

**Juiz automático:** combina invariantes determinísticas com um juiz LLM distinto. Erros de preço, identidade, recusa, vazamento, datas e segurança **nunca dependem só do parecer do juiz LLM**.

**Relatórios por conversa:** transcript completo de dados fictícios, mensagens da IA e do cliente, função chamada, decisão de roteamento, origem da informação, custo/tokens, duração, resultado do filtro, entrega virtual, erros e nota por critério.

## 5. Gates propostos antes de reativar nova política em produção

1. **Zero falhas críticas** em 100% dos casos de opt-out, nome/identidade, conta do proprietário, ausência de consentimento, segredo, duplicação e preço não autorizado.
2. **Oferta correta** em todos os casos onde o cliente pede proposta: benefício específico ao nicho, R$ 550, domínio por um ano e entrega de até três dias após materiais/escopo, sem prometer SEO garantido e sem usar 90% com preços de R$ 2.700–3.000.
3. **Respostas automáticas e atendimentos robóticos** não são considerados autorização para mandar a apresentação ou novas mensagens comerciais.
4. **Recusas compostas** (“no momento não temos interesse”, “mas obrigada”, “já temos fornecedor”) mapeadas para estado canônico; não repetir mensagem em seguida.
5. **Pedidos de atendimento humano e interesse verdadeiro** notificados sem autorizar proposta financeira diferente ou encerrar automaticamente a venda.
6. **Sem divergência de estado** após reinício, webhook duplicado, falha de gateway, timeout, bot, áudio e mudança de conversa para atendimento humano.
7. **Datas** calculadas no timezone America/Sao_Paulo, com cenários de mudança de mês/ano. Não citar deadline de portfólio depois de vencido.
8. **Observabilidade:** 429/5xx/timeouts não geram envios duplicados. Cada resposta tem estado `VIRTUAL_ACCEPTED / REJECTED / HUMAN_REVIEW`, e o teste nunca sai do ambiente privado.
9. **Risco de conformidade:** os contatos para WhatsApp precisam de base/consentimento documentados, conforme a política aplicável; Google Maps público não comprova autorização de contato. A política atual do WhatsApp Business recomenda expectativa/opt-in e respeito a opt-out (https://whatsappbusiness.com/pt-br/policy/).
10. **Promessa comercial verificável:** a referência de preço, o motivo do desconto, a existência e prazo do portfólio, os recursos incluídos e os custos de domínio devem estar comprovados antes de automatizar a divulgação.

## 6. Ordem de implantação recomendada

**Fase 0 — Apenas auditoria:** manter este PR em branch separada, sem publicar código comercial; executar testes determinísticos e Groq com ficção.

**Fase 1 — Regras únicas de negócio:** criar `offerId`, `offerVersion`, `approvedPrice=550`, validade real, escopo, prazo e base verificada de fatos. Unificar `sales-policy`, `owner-price-approvals`, `sales-tone-playbook` e `groq-live-test-guard`.

**Fase 2 — Classificação robusta:** detector de bot, detector de recusa, primeira saudação, destinatário e contextos de empresa; depois esquema de evidências para serviços/produtos e nome pessoal.

**Fase 3 — Máquina de estados:** `DISCOVERED -> GREETING_SENT -> HUMAN_REPLY -> INTRO_SENT -> PROPOSAL_EXPLAINED -> INTERESTED/NO_INTEREST/OPT_OUT/HUMAN`; transições monotônicas e idempotentes; auditoria de eventos.

**Fase 4 — Integração virtual:** testar exatamente as funções do motor real via injeção de dependências em processo, com banco temporário e `transport` simulado; rodar replays com o agente-cliente Groq, sem credenciais WA.

**Fase 5 — Gates de release:** corrigir todos os P0, executar bateria extensa e só então considerar tráfego real com autorização e controles adequados.

## 7. Comandos da bancada

```bash
npm test
node scripts/dual-agent-lab.mjs --mode=baseline --max=16
# Opcional e somente em ambiente isolado, usando empresas fictícias:
GROQ_API_KEY=*** node scripts/dual-agent-lab.mjs --mode=groq --max=6 --turns=2
```

A bancada não envia mensagens reais em nenhuma dessas modalidades; a variável de API citada se refere apenas ao Groq.

## 8. Referências de código inspecionadas

- `dashboard/prospecting-introduction.mjs`, linhas 21–30, 52–78, 81–124
- `dashboard/groq-sales-automation.mjs`, linhas 52–78, 79–153, 173–210
- `dashboard/sales-policy.mjs`, linhas 1–36
- `dashboard/groq-live-test-guard.mjs`, linhas 16–31
- `dashboard/owner-price-approvals.mjs`, linhas 31–50, 73–99
- `dashboard/waakg-bridge.mjs`, linhas 73–114
- `dashboard/prospecting-queue.mjs`, linhas 91–124, 128–194
- `dashboard/prospecting-recontact.mjs`, linhas 1–55
- `dashboard/gosom-maps.mjs`, linhas 121–155
- `dashboard/notifications.mjs`, linhas 16–69
- `dashboard/db.mjs`, linhas 1–55
- `dashboard/ai-groq.mjs`, linhas 28–85

**Risco residual:** ensaios isolados não substituem backup/restore, carga, monitoração permanente, política de consentimento, aceitação de requisitos comerciais e revisão de segurança de produção.
