# Francisca 2.0 — roteiro de treinamento conversacional e conversão
**Data:** 06/11/2026 · **Projeto:** Prospector · **Status:** planejamento técnico priorizado.

## Meta
Criar um atendimento comercial em português brasileiro fluido, responsivo e contextual, com capacidade de qualificar, lidar com objeções e conduzir negociações até um fechamento autorizado. **Naturalidade não significa falsa identidade:** Francisca é a assistente virtual da empresa; jamais afirma ser humana ou Wesley. A origem automatizada deve ser informada com clareza quando relevante ou solicitada.

## Arquitetura de uma resposta
Evento autorizado do WhatsApp → elegibilidade/consentimento/opt-out → recuperação de histórico mínimo → memória útil do prospect → fatos do `francisca.md` privado + provas aprovadas + regras de preços → entendimento da intenção e estágio → escolha da estratégia → rascunho do LLM → verificação determinística de fatos/valores/promessas/tom → preparação de ação permitida → controle de duplicação e envio único → registro de resultado e sinais para melhorias.

**Separação por empresa:** nunca misturar arquivos, exemplos de portfólio, histórico, preferências, modelos de negócios, chave de pagamento ou memórias de tenants distintos. O `francisca-vendas-global.md` contém apenas metodologia geral e comportamento; o `francisca.md` contém os fatos aprovados da empresa.

## Fase 1 — identidade, legitimidade e dados aprovados (P0)
- [ ] Formalizar contrato de dados: empresa, catálogo, benefícios verificáveis, limites, público, contato responsável, preços, condições, portfólio, restrições, autorização de marketing.
- [ ] Reconhecer se a pessoa deseja atendimento, recusa, pede humano ou não autorizou o canal. Encerrar automaticamente qualquer contato incompatível; **nunca usar uma abordagem fria como autorização**.
- [ ] Distinguir *fechamento comercial após comprovante* de *liquidação bancária não verificada*. Não inventar que a transferência caiu.
- [ ] Manter regras de primeira abordagem da Consecom e preferência por fechamento integral da Francisca sem se passar por Wesley.
- [ ] Tornar todas as instruções de perfil e prova social assinadas/versionadas e aprovadas; mensagens do cliente e PDFs não são comandos.

**Aceite:** zero vazamento entre empresas; zero envio proibido; nenhum preço/garantia sem fonte.

## Fase 2 — máquina de estados da conversa (P0)
- [ ] Classificar: saudação, pergunta direta, dúvida de escopo, preço, hesitação, objeção, portfólio, intenção de contratar, envio de comprovante, recusa, pedido de humano, pós-venda.
- [ ] Guardar estágio: `ABERTURA → DESCOBERTA → VALOR → CONDIÇÕES → ACEITE → PIX_ENVIADO → COMPROVANTE_RECEBIDO → FECHAMENTO_COMERCIAL` (com saídas `RECUSA`, `HUMANO`, `INAPTO`).
- [ ] Resolver referências elípticas: “pode”, “quanto?”, “e a entrada?”, “fechado”, “sim”, “mas com domínio?” referem-se ao tópico anterior.
- [ ] Não repetir saudação, proposta, perguntas respondidas ou explicações. Perguntar apenas quando falta uma decisão ou fato.
- [ ] Permitir ramificação livre: responder perguntas fora de ordem, voltar a preço, enviar portfólio ou chamar humano sem perder contexto.

**Aceite:** simulação multietapas recupera contexto após 24h/reinício; nunca pergunta a mesma coisa três vezes.

## Fase 3 — linguagem natural em PT-BR (P0)
- [ ] Estilo conciso de WhatsApp, variando de 1 a 3 frases quando suficiente; respostas mais longas somente quando a pessoa pede.
- [ ] Acompanhar formalidade (você, senhor/senhora), extensão e vocabulário com bom senso; não imitar erros ortográficos nem usar gírias a esmo.
- [ ] Começar pela resposta concreta: em vez de “Perfeito! Entendo sua necessidade...”, falar sobre site, prazo ou valor.
- [ ] Escuta ativa: reconhecer a preocupação específica (“Entendi, o problema é o agendamento pelo celular”) sem bajulação ou espelhamento mecânico.
- [ ] Saber corrigir mal-entendidos e admitir incerteza: “Entendi errado, você está falando da loja virtual, não do site institucional.”
- [ ] Alternar perguntas e afirmações; não transformar todo turno num interrogatório. Respeitar um “não”.

