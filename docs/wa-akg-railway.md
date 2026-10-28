# WA-AKG no Consecom Prospector — infraestrutura

Data de criação: 28/10/2026. Substitui a **Evolution API**, que **não foi recriada** na conta Railway nova.

## Origem do software
- Repositório oficial: https://github.com/mrifqidaffaaditya/WA-AKG
- Versão identificada no package.json em 28/10/2026: 1.7.0
- Licença: MIT
- Implementação: Next.js 16, Prisma 5, Baileys 7 RC
- **Schema atual usa provider MySQL**, apesar de a documentação genérica mencionar Postgres. Não usar conexão Postgres neste checkout.

## Railway — nova conta paidogame
- Workspace: Wesley Tune's Projects
- Projeto: `prospector-consecom` (ID `e19a1205-b641-47a5-a949-675e968e11ad`).
- Ambiente: `production` (ID `26087698-4648-4d84-afd4-945f91306105`).
- Serviço gateway `wa-akg`: ID `bfa2ae42-0e58-45f4-ab36-044268444c63`, repositório `mrifqidaffaaditya/WA-AKG` na branch `main`, porta 3000, domínio público `https://wa-akg-production-f9f0.up.railway.app`.
- Gateway volume: `wa-akg-data` /app/data (500 MB); media path /app/data/media; tokens de sessão também são persistidos no MySQL.
- Serviço banco `wa-akg-mysql`: ID `0b8c96aa-2d10-4b91-b4c3-d442c07c013c`, imagem `mysql:8.0`; volume `wa-akg-mysql-data` /var/lib/mysql (500 MB).
- Variável gateway `DATABASE_URL` usa referências Railway para `wa-akg-mysql.MYSQL_PASSWORD` e `RAILWAY_PRIVATE_DOMAIN` na rede privada.
- Admin: e-mail `paidogame.ny@gmail.com`; senha em arquivo privado fornecido separadamente ao responsável.
- As credenciais de MySQL e `AUTH_SECRET` **nunca** devem entrar neste repositório.
- Configuradas também BASE_URL, NEXTAUTH_URL, URLs públicas Next, NODE_ENV=production, HOSTNAME=0.0.0.0, TZ=America/Sao_Paulo, locale pt-BR, proteção de taxa 45 RPM e desativação de telemetria e Swagger público.

## Integração a implementar com o Prospector
- O backend `prospector-operacional` já possui seu próprio cliente Baileys. **Não conectar o mesmo número nos dois clientes ao mesmo tempo**.
- A configuração dos novos serviços não migra automaticamente o transporte do Prospector. Desenvolver adaptador de transporte e entrada de webhooks, com autenticação e validação de HMAC.
- WA-AKG: autenticação de API por `X-API-Key`, gerada no painel; webhooks `message.received`, `message.sent`, `connection.update`.
- Exemplos oficiais: `POST /api/messages/{sessionId}/{jid}/send`, `POST /api/webhooks`; verificar formato e idempotência nas versões de código escolhidas.
- Definir sessão e escanear QR no painel antes de testar.
- Antes de mudar a fila de envio: garantir persistência de idempotência, `UNKNOWN` sem retry automático, opt-out, uso de contatos autorizados e testes end-to-end com números de teste.
- Integração Grok: uma etapa separada no backend com política de respostas, contexto, logs e opção de atendimento humano. A chave deve ficar em variáveis privadas do Railway.

## Notas de implantação
- Verificar `SUCCESS` nos deployments antes de declarar qualquer serviço operacional.
- A aplicação WA-AKG faz `npx prisma db push` na inicialização; checar os logs e a conexão com o MySQL.
- APIs não oficiais do WhatsApp baseadas em Baileys não oferecem as garantias da Meta Cloud API e apresentam risco de desconexão/restrições.
- Nunca enviar mensagens automaticamente ao começar; testar fluxo com autorização e confirmar origem da sessão.
