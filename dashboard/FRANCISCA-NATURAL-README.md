# Francisca Natural v1 — conversação natural (Consecom)

Versão: `francisca-natural-2026-11-07-v1`
Escopo inicial: **Consecom root / tenant interno**, com `FRANCISCA_NATURAL_V1_ENABLED=true`.
Sem bibliotecas externas copiadas ou novos serviços obrigatórios.

## Objetivo
Melhorar *como* a Francisca conversa no WhatsApp, preservando *o que* a empresa pode afirmar e fazer.

## Como funciona
1. O Prospector conserva todas as verificações existentes: cliente elegível, consentimento, opt-out, dados aprovados, preços, pagamentos, prevenção de envio duplicado e transferências.
2. Em `aiDraft`, o novo motor lê a última mensagem e o contexto do chat (apenas o espaço autenticado).
3. Seleciona até duas políticas conversacionais **relevantes ao turno** (sem entregar todos os roteiros de uma vez).
4. Identifica registro (formal/cotidiano/neutro) e situação (ocupado, cético, já tem site, objeção, preço, continuação, fechamento etc.).
5. Passa o histórico como **dados não confiáveis** e a última mensagem diretamente ao modelo; ele responde como participante do diálogo, não como redator de um rascunho.
6. O texto volta ao mesmo `refineChatReply` e ao verificador comercial existente, sem poder realizar ação ou envio por si só.
7. Registra somente sinais de qualidade de estilo (abertura repetitiva, linguagem corporativa, listas, extensão), **sem gravar o conteúdo** nessa auditoria.

## Inspirações, não dependências
- [Parlant](https://github.com/emcie-co/parlant): selecionar instruções relevantes ao momento da conversa.
- [talk-normal](https://github.com/hexiecs/talk-normal): remover linguagem corporativa genérica e superfluidade.
- [Cornell ConvoKit](https://github.com/CornellNLP/ConvoKit): acompanhar registro de linguagem e contexto.
- [CoSER](https://github.com/Neph0s/CoSER): manter persona coerente durante diversos turnos.
- [Sotopia](https://github.com/sotopia-lab/sotopia): testar continuidade e comportamento em cenários sociais.
- [Harvey](https://github.com/ethanplusai/harvey): entendimento de objeções sem transformar todo turno em pitch.
- [Mem0](https://github.com/mem0ai/mem0): motivação para memória contextual. A v1 reaproveita o histórico já guardado por tenant, **não instala um banco de memória novo**.

## Testar sem enviar WhatsApp
Entre no painel da Consecom no espaço **Produção**, abra **Treinamento da IA** e use o cartão **Testar conversa natural**.
Digite como se fosse o cliente. A simulação preserva os turnos recentes na interface, durante a sessão do navegador. Nenhuma mensagem é enviada a leads, nenhuma operação comercial é executada. Use pessoas e empresas fictícias.

Sugestão de roteiro de teste:
1. "Já tenho site. O que vocês fariam de diferente?"
2. "Ele abre muito devagar no celular, mas não quero refazer tudo."
3. "Achei esse valor baixo demais, de onde vem essa promoção?"
4. "Vou falar com meu sócio e te digo."

Avalie continuidade, naturalidade, especificidade, ausência de saudações repetidas, correção das condições aprovadas e respeito à hesitação.

## Controles e reversão
- `FRANCISCA_NATURAL_V1_ENABLED=false` recupera o prompt legado **sem novo código**.
- Tenants comerciais externos **não mudam** com esta ativação; necessitam rollout separado, com treinamento por empresa.
- Respostas fixas comerciais e proposta/preço já aprovados permanecem no fluxo anterior para evitar alteração indevida de condições.
- O modo de voz em tempo real e a prosódia do TTS são componentes separados; a v1 melhora o **texto** das respostas comerciais, inclusive antes da síntese de áudios.

## Critérios de evolução
Fazer avaliações cegas em português brasileiro (ex.: 50 conversas sintéticas e 20 revisões opt-in de conversas reais), acompanhando: continuidade, naturalidade, variação, precisão factual, objeções, respeito ao opt-out e resultado comercial. A v1 não promete indistinguibilidade humana e preserva identificação transparente como assistente virtual.