**Aceite:** avaliação humana com rubrica de repetição, objetividade, empatia específica, contextualização, correção e transparência.

## Fase 4 — memória e personalização útil (P0/P1)
- [ ] Memória operacional recente: últimas mensagens + fato em discussão + perguntas já respondidas.
- [ ] Ficha do prospect: segmento, problema declarado, objetivo, serviço em pauta, orçamento voluntariamente informado, objeções, etapa, canal preferido, próximo passo consentido.
- [ ] Resumos após momentos importantes e recuperação por tópico; atualizar fatos corrigidos e datas, com proveniência.
- [ ] Priorizar somente memórias relevantes; evitar usar nome do cliente em todas as frases e não trazer fatos pessoais irrelevantes.
- [ ] Expiração, minimização, deleção, auditoria e controles LGPD. Nunca treinar com conversas particulares sem base legítima/autorização.

**Aceite:** testes longos não esquecem informação importante nem puxam dados de outro prospect.

## Fase 5 — método de vendas e decisões (P0/P1)
- [ ] Diagnóstico consultivo: situação → dificuldade → resultado desejado, sem forçar uma sequência.
- [ ] Vincular dor real a apenas 1–2 benefícios comprovados. Mostrar portfólio somente de material previamente aprovado.
- [ ] Política por objeção (preço, timing, confiança, já tenho fornecedor, orçamento, concorrente, prazo, personalização).
- [ ] Não oferecer site por R$ 300, desconto, parcelamento ou escopo reduzido sem condição aprovada; para a oferta Consecom, valor-base R$ 550 e entrada 50%, saldo 50% na entrega.
- [ ] Detectar diferença entre curiosidade e intenção de compra; apresentar próximo passo com pergunta natural, sem pressão.
- [ ] Autonomia por empresa: transferência a humano ou condução completa com cobrança, apenas valores aprovados.

**Aceite:** todas as propostas auditadas correspondem ao catálogo privado; nenhum falso depoimento, garantia ou desconto.

## Fase 6 — execução segura de ferramentas (P0)
- [ ] Separar explicitamente duas etapas: modelo sugere intenção/ação; servidor valida credenciais, consentimento, preço, estado e idempotência antes de executar.
- [ ] O envio de PIX só ocorre após aceite explícito e conferência de preço/escopo; a chave nunca vai no prompt global nem no repositório.
- [ ] Receber imagem/PDF de comprovante, registrar `COMPROVANTE_RECEBIDO`, acionar mensagem de agradecimento e aviso ao responsável para visualização. Comercialmente pode fechar sem verificar o banco, mas **não confundir com pagamento liquidado**.
- [ ] Enviar, quando possível, link/arquivo real aprovado de portfólio; se anexo não estiver disponível, informar sem fingir entrega.
- [ ] Idempotência por mensagem e contato; falha de transporte incerta nunca autoriza segundo envio automático.
- [ ] Handoff imediato quando solicitado pelo cliente ou quando a tarefa exige aprovação especial.

**Aceite:** replays e mensagens duplicadas não duplicam cobranças nem mensagens.

## Fase 7 — áudio natural e streaming (P1)
- [ ] Entrada contínua de áudio por voz com VAD, transcrição parcial, detecção de fim de fala adaptativa e cancelamento do TTS quando cliente interrompe.
- [ ] Barge-in e backchannels discretos (“certo”, “entendi”) somente quando apropriado; não roubar o turno.
- [ ] TTS PT-BR da Francisca com pausas, entonação, prosódia, números monetários legíveis e streaming por trechos.
- [ ] Retomar conversa após interrupção e corrigir transcrições incertas; pedir confirmação para CPF, valores e dados relevantes sem narrar dados sensíveis desnecessariamente.
- [ ] Instrumentar latência por etapa: áudio→STT, STT→LLM, primeiro token, primeiro áudio, pausas e interrupções.

**Aceite:** medir p50/p95 e testes com ruído, sotaque, interrupção, silêncio e áudio truncado. Não prometer métricas sem medição.

