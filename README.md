# Prospector Consecom

Código inicial do Prospector: WhatsApp com Baileys, filas em JSONL, cadência, scripts de prospecção e cenários de objeção.

**Status: desenvolvimento; não habilitar envios reais sem corrigir e validar os controles de segurança.**

## Arquivos nesta versão

- `bot.mjs`: conexão WhatsApp, fila, mensagens recebidas e áudio.
- `ap-proach.mjs`: preparação de abordagens.
- `add-prospect.mjs`, `dedup-queue.mjs`: importação e deduplicação simples.
- `prospect-finder.mjs`, `busca-em-massa.mjs`: geração de consultas de prospecção (não realizam busca completa no Instagram).
- `send.mjs`: script de teste.
- `start-bot.ps1`: inicializador no Windows.
- `simulacao-objeções.md`: cenários de atendimento.
- `package.json` e `package-lock.json`: dependências.

## Atenção à integridade da cópia

Este repositório reúne apenas os **arquivos que foram anexados à conversa**. Não é uma cópia integral de `D:\Prospector`. A pasta `engine/` (referenciada pelo `bot.mjs`), a pasta `scripts/` e outros arquivos locais não foram enviados e precisarão ser adicionados posteriormente.

## Segurança e privacidade

Os dados de contatos, conversas, sessões, credenciais, QR codes e mídias **não são versionados**. Mantenha `data/`, `wa-session/`, `audio/`, `logs/` e `.env` fora do Git. Este repositório foi criado como público pelo proprietário.

**O modo `LISTEN_ONLY` no código recebido não é estritamente somente leitura**, pois a `outbox` ainda é processada. O launcher também ativa `AUTO_AUDIO=1`. Revise ambos antes de iniciar qualquer automação.

## Instalação

Requer Node.js. Para instalar dependências:

```powershell
npm ci
```

Não execute disparos reais antes de verificar idempotência, opt-out, segurança do áudio e atendimento às regras da plataforma.
