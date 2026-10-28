# Consecom Prospector — implantação e auditoria (28/10/2026)

## Estado da integração
- Frontend: Vercel `prospector-consecom-preview` com proxy para interface privada Railway.
- Backend: Railway `prospector-operacional`, arquivos `dashboard/ai-groq.mjs`, `dashboard/waakg-bridge.mjs`, `dashboard/google-places-live.mjs`.
- WhatsApp: WA-AKG v1.7.0, banco MySQL e volume persistente no Railway.
- Groq: rascunhos com `openai/gpt-oss-120b`; token armazenado **somente em variável privada no Railway**. Nenhuma chave em GitHub.
- Automação de envio: **desligada**, obrigando aprovação explícita.

## Pendências externas, sem as quais não existe teste ponta a ponta
1. Na URL `https://wa-akg-production-f9f0.up.railway.app`, iniciar sessão pelo painel e escanear QR Code com aparelho autorizado. Não conectar a mesma linha no Baileys antigo do Prospector.
2. No painel WA-AKG, gerar API key individual e criar webhook da sessão com eventos `message.received`, `message.sent` e `connection.update`. 
3. URL webhook: `https://prospector-operacional-production.up.railway.app/api/wa-akg/webhook`. No campo secret, copiar com segurança o valor de `WA_AKG_WEBHOOK_SECRET` existente nas variáveis do backend Railway; não colocar o valor em GitHub, URL ou logs.
4. No serviço `prospector-operacional`, informar `WA_AKG_API_KEY` e `WA_AKG_SESSION_ID` como variáveis privadas. O transporte permanece inativo até essas duas etapas.
5. Validar com **dois números próprios de teste** o QR, o webhook assinado, duplicatas, opt-out, pedido de humano, geração de rascunho, e um envio explicitamente aprovado. Só depois, quando autorizado, avaliar `WA_AKG_MANUAL_SEND=true`.
6. `GOOGLE_MAPS_API_KEY` (chave Google Places API New) **não fornecida**; habilitar API e cobrança na Google Maps Platform, inserir variável privada e definir `GOOGLE_PLACES_ENABLED=true`. Consultas de Places são efêmeras: não armazenar o catálogo retornado e não inferir opt-in.
7. A DNS pública `prospector.prospector.com.br` ainda é administrada pelo provedor autoritativo associado a `dns.br`; conferir CNAME `prospector` para destino indicado pela Vercel antes de dizer que o domínio funciona.

## Controles implementados
- Webhook público exige `X-Webhook-Signature: sha256=...` calculada sobre bytes brutos do JSON com segredo de 40+ caracteres. Rejeita assinatura inválida (401).
- Eventos duplicados não geram duplicação no histórico. Mensagens `fromMe` e de grupos são ignoradas.
- Solicitação clara de opt-out bloqueia mensagens futuras; pedido de humano desativa envio no canal.
- Contatos inbound não são confundidos com autorização para campanhas de prospecção.
- Respostas Groq são rascunhos privados, exigindo revisão humana.
- Envio manual por endpoint protegido requer confirmação explícita, sessão correta, checagem de não contato e passa a estado `UNKNOWN` em erros de rede; **não repetir automaticamente**.
- `/api/wa-akg/status`, `/api/wa-akg/inbox`, `/api/wa-akg/draft`, `/api/wa-akg/send-approved` são protegidos por sessão privada do Prospector.
- UI preservada; apenas duas seções adicionadas para operações de IA e busca.
- A API Google Places é oficial, usando `places:searchText` e FieldMask; resultados são exibidos ao usuário, não persistidos automaticamente.
- Overpass mudou para provedor comunitário alternativo, sem garantia de SLA, para mitigar HTTP 502.

## Auditoria de dependências
- Build do WA-AKG original registrou **70 vulnerabilidades no npm audit** (4 low, 12 moderate, 51 high, 3 critical); sem relatório por pacote, **não é possível confirmar quais são exploráveis**. Evitar liberar para clientes antes de investigar `npm audit --json` num fork controlado e testar atualizações sem `npm audit fix --force` às cegas.
- **Registro público:** no WA-AKG v1.7.0 auditado, o schema Prisma define `enableRegistration @default(false)` e a rota `/api/auth/register` rejeita novos usuários após o primeiro administrador, salvo quando um SUPERADMIN habilitou explicitamente o cadastro. Não presumir que o registro esteja aberto. Confirmar `enableRegistration=false` no painel e não salvá-lo como `true` por engano (`POST /api/settings/system` usa `enableRegistration ?? true`).
- A implantação referencia a branch main de um repositório de terceiros. Para produção, espelhar/forkar o código, fixar a revisão auditada e revisar o pipeline de atualizações.
- Baileys é integração não oficial; risco de restrições da plataforma. Avaliar WhatsApp Business Platform para operação contínua.

## Rotas / validação
- `GET /api/wa-akg/status` deve indicar `webhookSecretConfigured:true`; chave e sessão inicialmente false.
- `POST /api/wa-akg/webhook` sem HMAC → HTTP 401; evento `test` assinado → HTTP 200 sem registrar lead.
- `GET /api/google-places/status` → HTTP 200; sem chave Google, pesquisa retorna 503.
- `POST /api/wa-akg/draft` com ID inexistente → 404; não aciona envio.
- `POST /api/ai/test` anteriormente retornou HTTP 200 e `openai/gpt-oss-120b`.
- Confirmar na Railway os deploys `SUCCESS` antes de anunciar ativação; os testes de integração **não** substituem ensaio com celular real.

## Privacidade e chaves
- Chave Groq originalmente compartilhada na conversa deve ser substituída pelo proprietário e atualizada somente no Railway.
- Não compartilhar credenciais, números de telefone, payloads de clientes ou histórico em commits.
- O backend SQLite ocupa volume persistente; manter backup automatizado seguro e revisar prazo de retenção da LGPD antes do uso comercial.

## Revisão adicional — mesmo dia
- Backend e painel: forçado `WHATSAPP_TRANSPORT=waakg`, bloqueando conect/disconnect de Baileys e suas rotinas periódicas de envio. O frontend de conexão antiga agora direciona para WA-AKG.
- Monitor de sessão remota: `/api/wa-akg/status` consulta `/api/sessions` apenas quando `WA_AKG_API_KEY` estiver definida; não inventa estado conectado.
- Overpass: fallback secundário para erros temporários 502/503/504, uma tentativa por endpoint e nenhuma repetição de HTTP 429.
- O domínio personalizado permanece configurado na Vercel, mas o DNS autoritativo foi identificado como dns.br e não está resolvido pela integração disponível; a Vercel exige registro CNAME no DNS que realmente é autoritativo.
- A criação de sessão por QR Code requer o aparelho do proprietário; sessão existente no servidor WA-AKG: 0 na última auditoria. Não alegar teste de WhatsApp real sem sessão ativa.
