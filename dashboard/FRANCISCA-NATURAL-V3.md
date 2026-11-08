# Francisca Natural 3 — roteiro de implantação e validação

**Versão:** 08/11/2026. Somente Consecom root e tenant interno. Não altera o transporte WhatsApp, Pix, consentimento nem as condições de venda.

## 1 — Política conversacional compacta
- Flag: `FRANCISCA_COMPACT_PROMPT_V3_ENABLED=true`.
- Arquivo: `dashboard/francisca-compact-policy-v3.mjs`.
- `ai-groq.mjs` passa a usar um guia de voz mais curto no lugar de camadas sobrepostas de estilo quando o flag está ativo, mantendo **integralmente** o manual comercial privado, provas, condições de fechamento e a política aprovada da Consecom.
- `trainingPrompt({compact:true})` simplifica apenas o método de linguagem; o treinamento antigo permanece disponível quando o flag é desligado.
- Evita iniciar tudo com “Entendo”, transformar toda resposta em pergunta e repetir “se quiser” artificialmente. Não finge ser humana nem promete ações indisponíveis.

## 2 — Resiliência a limites do Groq
- Arquivo: `dashboard/groq-models.mjs`.
- Um erro HTTP 429 abre cooldown no processo e **não** dispara mais uma tentativa imediata em outros modelos da mesma conta.
- Respeita `Retry-After` entre 20 e 120 segundos. Sem cabeçalho, adota 60 segundos. Antes de liberar novas chamadas, o estado local é checado novamente.
- Até **2 chamadas simultâneas por processo** por padrão (`GROQ_MAX_IN_FLIGHT=2`, ajustável entre 1 e 5); excesso retorna erro temporário `GROQ_BUSY`, que a automação existente trata como resposta **adiada**, não uma mensagem nova.
- Falhas comuns de compatibilidade/transiente podem testar **um** modelo alternativo; erros 429 não fazem failover.
- `groqHealth()` mostra contadores agregados e segundos de cooldown, sem mensagens ou credenciais.
- **Limitação:** o cooldown é por processo, não uma fila distribuída de cota única entre vários serviços. Pode haver limites por minuto, tokens e por conta no provedor, e nenhuma mudança de código garante acesso durante um limite de cota.

## 3 — Recuperação de exemplos com relevância
- Arquivo: `dashboard/francisca-style-examples.mjs`.
- Seleciona exemplos aprovados usando **intenção compatível + termo relevante compartilhado + pontuação de similaridade**.
- Bloqueia analogias inadequadas, como “não entendi” usando um exemplo de opt-out.
- Ampliada a biblioteca com exemplos **fictícios** de português brasileiro em pedidos, objeções, dúvidas, confiança, pagamento e encerramento.
- Nenhuma conversa real é importada automaticamente. Novos exemplos só entram após confirmação de direitos, anonimização e aprovação.

## 4 — Avaliador de 100 situações fictícias
- Código: `dashboard/francisca-quality-evaluator.mjs`.
- Execução: `node scripts/francisca-evaluate-100.mjs` gera `artifacts/francisca-eval-100.json` e `artifacts/francisca-eval-100.md`.
- 100 mensagens únicas, em 10 categorias. O avaliador aceita respostas fornecidas por qualquer modelo; no CI usa **respostas de referência fictícias**, além de exemplos propositalmente robóticos, para verificar os sinais heurísticos.
- A análise considera aberturas automáticas, textos burocráticos, perguntas desnecessárias, cumprimentos repetidos, comprimento excessivo, promessas não confirmadas e pedidos indevidos de dados Pix.
- A tela `Treinamento da IA` mostra a metodologia e, nas respostas do laboratório, uma nota **heurística de estilo**. Ela **não** é confirmação de exatidão comercial, de pagamento nem prova de aumento na conversão.
- Os testes de CI também percorrem 100 rascunhos com um **modelo simulado**, verificando que o prompt central é usado. Nenhum deles envia WhatsApp nem chama a API real do Groq.

## Testes e lançamento controlado
- GitHub Actions: `.github/workflows/francisca-natural-v3.yml` (sintaxe, segurança, rate limits, prompts, 100 situações, regressões).
- Testes incluem preço, Pix, consentimento, transferência humana, isolamento entre clientes, estilo e continuidade.
- **Rollback:** desativar `FRANCISCA_COMPACT_PROMPT_V3_ENABLED` para recuperar imediatamente a composição anterior do prompt, sem apagar dados. Os módulos de recuperação de exemplos e política comercial seguem suas flags independentes.
- A operação de prospecção não deve ser reativada sem consentimento válido; o laboratório é um ambiente sem envios.
- Para testar ganho real: coletar amostras de respostas **do mesmo modelo**, com pacing adequado, comparar versões anteriores/novas e submeter a uma revisão humana antes de alterar volume.
