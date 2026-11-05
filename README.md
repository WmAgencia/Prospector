# Prospector — Consecom

Painel operacional de prospecção com fila determinística, WhatsApp via WA-AKG ou Baileys, atendimento com Groq, biblioteca de mídias e editor de workflows.

## Fluxo automático de produção

O fluxo autorizado pelo operador permite a primeira saudação comercial sem consentimento prévio quando `PROSPECTOR_COLD_FIRST_APPROACH=true`. Isso não marca o contato como consentido. A resposta da pessoa libera a continuidade daquela conversa; recusas, bloqueios, atendimento humano e clientes existentes permanecem protegidos.

- Pesquisa automática a partir das 07h00 e preparação da fila entre 07h00 e 08h00.
- Novas abordagens das **08h00 às 17h30**, horário `America/Sao_Paulo`, com intervalo sorteado de **90 a 110 segundos**, diferente do sorteio anterior por pelo menos **5 segundos**. O sorteio fica salvo no banco e não muda a cada consulta nem após reiniciar. Indisponibilidade ou fim da janela podem adiar a tentativa; não há compensação com disparos em sequência.
- `PROSPECTOR_APPROACH_START_DATE=AAAA-MM-DD` impede novas abordagens antes da data inicial em São Paulo, sem impedir respostas a mensagens recebidas.
- Saudação personalizada; após resposta elegível, apresentação em 30 segundos e continuidade pelo Groq. Respostas automáticas de estabelecimentos não liberam a sequência.
- Respostas do atendimento aguardam de 8 a 35 segundos, com variação e tempo proporcional à leitura e ao tamanho da resposta. O tempo de geração e síntese já conta nessa espera; nova mensagem, bloqueio ou atendimento humano cancela a resposta pendente. `PROSPECTOR_REPLY_PACING_ENABLED=false` desativa a espera adicional.
- O tom comercial usa padrões anonimizados das conversas fornecidas pelo operador, com exemplos fictícios; os arquivos originais não são publicados nem enviados ao Groq. Menus, IA identificada, boas-vindas padronizadas e ausência aguardam uma resposta contextual. Recados que indicam outro telefone ou link de WhatsApp vão para revisão humana, sem cadastrar ou contatar o destino automaticamente.
- Interesse confirmado, pedido de humano e negociações fora da oferta aprovada seguem os controles de encaminhamento ao operador.
- Entrega incerta pausa a abordagem autônoma e nunca é repetida automaticamente. Recontato respeita três meses de calendário.

Para ativar uma instalação: configurar `PROSPECTOR_AUTONOMOUS_OUTREACH_OPT_IN=true`, `PROSPECTOR_COLD_FIRST_APPROACH=true`, `WHATSAPP_TRANSPORT=waakg`, credenciais dos provedores e `PROSPECTOR_INBOUND_AUTOREPLY_ENABLED=true`; verificar sessão conectada e configurações persistidas `autonomous_outreach_enabled=true`, `paused=false`, `discovery_auto_enabled=true`, `discovery_start_hour=7`. A opção de ativação inicial é aplicada uma vez; uma pausa posterior deve ser removida explicitamente pelo operador. `auto_initial=false` mantém o trabalhador legado de campanhas desativado.

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
