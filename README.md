# Prospector — Consecom

## Interface e apresentação comercial

O refinamento de tela cheia remove a moldura externa do site e dos painéis, aumenta o contraste com verde-floresta/lima, incorpora SVGs locais e inclui uma demonstração interativa da prospecção. A pesquisa de referências, os tokens, as razões de contraste e os critérios de movimento estão em [docs/design-system-prospector.md](docs/design-system-prospector.md).

A landing e os painéis usam o mesmo tema claro com cartões brancos, menu compacto e destaques verde-lima, inspirado na referência fornecida pelo operador. O arquivo `dashboard/public/product-theme.css` é compartilhado pelos espaços de cliente, master, cadastro e acesso administrativo. A navegação superior mantém os nomes das seções; o menu móvel continua exibindo os rótulos completos.

A apresentação explica a pesquisa automática a partir das 05h, as primeiras abordagens das 08h às 17h30, a continuidade da conversa pela IA e o aviso de interesse no WhatsApp pessoal. A operação depende de configuração, perfil aprovado, números conectados, saldo e contatos elegíveis. O campo **WhatsApp pessoal para avisos de interessados** fica em **Treinamento da IA → Sobre sua empresa**. Esse destino não concede privilégios administrativos e é omitido do contexto enviado ao modelo.

O teto da fila é **250 novos contatos abordados por dia e por operação**, compartilhado entre os números, no dia de São Paulo. Entregas incertas e em andamento também contam, para não abrir espaço indevido para novos disparos. O limite é conferido novamente dentro da reserva transacional. Respostas a conversas existentes e avisos ao gestor são independentes desse teto. O plano interno ilimitado não remove esse controle operacional. Não é um limite oficial de segurança do WhatsApp nem uma garantia contra bloqueios.

A calculadora foi substituída por uma seção explicativa: 250 abordagens × 1% = 2,5 contratos em média matemática, apresentada como cerca de 2 a 3 por lote. Não há promessa de mínimo ou fechamento diário. O horário de descoberta é ajustado para 05h por migração, preservando pausa, autorização e ativação da operação.

## Painel master, clientes e treinamento

O acesso administrativo é exclusivamente master: dashboard, clientes, acessos e créditos. A operação atual da Consecom pertence à única conta interna ilimitada, que reutiliza o banco operacional existente, sem cópia, limpeza ou mudança dos fluxos em andamento. O master abre essa conta pelo botão **Abrir minha operação**; suas APIs operacionais ficam bloqueadas enquanto não estiver no espaço de um cliente. A conta interna também tem login próprio por e-mail ou telefone. As sessões de cliente não concedem permissões de master.

A seção **Clientes** permite cadastrar gestores, abrir o painel de cada conta, suspender acessos, renovar links privados e liberar recargas. Abrir uma conta muda o espaço do navegador; use **Voltar ao painel master** para retornar quando o navegador também possuir uma sessão administrativa válida. Apenas uma conta pode ser ilimitada, com restrição no banco. Cadastro público não aceita promover contas para esse plano. A conta interna não precisa de recargas; a pausa comercial é feita dentro de sua operação.

### Landing page e cadastro público

Visitantes sem sessão veem a landing page na raiz. `/conheca` sempre abre a apresentação; `/cadastro` abre o formulário e `/entrar` o login de cliente. O master continua em `/access`. O cadastro cria uma conta comum, com saldo zero, e abre o treinamento. O login aceita e-mail ou celular brasileiro com DDD (com ou sem `55`), e abre a visão geral. Senhas são armazenadas com scrypt e salt individual. O cadastro exige confirmação de leitura sobre o processamento dos dados; não gera cobrança nem créditos gratuitos. A recuperação de acesso é assistida pela Consecom nesta versão.

O formulário e a autenticação têm limitadores; tentativas por conta também são limitadas. O proxy identifica a origem para o backend com cabeçalho assinado e prazo curto; cabeçalhos sem assinatura não concedem uma nova identidade de limitação. Não grave senhas de clientes, inclusive da conta interna, em código, arquivos de implantação ou logs. A conta interna é configurada pelo endpoint privado do master `/api/platform/primary-client`, e as credenciais ficam somente como hash no volume persistente.

A calculadora da landing trabalha com lotes, não com garantia diária: 250 × 1% = 2,5 clientes em média matemática. Textos e FAQ explicam que não existe mínimo de conversão nem garantia contra bloqueio. O rodapé aponta para `https://consecom.com.br`. As imagens do produto são composições HTML com dados fictícios explicitamente identificados.

