# Francisca — Motor Comercial 2.0

**Escopo de lançamento:** Consecom (servidor raiz e trabalhador interno), quando `FRANCISCA_COMMERCIAL_BRAIN_V2_ENABLED=true`. Outros tenants continuam com as regras atuais. Sem alteração automática de campanhas ou pagamentos.

## O que entrou

1. **Intenção e estágio:** identifica recusa, pedido de humano, interesse em fechamento, preço, dúvida, objeção, prova social e análise de proposta. Uma hipótese não é uma permissão ou prova de venda.
2. **Memória comercial persistente:** além de proposta já explicada e tópicos respondidos, registra somente rótulos como `need=mobile_performance`, `concern=trust` ou `lastCommercialStage=EVALUATION` no banco isolado do tenant. Não grava frases privadas no resumo.
3. **Diagnóstico consultivo:** escolhe uma ação recomendada conforme a mensagem. Clientes ocupados, indecisos ou que querem um humano não são pressionados com outra pergunta.
4. **Objeções (inspirado no Harvey/LAARC):** ouvir preocupação real, reconhecer sem elogios automáticos, investigar apenas o que faltar, responder com dados aprovados e confirmar só quando fizer sentido.
5. **Portfólio contextual:** permite à Francisca selecionar no máximo UM exemplo já aprovado, HTTPS e relacionado ao nicho, apenas quando o prospect pede prova. Não inventar portfólio ou resultado.
6. **Fechamento seguro:** preserva o módulo `sales-payment-flow.mjs`. Uma intenção de fechar não é comprovante. Uma solicitação de Pix passa pelas verificações determinísticas existentes; `CLOSED_WON` exige confirmação de verdade.
7. **Transferência rica:** o aviso para o responsável recebe resumo categorizado (necessidade, preocupação, oferta explicada, ação sugerida), sem copiar toda a conversa.
8. **Medição e melhoria:** a visão geral passa a mostrar funil de contatos únicos com status inicial `SENT`, respostas não automáticas, qualificados, intenções de pagamento e vendas registradas. Recomendações simples e revisáveis de melhoria são sugeridas, não aplicadas automaticamente.

## Como testar

No painel **Produção → Treinamento da IA → Testar conversa natural**, faça uma conversa fictícia de 4 a 6 turnos, como:
- "Já tenho um site, mas demora muito no celular."
- "Não quero criar outro site."
- "Achei esse preço muito baixo, será que é seguro?"
- "Tem algum exemplo de oficina que vocês já fizeram?"
- "Vou conversar com meu sócio."
- "Se fecharmos, como funciona o pagamento?"

Observe se a Francisca faz perguntas somente quando realmente necessárias, lembra o problema do site e respeita decisões. O laboratório **não envia mensagens nem executa cobranças**. Compare a naturalidade com a versão anterior e corrija treinamento só após revisão.

## Controles indispensáveis

- WhatsApp: `outreach-consent-control.mjs` continua exigindo opt-in para contato iniciado pela empresa; nenhum novo fluxo de disparo foi implementado.
- Segurança: permissão de contato, supressão, handoff, preços, propostas, cobrança, não duplicação e envio continuam sob regras e dados autenticados do servidor.
- Privacidade: nenhuma memória compartilhada entre empresas e nenhum treinamento automático com mensagens brutas.
- Vendas: não inventar prova social, condições comerciais, descontos, urgência ou confirmação bancária.
- Responsabilidade: a Francisca é uma assistente virtual; não deve fingir ser uma pessoa.

## Métricas e limitações

`GET /api/sales/funnel` é uma leitura autorizada do banco por tenant, com contagem **histórica de leads únicos**. O painel mostra denominadores específicos, mas dados de campanhas legadas, áudio não transcrito e lançamentos de venda fora do registro podem causar divergências.

**Proposta de pagamento criada != proposta aceita != pagamento confirmado.** O funil não alega ter medido faturamento bancário. Os percentuais não são uma previsão de vendas, e não demonstram a eficácia de uma alteração sem teste controlado.

## Reversão

Na Railway, configure `FRANCISCA_COMMERCIAL_BRAIN_V2_ENABLED=false` para retornar ao aconselhamento comercial anterior sem apagar as memórias categorizadas ou mudar as condições de venda. A camada natural v1 tem sua própria flag, `FRANCISCA_NATURAL_V1_ENABLED`.

## Arquitetura

`francisca-commercial-brain.mjs` (puro: plano, objeção, prova, handoff) → `ai-groq.mjs` (instrução contextual somente para prospect autorizado) → `groq-sales-automation.mjs` (controle original de WhatsApp, preço, interesse e revisão) → `sales-conversion-funnel.mjs` (analytics somente leitura) → painel.

Testes automatizados de 100 conversas fictícias, política de consentimento, termos comerciais e regressão devem passar antes de cada implantação.
