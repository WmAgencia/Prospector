# Francisca: biblioteca de conversa natural (v1)

Objetivo: melhorar **o jeito de falar**, sem alterar a identidade transparente de assistente virtual, regras comerciais, consentimento, pagamentos ou permissões.

## Como funciona

Esta implementação foi inspirada no princípio de busca por pares `mensagem recebida → resposta natural` do projeto [MTahaR-dev/whatsapp-auto-reply-bot](https://github.com/MTahaR-dev/whatsapp-auto-reply-bot) e nas recomendações de concisão do [talk-normal](https://github.com/hexiecs/talk-normal). Não instala o Selenium nem o Gemini do projeto e não copia código ou conversas pessoais de terceiros.

- **24 exemplos fictícios aprovados em código**, escritos para português brasileiro de WhatsApp.
- **Armazenamento separado por conta** no banco SQLite do Prospector para exemplos cadastrados pelo operador.
- Recuperação de até **3 pares mais próximos**, usando IDF das palavras e semelhança de trigramas de caracteres, calculada sobre a **mensagem do cliente**, não a resposta.
- Exemplos só são **referência de estilo**, não fonte de preços, promessas, portfólios, garantias ou ações.
- Sem tráfego de dados para banco vetorial externo, sem novo modelo, sem treino/fine-tuning e sem mensagens automáticas adicionais.
- **Nenhuma conversa existente do WhatsApp é copiada, importada, exportada ou usada para aprendizado automaticamente.**
- Para adicionar um exemplo, o operador escolhe `SYNTHETIC` (fictício) ou `CONSENTED_ANONYMIZED` (conversa previamente autorizada e anonimizada), confirma os direitos, e depois **aprova separadamente**.
- Validação de privacidade bloqueia telefones, e-mails, URLs, CPFs formatados, possíveis cartões, chaves Pix, valores e afirmações de pagamento já confirmado. Exemplos podem ser excluídos.
- **Limite inicial a Consecom root e worker interno**: `FRANCISCA_STYLE_EXAMPLES_V1_ENABLED=true`. Outros tenants não recebem os exemplos ou o flag.

## Como testar
Abra o [Prospector](https://prospector-operacional-production.up.railway.app/), entre em **Produção → Treinamento da IA**:

1. No cartão **Testar conversa natural**, converse com a Francisca como um cliente fictício.
2. No cartão **Como a Francisca deve conversar**, visualize quantos exemplos de estilo existem. Abra **Adicionar uma pergunta e resposta natural** e cadastre um par fictício.
3. Depois de cadastrar, abra **Revisar exemplos cadastrados** e clique **Aprovar**. Somente exemplos aprovados passam a orientar as respostas.
4. Compare uma conversa antes e depois, observando se ela para de fazer perguntas a todo turno, repete menos frases feitas e retoma melhor o contexto. Exclua exemplos que não gostar.

Exemplos recomendados para teste: "meu site demora no celular", "eu já tenho um site", "achei caro", "vou falar com meu sócio", "oie", "não entendi kkk".

**Nota importante:** perguntas sobre Pix, preço e Master SEO no laboratório continuam protegidas por respostas aprovadas fixas. Exemplos de estilo não substituem esse verificador e não geram cobranças. Para avaliar a melhoria de naturalidade, prefira perguntas de diagnóstico e objeções que exigem geração conversacional.

## Reversão e segurança
- Defina `FRANCISCA_STYLE_EXAMPLES_V1_ENABLED=false` no Railway. O Groq volta ao prompt anterior sem necessidade de desfazer a implantação.
- O sistema ainda exige consentimento de contato no WhatsApp, preserva as validações e não começa prospecção sozinho.
- O app não salva nem coleta automaticamente conversas reais para a biblioteca.
- O operador deve anonimizar **também nomes e detalhes que permitam identificar uma pessoa**. A confirmação é obrigatória, pois nenhum filtro automatizado detecta toda informação identificável.
- Não use exemplos para disfarçar que a Francisca é uma assistente virtual.

## Arquivos
- `dashboard/francisca-style-examples.mjs`: aprovação, biblioteca e recuperação.
- `dashboard/ai-groq.mjs`: injeta exemplos relevantes no prompt, apenas na conta interna autorizada.
- `dashboard/platform.mjs`: isola a configuração no worker interno.
- `dashboard/server.mjs`: rotas autenticadas de leitura, cadastro e aprovação, sem envio de WhatsApp.
- `dashboard/public/simple-app.js`: gestão dos exemplos na aba Treinamento da IA.
- `tests/francisca-style-examples.test.mjs`: regressões de privacidade, relevância e integração.