Cada cliente comum executa em processo separado, ligado apenas ao loopback, com banco SQLite, arquivos, sessões WhatsApp, configurações, filas e treinamento próprios em `PROSPECTOR_DATA_DIR/platform/clients/<uuid>`. O cadastro e o extrato ficam em `platform/platform.sqlite`. O servidor público autentica a conta pelo cookie assinado e escolhe o processo; IDs enviados pelo navegador não escolhem bancos. As rotas legadas administrativas não estão disponíveis no espaço do cliente. Os webhooks usam segredo próprio por conta e validam a assinatura do corpo original. Credenciais da operação Consecom, números pessoais, restaurações privadas, testes e campanhas não são herdados.

Os processos previamente usados são restaurados após reinício. Essa primeira arquitetura usa o mesmo servidor físico; sua capacidade depende de memória e CPU. Não equivale a uma implantação distribuída ou a uma quantidade ilimitada de clientes. Inclua a pasta `platform` nos backups do volume persistente. O SQLite operacional existente permanece no mesmo caminho.

**Créditos:** o pacote comercial exibido é 250 abordagens por R$ 9,90, sem mensalidade obrigatória. A liberação é manual pelo master depois da confirmação do pagamento; não há checkout nem cobrança automática. Uma abordagem aceita pelo canal consome um crédito. Pesquisa e respostas posteriores não geram nova cobrança de abordagem nesta versão. O crédito é reservado antes do transporte, consumido uma única vez após confirmação e liberado se a entrega não for confirmada. Envios incertos nunca são repetidos automaticamente. Uma interrupção entre reserva e confirmação mantém o valor em conferência; o master pode suspender a conta, conferir as entregas e liberar reservas não enviadas. Esse mecanismo não comprova leitura ou entrega no celular. Quantidade comprada não é promessa de volume diário, segurança da conta ou taxa de fechamento.

**Treinamento:** a tela reúne cadastro da empresa, análise de conversas e chat manual. O gestor pode escolher conversas ou todas as disponíveis em seus canais. A análise lê apenas texto enviado pela empresa, exclui grupos e mídias e remove padrões de números, e-mails e links. Uma amostra distribuída de até 160 textos é usada para sugerir padrões; o acesso ao histórico depende do que o gateway sincronizou. A integração não consegue recuperar conversas ausentes do gateway. Selecionar todas pode incluir conversas pessoais: o gestor deve revisar a seleção e o relatório. Conteúdo importado é dado não confiável, nunca comando para executar ferramentas ou mudar permissões.

O relatório mostra padrões, sugestões e incertezas. O gestor pode editar e aprovar a versão, que passa a compor o contexto das respostas. O chat manual produz sugestões também sujeitas à aprovação. O perfil ativo permanece em uso até outra versão ser aprovada. Clientes novos começam pausados e sem resposta automática antes do primeiro perfil aprovado. Trata-se de personalização por contexto e exemplos, sem ajuste dos pesos do modelo. Solicitações de não contato, limites do canal, deduplicação, atendimento humano e revisão de condições comerciais continuam prioritários.

Painel operacional de prospecção com fila determinística, WhatsApp via WA-AKG ou Baileys, atendimento com Groq, biblioteca de mídias e editor de workflows.

## Fluxo automático de produção

### Vários WhatsApps simultâneos

Em **Conexões → Adicionar WhatsApp**, dê um nome para a conexão e escaneie o QR Code com o número correspondente. Cada conexão tem seu próprio status, QR e botão de desconexão; o Prospector não impõe uma quantidade fixa de números. A quantidade efetiva depende da capacidade e das permissões do gateway.

As primeiras abordagens alternam em ordem circular entre as sessões conectadas: 1 → 2 → 3 → 1. Há **um único relógio global de 90–180 segundos** e diferença mínima de 5 segundos entre sorteios, mesmo mudando de número. Sessões offline são puladas; se todas estiverem offline, o giro e o relógio não avançam. A posição do giro e a origem da conversa ficam persistidas no banco.

Não há mais pausa por bloco de 20 abordagens nem descanso de 15 minutos. A espera global é sorteada entre 90 e 180 segundos e começa quando a tentativa anterior termina, mesmo quando a próxima abordagem usa outro número. Contadores e prazos antigos de descanso ficam preservados apenas como histórico e não bloqueiam o giro.

Cada cliente continua no número que iniciou sua abordagem: apresentação, respostas do Groq, áudio e propostas aprovadas usam essa origem, sem trocar de número durante o atendimento. A lista de leads e os bloqueios são globais, impedindo abordar a mesma pessoa repetidamente por números diferentes. Webhooks de sessões não cadastradas são ignorados; comandos administrativos permanecem exclusivos da sessão principal. Desconectar um número pela sua ficha não desconecta os demais nem libera envios para contatos bloqueados.

