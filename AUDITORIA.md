# Auditoria — WmAgencia/Prospector

Data: 2026-11-04 · Commit auditado: `main` (clone mais recente) · Método: revisão estática de código, sem execução do app, sem varredura de histórico git (shell indisponível neste ambiente).

## Veredito em uma frase

Bem construído no código (validação de entrada, limites de taxa, assinatura HMAC, testes extensos), mas o **modelo de envio em produção contradiz o que o sistema promete**: o modo "convite" dispara a primeira mensagem a leads só descobertos, sem consentimento, e o primeiro boot já sai com a autonomia ligada.

---

## Críticos

**1. Primeiro boot liga a autonomia de envio sem ação do operador.**
[server.mjs:250-258](dashboard/server.mjs:250) — bloqueio de migração única (`autonomous_outreach_nov04_rollout_v1`) que roda em **toda** instalação com banco novo, inclusive self-host: define `autonomous_outreach_enabled=true`, `paused=false`, `discovery_auto_enabled=true` e registra `AUTONOMOUS_OUTREACH_ENABLED` no audit. O comentário "authorization on 2026-11-04" é uma autorização de negócio, não uma configuração por instância.

**2. Modo convite envia a primeira mensagem sem consentimento — e é desligado por padrão vindo de fábrica.**
[permission-invitation.mjs:27-41](dashboard/permission-invitation.mjs:27) + [outreach-queue.mjs:18-20](dashboard/outreach-queue.mjs:18) + [server.mjs:782](dashboard/server.mjs:782). Com a campanha de convite ativa, o filtro de consentimento vira `1=1`: basta lead `DISCOVERED` com telefone e não suprimido. Os telefones vêm de OSM, scraper de Maps, Google Places, Instagram e CNPJ. [prospecting-queue.mjs](dashboard/prospecting-queue.mjs) então matricula lotes a cada 5 s e envia a cada 1 s, sem aprovação por lead.

**3. UI afirma o contrário do que o código faz.**
"Somente contatos autorizados podem receber abordagens" ([campaign-ui.mjs:46](dashboard/public/campaign-ui.mjs:46), [app.js:433](dashboard/public/app.js:433)) é falso no modo convite. Isso é risco jurídico direto: um operador confia no texto e o sistema envia sem autorização.

**4. `contact_permission` é ligado por qualquer resposta.**
[permission-invitation.mjs:21-25](dashboard/permission-invitation.mjs:21) — `acceptPresentation` grava `contact_permission=1` sem checar se o texto é um aceite de verdade. Qualquer resposta (inclusive "?", emoji ou "não") conta como consentimento documentado, e `documentedOptIn` ([outreach-queue.mjs:21](dashboard/outreach-queue.mjs:21)) só confere que existe *algum* audit `CONSENT_UPDATED` com texto não vazio. Não há checagem semântica.

**5. Acesso à produção é por link sem usuário/senha.**
[server.mjs:296-313](dashboard/server.mjs:296) — O único fator é uma URL com `ADMIN_ACCESS_TOKEN`; troca por cookie HMAC de 90 dias. Proteção: limite de 8 tentativas/IP/10 min, mas o IP vem de `x-forwarded-for` sem validação e o mapa fica em memória. O CI verifica, a cada push, que a página pública diz "Não é necessário usuário ou senha" ([production-access-smoke.yml:17](.github/workflows/production-access-smoke.yml:17)). Não há 2FA nem lista de IP; se o link vazar, o acesso dura 90 dias. *(Não é falha de arquitetura — é uma decisão de produto que precisa ser conhecida e assumida.)*

---

## Altos

**6. Auto-resposta por variável de ambiente sem aprovação.**
[groq-sales-automation.mjs:49,65,123](dashboard/groq-sales-automation.mjs:49) — com `AI_CONVERSATION_AUTOSEND` ou `PROSPECTOR_INBOUND_AUTOREPLY_ENABLED=true`, o sistema responde sozinho; `sales_followup_enabled` vem `true` por padrão ([linha 35](dashboard/groq-sales-automation.mjs:35)).