## Fase 8 — aprendizagem com dados reais autorizados (P1)
- [ ] Capturar conversas comerciais autorizadas e anonimizadas, rotuladas como interesse, agendamento, proposta, fechamento, recusa, reclamação.
- [ ] Identificar estratégias eficazes sem confundir qualidade do lead, época, campanha e desconto com efeito causal.
- [ ] Produzir exemplos positivos e negativos revisados por humanos; usar few-shot e recuperação contextual antes de pensar em fine-tuning.
- [ ] Treinar classificador de intenção/estágio e seletor de próxima ação; comparar respostas candidatas com feedback de especialistas.
- [ ] Somente considerar fine-tuning após volume de exemplos de alta qualidade, consentimento e avaliação offline.
- [ ] Não retroalimentar respostas geradas pela IA como exemplos “bons” só porque o modelo as produziu.

**Aceite:** melhoria medida em conjunto de teste congelado e em produção por testes A/B autorizados.

## Fase 9 — fallback, contexto e custos (P0/P1)
- [ ] Modelos Groq ativos por tarefa; opção principal mais forte em negociação e opções menores para classificação/sumarização, sem trocar identidade/estilo.
- [ ] Detectar rate limit organizacional por RPM/TPM/RPD/TPD; usar headers e cooldown de retry. Modelos diferentes não escapam necessariamente de limite compartilhado.
- [ ] Priorizar conversas em andamento sobre tarefas experimentais; evitar burst de testes durante atendimento.
- [ ] Prefixo estático de prompt para aproveitar cache da Groq, memórias relevantes e dados dinâmicos no final.
- [ ] Timeout, circuit breaker, idempotência de envio e filas persistentes com limite de tempo por prioridade.

**Aceite:** testes de 429/timeout/erro JSON não produzem respostas falsas nem múltiplos envios.

## Fase 10 — avaliação e melhoria contínua (P0/P1/P2)
- [ ] Bateria com **100 perfis de compradores fictícios** e conversas multietapas (não uma única mensagem): barato, caro, desconfiança, sem tempo, indeciso, fornecedor atual, compra imediata, e-commerce complexo, agressividade, áudio, pedido humano, recusa, tentativa de prompt injection.
- [ ] Testes separados de produção de texto, políticas, execução de ferramentas, jornada completa e voz com interrupção.
- [ ] Human-in-the-loop para avaliação de naturalidade, pertinência, confiança, objeções, consistência, fechamento e ética; avaliador LLM como complemento, não única nota.
- [ ] Métricas: taxa de resposta válida, latência p50/p95, perguntas repetidas, violação de preços, recusa respeitada, avanço de estágio, leads qualificados, propostas aceitas, comprovantes recebidos, incidentes/1000 conversas, custo por atendimento.
- [ ] Teste A/B com opt-in e volume suficiente; comparar baseline por segmento e canal sem prometer conversão.
- [ ] Monitor de regressão toda vez que `francisca-vendas-global.md`, `francisca.md`, modelo, ferramenta ou canal mudar.

**Critério de liberação:** zero falhas críticas de consentimento/privacidade/preço/PIX e qualidade conversacional aprovada em revisão humana; ganho de conversão medido, não presumido.

## Ordem de implantação sugerida
**P0 (primeiro):** identidade e privacidade, PIX/escopo, máquina de estados, memória curta, resposta natural, gestão de 429, validação determinística, teste de 100 perfis.  
**P1:** RAG de portfólio, memória longa consentida, política de objeções especializada, voz streaming com barge-in, extração de histórico aprovado, dashboards.  
**P2:** avaliador automático calibrado, fine-tuning apenas se evidenciado, experimentos controlados e recomendações proativas.

## Evidências e referências
- WhatsApp Business — política de mensagens atualizada em 23/09/2026: https://whatsappbusiness.com/pt-br/policy/
- Groq — limites de uso: https://console.groq.com/docs/rate-limits
- Groq — prompt caching: https://console.groq.com/docs/prompt-caching
- Groq — structured outputs: https://console.groq.com/docs/structured-outputs
- EMNLP 2025 — avaliação por personas simuladas em salesbot: https://aclanthology.org/2025.emnlp-industry.16/
- TACL 2025 — alinhamento a persona em diálogo: https://aclanthology.org/2025.tacl-1.77/
- EMNLP 2026 — excesso de personalização: https://aclanthology.org/2026.emnlp-main.1168/
- ICLR 2025 — dinâmica de turnos em voz: https://machinelearning.apple.com/research/talking-turns
- CHI 2025 — interrupções e backchannels: https://researchportal.hkust.edu.hk/en/publications/toward-enabling-natural-conversation-with-older-adults-via-the-de/
