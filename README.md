# Prospector — Consecom

Painel operacional de prospecção com **motor determinístico (sem LLM no runtime)**, WhatsApp via Baileys, biblioteca de mídias e editor de workflows.

## Como iniciar no Windows

1. Instale o **Node.js 22.13+** e execute `npm ci` dentro da pasta do repositório.
2. No PowerShell, execute `.\start-dashboard.ps1` (ou `npm start`).
3. Abra **http://127.0.0.1:3030**.
4. Acesse **Conexões** → **Conectar WhatsApp** → leia o QR pelo WhatsApp do número comercial.
5. Em **Workflows**, configure o fluxo padrão; em **Prospecção**, cadastre ou importe leads autorizados.
6. Inicie um workflow na ficha do lead. Configuração inicial: **pausado**; só habilite envio depois de conferir as regras e a sessão.

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
- **O envio de novas abordagens é pausado por padrão** e requer que o contato esteja marcado como autorizado.
- A interface de descoberta por API usa pesquisa pública e não coleta automaticamente números de telefone de perfis protegidos.
- Se a rede falhar durante o envio, o job fica `UNKNOWN`; nunca é repetido automaticamente.
- O mecanismo de bloqueio de primeira abordagem impede novos disparos, mesmo em caso de reinicialização.
- Classificações ambíguas são transferidas para acompanhamento humano.

### Limitações e dependências externas

- É necessário escanear um QR Code real para usar a conta WhatsApp. O sistema não pode autenticar em seu lugar.
- **FFmpeg** com `ffprobe` disponível no PATH é necessário para upload de vídeo.
- Para pesquisa automática configure no terminal: `$env:BRAVE_SEARCH_API_KEY='sua-chave'` antes de executar `npm start`. A chave não deve ir para o GitHub.
- A Biblioteca de Anúncios do Meta e buscas internas irrestritas do Instagram **não são implementadas**, pois exigem acesso permitido e validação de API.
- O painel não oferece integração de calendário nem reconhecimento de voz; novas respostas de áudio ficam para atendimento humano.
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