**7. Opt-out sem palavra-chave "PARE".**
[classifier.mjs:4](dashboard/classifier.mjs:4) — o regex não reconhece "PARE" sozinho nem "sair"; a supressão persistente existe ([db.mjs:200](dashboard/db.mjs:200), [waakg-bridge.mjs:95](dashboard/waakg-bridge.mjs:95)), mas quem digita só "PARE" pode continuar recebendo abordagem autônoma de outro fluxo. Exigido na prática pela LGPD (art. 18) e pelo CDC art. 33.

**8. Importação legada propaga consentimento sem evidência.**
[import-legacy.mjs:29-31](dashboard/import-legacy.mjs:29) + [db.mjs:147](dashboard/db.mjs:147) — o objeto do `prospects.jsonl` legado é passado inteiro ao `addLead`, que aceita `contact_permission`. Leads entram já "autorizados".

**9. Sem retenção nem direito de exclusão (LGPD art. 18).**
Telefones, mensagens, transcrições de áudio e métricas de ligação ficam em SQLite indefinidamente, sem API de exclusão do titular nem política de retenção. `GET /api/state` devolve até 1 000 threads com telefone ([server.mjs:350-363](dashboard/server.mjs:350)).

**10. Cliente não oficial do WhatsApp.**
`@whiskeysockets/baileys` ([package.json:18](package.json:18)) e o gateway WA-AKG não são API oficial. Violam os Termos do WhatsApp e tornam o número principal do negócio sujeito a banimento — sem indenização. Recomenda-se migrar para a WhatsApp Cloud API (Meta) com opt-in formal.

---

## Médios — segurança técnica

**11. `npm start` em produção pode subir sem autenticação se `NODE_ENV`/`RAILWAY_ENVIRONMENT` não estiverem definidos.**
[server.mjs:262-280](dashboard/server.mjs:262) — `envIsProd` falso ⇒ `authorized()` retorna `true` para todos. O Dockerfile define `NODE_ENV=production` ([Dockerfile:12](Dockerfile:12)), mas quem rodar `node dashboard/server.mjs` à mão em um VPS exposto a `0.0.0.0` fica aberto. Manter o *fail-open* é uma armadilha; o seguro é falhar fechado ou exigir bind `127.0.0.1`. O README promete "escuta somente localhost", mas com `envIsProd` o servidor faz bind em `0.0.0.0` ([server.mjs:766](dashboard/server.mjs:766)).

**12. Número pessoal do proprietário commitado nos testes.**
`PROSPECTOR_OWNER_PHONE='5515…36'` hard-coded em ~10 arquivos de teste e `'5515…57'` em `conversation-handoff.test.mjs:61`. É PII em repositório público; mover para variável de ambiente de teste.

**13. Documentação de infraestrutura expõe topologia de produção.**
`infra/railway/*.snapshot.json` (linhas 277-280) admite que as capturas "incluem credenciais visíveis e URLs de DB/Redis com senhas" — as imagens não estão no repo, mas hostnames e IDs de serviço estão. Revogar/rotacionar qualquer credencial que tenha aparecido nas capturas e removê-las do repositório.

**14. CI e imagem sem pinned actions / dependências.**
Actions em tags (`actions/checkout@v4` etc.) nos 5 workflows; `pip install edge-tts==7.3.0` sem hash ([Dockerfile:4](Dockerfile:4)); `waakg-voice/Dockerfile` roda `npm install` sem lockfile ([linhas 23-36](waakg-voice/Dockerfile:23)); `ci.yml` e `production-access-smoke.yml` sem bloco `permissions:` (token provavelmente com escrita). `whatsapp-call-media-lab.yml:31` executa código de terceiros (pinado por SHA, mas sem sandbox de rede).

**15. `runtime.mjs:290` cria lead com `contact_permission:true` a partir de qualquer mensagem de entrada nova** — sem evidência de opt-in. Manter como `false` até resposta afirmativa.

**16. `prepare_direct_message` do agente do dono envia até 8 mensagens avulsas por dia a qualquer número brasileiro** ([groq-owner-tools.mjs:215-222](dashboard/groq-owner-tools.mjs:215)). Exige CONFIRMAR, mas contorna fila, janela e supressão se o número estiver suprimido — **verificar** se há checagem de `suppressions` nesse caminho.

**17. Imagem roda como root.** [Dockerfile](Dockerfile) sem `USER`; adicionar usuário não-root.

