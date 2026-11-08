# Auditoria real de conversa — Francisca Natural / Style Memory
**Data:** 08/11/2026, **ambiente:** serviço Railway temporário e isolado, sem acesso a WA-AKG, Pix, leads, pagamentos ou dados reais. Código do mesmo commit publicado na produção (`66dcee12618145d1105c6244e8fd4a6edd90ce0f`), adicionado apenas este executor de QA na branch de testes.

## Execução e resultados
- 13 chamadas ao **Groq real**: **3 respostas**, **10 bloqueios `RATE_LIMITED`**. O log registrou tentativas com `HTTP 429` em todos os três modelos de fallback. Portanto a amostra é insuficiente para afirmar melhoria estável.
- Recuperação de exemplos apareceu em **7 chamadas com a biblioteca ativa**; isso confirma seleção local, não prova que cada exemplo seja relevante.
- As 4 respostas comerciais **determinísticas do laboratório** (Master SEO, R$550, orientação Pix e confirmação "por aqui") foram obtidas corretamente, sem chamadas ao modelo e sem executar cobranças.

## Comparação real: site já existente e lento
**Cliente fictício:** "Já tenho um site, mas ele demora muito para abrir no celular."

**Sem exemplos (modelo `openai/gpt-oss-120b`):**
> Entendo. Qual resultado você espera alcançar com a melhoria de velocidade no celular?

**Com exemplos (modelo de fallback `qwen/qwen3.8-27b`):**
> Pode ser excesso de imagens, scripts ou até a hospedagem. Antes de pensar em refazer, vale diagnosticar o que está travando o carregamento. Você quer que eu analise o site para identificar as causas principais?

A segunda resposta é mais contextual, mas sugere uma análise individual que não foi executada e acrescenta uma pergunta. Os modelos **não foram idênticos** entre condições, portanto não atribuir causalidade à biblioteca de exemplos.

## Objeção de preço
**Cliente:** "Achei caro, acho que não compensa pagar isso."

**Sem exemplos (modelo `openai/gpt-oss-20b`):**
> Entendo sua preocupação. O valor de R$ 550 cobre a criação completa do site, domínio por um ano e entrega em até três dias úteis após confirmação do pagamento ou entrada de 50%. Se quiser, me conta qual resultado você espera que o site traga para sua empresa?

**Validador de envio real:** `UNVERIFIED_PRICE`; o texto não seria aprovado para envio automático sem passar pelo fluxo determinístico de preço. **Com exemplos:** a chamada retornou `RATE_LIMITED`, sem comparação válida.

## Problemas demonstrados
1. **Limites de uso Groq:** em uma sequência relativamente pequena, ocorreu indisponibilidade generalizada após três respostas; prioridade é escalonar o uso e lidar com rate limit sem perder o contexto.
2. **Avaliação A/B não controlada:** o mecanismo de failover trocou de modelo; estudos de naturalidade devem comparar o mesmo modelo, com amostras suficientes, parâmetros semelhantes e revisão humana.
3. **Exemplos irrelevantes:** no caso "kkkk não entendi nada, fala mais simples", foi selecionado o exemplo "Não quero mais receber mensagens" com similaridade 0,193. O limite de relevância `0.14` é permissivo.
4. **Promessas sem ferramenta:** a resposta sobre site lento ofereceu analisar o site sem verificação de que há ferramenta ou processo de análise no contexto.
5. **Texto de objeção robótico:** "Entendo sua preocupação" e a pergunta genérica continuam aparecendo.
6. O laboratório usa respostas fixas para algumas situações de pagamento; isso verifica consistência das políticas, não naturalidade generativa.

## Recomendações (não implementadas neste teste)
- Adotar limiar de similaridade mais rigoroso e excluir pares sem relação clara com a intenção.
- Para modelos sob limite de requisição, escalonar a geração e reduzir tentativas simultâneas/failover, mantendo mensagens pendentes para revisão ou tentativa autorizada posterior.
- Acrescentar verificação para ofertas de ação (`vou analisar`, `vou enviar`) sem ferramenta real.
- Executar nova avaliação A/B com **mesmo modelo**, pacing e número de repetições suficientes.
- Preservar guardrails de preço, consentimento, Pix e opt-out.

**Higiene:** o serviço temporário `francisca-groq-qa-temp-20261108` foi removido após a leitura dos logs; o serviço principal continuou com deployment `SUCCESS`. Nenhuma alteração foi feita ao serviço principal durante esta auditoria.

**Reprodução:** `qa/francisca-live-style-check.mjs` nesta branch. É executável somente em ambiente privado com Groq autorizado; não copie chaves para o repositório.