O fluxo autorizado pelo operador permite a primeira saudação comercial sem consentimento prévio quando `PROSPECTOR_COLD_FIRST_APPROACH=true`. Isso não marca o contato como consentido. A resposta da pessoa libera a continuidade daquela conversa; recusas, bloqueios, atendimento humano e clientes existentes permanecem protegidos.

- Pesquisa automática a partir das **05h00** (America/Sao_Paulo) para descoberta e pesquisa de empresas; preparação da fila entre **07h00 e 08h00**; **novas abordagens somente das 08h00 às 17h30**. A descoberta respeita as cotas das fontes e pode prosseguir após 08h00.
- Novas abordagens das **08h00 às 17h30**, horário `America/Sao_Paulo`, com intervalo sorteado de **90 a 180 segundos**, diferente do sorteio anterior por pelo menos **5 segundos**. O sorteio fica salvo no banco e não muda a cada consulta nem após reiniciar. Indisponibilidade ou fim da janela podem adiar a tentativa; não há compensação com disparos em sequência.
- `PROSPECTOR_APPROACH_START_DATE=AAAA-MM-DD` impede novas abordagens antes da data inicial em São Paulo, sem impedir respostas a mensagens recebidas.
- Saudação personalizada; após resposta elegível, apresentação em 30 segundos e continuidade pelo Groq. Respostas automáticas de estabelecimentos não liberam a sequência.
- Respostas do atendimento aguardam de 8 a 35 segundos, com variação e tempo proporcional à leitura e ao tamanho da resposta. O tempo de geração e síntese já conta nessa espera; nova mensagem, bloqueio ou atendimento humano cancela a resposta pendente. `PROSPECTOR_REPLY_PACING_ENABLED=false` desativa a espera adicional.
- Nas respostas de texto a clientes, os 3–5 segundos finais da preparação usam o indicador nativo “Digitando...”. Ele é encerrado após envio ou cancelamento e não é ativado em mensagens de entrada automáticas, transferências silenciosas ou conversas ociosas. Se a geração já consumiu a espera prevista, ainda se mantém essa janela visual mínima; falha do indicador não repete nem impede o envio do texto.
- O tom comercial usa padrões anonimizados das conversas fornecidas pelo operador, com exemplos fictícios; os arquivos originais não são publicados nem enviados ao Groq. Menus, IA identificada, boas-vindas padronizadas e ausência aguardam uma resposta contextual. Recados que indicam outro telefone ou link de WhatsApp vão para revisão humana, sem cadastrar ou contatar o destino automaticamente.
- Interesse confirmado, pedido de humano e negociações fora da oferta aprovada seguem os controles de encaminhamento ao operador.
- Entrega incerta pausa a abordagem autônoma e nunca é repetida automaticamente. Recontato respeita três meses de calendário.

Para ativar uma instalação: configurar `PROSPECTOR_AUTONOMOUS_OUTREACH_OPT_IN=true`, `PROSPECTOR_COLD_FIRST_APPROACH=true`, `WHATSAPP_TRANSPORT=waakg`, credenciais dos provedores e `PROSPECTOR_INBOUND_AUTOREPLY_ENABLED=true`; verificar sessão conectada e configurações persistidas `autonomous_outreach_enabled=true`, `paused=false`, `discovery_auto_enabled=true`, `discovery_start_hour=5`. A opção de ativação inicial é aplicada uma vez; uma pausa posterior deve ser removida explicitamente pelo operador. `auto_initial=false` mantém o trabalhador legado de campanhas desativado.

Sem `PROSPECTOR_COLD_FIRST_APPROACH=true`, a fila de produção continua exigindo autorização documentada. Diagnóstico: `/api/prospecting/queue`, `/api/sales/status` e `/api/queue-health`, com autenticação do painel.

## Como iniciar no Windows

1. Instale o **Node.js 22.13+** e execute `npm ci` dentro da pasta do repositório.
2. No PowerShell, execute `.\start-dashboard.ps1` (ou `npm start`).
3. Abra **http://127.0.0.1:3030**.
4. Acesse **Conexões** → **Conectar WhatsApp** → leia o QR pelo WhatsApp do número comercial.
5. Em **Workflows**, configure o fluxo padrão; em **Prospecção**, cadastre ou importe leads autorizados.
6. Inicie um workflow na ficha do lead. Configuração inicial: **pausado**; só habilite envio depois de conferir as regras e a sessão.

### Aproveitar dados anteriores de D:\Prospector

Se já houver o bot antigo com leads, faça a migração local para a nova pasta **sem enviar contatos ao GitHub**:

```powershell
npm run import:legacy -- "D:\Prospector\data"
```

A importação inclui histórico de abordagens e bloqueios, para evitar abordar novamente quem já recebeu mensagens.

O servidor escuta **somente localhost**, não é uma aplicação exposta à internet. O GitHub hospeda o **código**, não o bot em execução. Deixe o PC ligado ou configure um servidor persistente apropriado.

### Funcionalidades implementadas no código

- Sidebar: Visão geral, Conversas, Prospecção (Kanban), Workflows, Descoberta, Conexões e Configurações.
- Baileys no mesmo processo do painel, QR Code e histórico de conversas recebidas enquanto conectado.
- Banco local SQLite (em `data/prospector.sqlite`, excluído do Git).
- Upload de vídeos MP4 de até 60 segundos com validação server-side pelo **FFmpeg/ffprobe**; áudios e imagens.
- Editor de blocos: mensagem com variáveis, esperar resposta, esperar tempo, vídeo, áudio, imagem e fim.
- Versões de workflows congeladas quando o lead inicia; etapas e delays persistidos.
- Fila com trava de abordagem inicial por lead e telefone, sem reenviar trabalhos cujo resultado de entrega é incerto.
- Classificador conservador para opt-out, desinteresse, intenção comercial, perguntas e dúvidas.
- Takeover humano e revisão de respostas incertas.
- Pesquisa pública por Instagram via **Brave Search API**, somente se houver `BRAVE_SEARCH_API_KEY`. A descoberta não prova que a empresa não tenha site: novos resultados começam como `UNCERTAIN`.

### Segurança operacional

- **Nunca execute simultaneamente** `bot.mjs` e `dashboard/server.mjs` usando a mesma sessão WhatsApp.
- O script `start-bot.ps1` agora direciona para o painel. O bot legado permanece para análise, mas não é o entrypoint recomendado.
- Os arquivos `data/`, `audio/`, `logs/`, `wa-session/`, `.env*`, tokens e contatos não são versionados.
- **Instalações novas começam pausadas**, salvo ativação explícita do fluxo automático descrito acima. A primeira abordagem nesse modo não depende da marcação de consentimento do contato.
- A interface de descoberta por API usa pesquisa pública e não coleta automaticamente números de telefone de perfis protegidos.
- Se a rede falhar durante o envio, o job fica `UNKNOWN`; nunca é repetido automaticamente.
- O mecanismo de bloqueio de primeira abordagem impede novos disparos, mesmo em caso de reinicialização.
- Classificações ambíguas são transferidas para acompanhamento humano.

### Limitações e dependências externas

- É necessário escanear um QR Code real para usar a conta WhatsApp. O sistema não pode autenticar em seu lugar.
- **FFmpeg** com `ffprobe` disponível no PATH é necessário para upload de vídeo.
- Para pesquisa automática configure no terminal: `$env:BRAVE_SEARCH_API_KEY='sua-chave'` antes de executar `npm start`. A chave não deve ir para o GitHub.
- A Biblioteca de Anúncios do Meta e buscas internas irrestritas do Instagram **não são implementadas**, pois exigem acesso permitido e validação de API.
- Transcrição e respostas em áudio dependem das configurações e dos provedores de voz habilitados.
- A pasta `engine/` legada e os dados locais não foram anexados à conversa e não estão aqui; o painel usa seu próprio classificador.
- **Não há garantia de entrega ou de segurança de contas** com bibliotecas não oficiais do WhatsApp.

### Desenvolvimento e testes

```powershell
npm ci
npm test
npm start
```

Acesse `http://127.0.0.1:3030/api/state` para confirmar que a API respondeu JSON. Testes de integração com WhatsApp devem ser feitos no seu computador, com conta autorizada e sem disparos de prospecção reais durante a validação.

## Estrutura

- `dashboard/db.mjs` — SQLite + histórico/deduplicação.
- `dashboard/classifier.mjs` — classificação determinística.
- `dashboard/runtime.mjs` — Baileys + workflow engine.
- `dashboard/server.mjs` — servidor HTTP, API e pesquisa pública.
- `dashboard/public/` — SPA responsiva, sem frontend build.
- `tests/` — testes automatizados de classificação.

## Prévia visual sem WhatsApp

Execute `npm run preview:ui` e abra **http://127.0.0.1:4173**. Esta página usa dados fictícios no navegador e não realiza envio, pesquisa nem autenticação real. É ideal para avaliar o visual com segurança.

Para visualizar na internet, é necessário autorizar a integração GitHub na Vercel para o workspace `consecom` e habilitar permissão de implantação, ou ativar **Settings → Pages → GitHub Actions** neste repositório e executar `Publish visual preview`.