**18. Testes referenciam `public.example`.**
`tests/mcp-server-smoke.test.mjs:12,17-20` sobe o servidor real com `MCP_PUBLIC_URL=https://public.example/mcp` — nome reservado/brandado de terceiros; renomear para um domínio de teste próprio.

---

## Baixos

- `qrcode-terminal` declarado mas não importado ([package.json:20](package.json:20)).
- `.gitignore` não cobre `*.ogg`/`*.wav` — mídia gravada localmente pode ser commitada por acidente.
- Lista de mídia servida em `/api/media/:id` sem verificação de que o `filename` bate com o `id` ([server.mjs:747-749](dashboard/server.mjs:747)) — não explorável hoje (casamento por id), mas frágil.
- `origin` ausente passa no check de escrita (`sameOriginWrite` retorna `true` sem `Origin`, [server.mjs:330](dashboard/server.mjs:330)); mitigado pelo cookie `SameSite=Strict`, mas não é defesa em profundidade.
- No webhook WA-AKG, o caminho `pedir apresentação` cria a sessão via API do gateway logo após uma mensagem de entrada de número desconhecido; **confirmar** que `waakg-conversations.mjs` não envia mensagem para o remetente antes da aprovação do dono.

---

## O que está bem feito (verificado)

- Autorização em tempo constante (`timingSafeEqual`) no link, na sessão e no webhook ([server.mjs:271](dashboard/server.mjs:271), [waakg-bridge.mjs:49](dashboard/waakg-bridge.mjs:49)).
- Webhook WA-AKG exige HMAC-SHA256 com segredo ≥ 40 caracteres; ignora grupos, `fromMe`, JIDs inválidos e trata idempotência ([waakg-bridge.mjs:45-73](dashboard/waakg-bridge.mjs:45)).
- Upload validado por MIME, magic bytes e duração via `ffprobe`; write com flag `wx` ([server.mjs:365-389](dashboard/server.mjs:365)).
- Quase todas as queries parametrizadas; nenhum `child_process` com shell (argumentos como array) — sem injeção de comando.
- Sessão/cookies `HttpOnly; Secure; SameSite=Strict`; headers de segurança; CSP na página de acesso.
- MCP com OAuth + PKCE S256, escopos separados, redirects `https` obrigatórios, token com hash, aprovação explícita ([mcp-oauth-store.mjs](dashboard/mcp-oauth-store.mjs)).
- Design de entrega conservador: `UNKNOWN` em caso de falha de rede, trava de abordagem inicial por telefone, fila com clock persistente de 90 s.
- Limites de entrada robustos (tamanho de corpo, ângulos de settings validados em [server.mjs:685-703](dashboard/server.mjs:685)).
- Sem segredos no código: tudo via `process.env`; `.env.example` só tem nomes; `package-lock.json` presente.
- 103 arquivos de teste e CI por push.

---

## Recomendações por prioridade

1. **Remover o rollout automático do primeiro boot** ([server.mjs:250-258](dashboard/server.mjs:250)): autonomia deve ser ativada só por ação explícita no painel e registrada por instância.
2. **Corrigir o texto da UI** ou desligar o modo convite até haver base legal documentada (legítimo interesse + opt-out imediato). A primeira abordagem sem consentimento é o ponto de maior risco jurídico (CDC art. 33 / LGPD).
3. **`acceptPresentation` só aceitar resposta afirmativa** (classificar com o classificador existente) e exigir evidência tipada.
4. Adicionar "PARE"/"sair"/"descadastrar" ao classificador e aplicá-lo a **todos** os fluxos.
5. Falhar fechado quando não for dev/loopback; manter bind `127.0.0.1` como padrão.
6. Remover o telefone pessoal dos testes e os snapshots de infraestrutura do repo; rodar `git log -p -S 'gsk_' -S '5515…36'` num ambiente com shell para varrer o histórico.
7. Adicionar `USER` não-root, pinar actions por SHA, `permissions:` mínimo nos workflows, esbuild/pip com hash.
8. Política de retenção (ex.: 90/180 dias) e endpoint de exclusão por titular.
9. Avaliar migração para WhatsApp Cloud API oficial; se manter Baileys, assumir por escrito o risco de banimento.
