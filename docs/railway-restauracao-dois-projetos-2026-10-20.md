# Inventário de restauração da conta Railway — 20/10/2026

Este arquivo consolida os **dois projetos existentes** na antiga conta Railway, com dados obtidos da integração e das quatro capturas enviadas. É um **backup de configuração**, não dos dados dos discos nem dos valores de credenciais.

## 1. Projeto `prospector-consecom`

**Backup técnico:** [prospector-production.snapshot.json](../infra/railway/prospector-production.snapshot.json)  
**Código da UI privada:** [prospector-ui.ts](../infra/railway/prospector-ui.ts)  
**Procedimento detalhado:** [railway-restauracao-2026-10-20.md](railway-restauracao-2026-10-20.md)

Serviços:
- `prospector-operacional`, GitHub `WmAgencia/Prospector`, branch `main`; inicialização `node dashboard/server.mjs`, porta 3000, health `/health`.
- `prospector-ui`, Railway Function Bun 1.4.0, proxy e controle de acesso com código original salvo no repositório. O `UPSTREAM_URL` da captura aponta para `https://prospector-operacional-production.up.railway.app`; `UPSTREAM_USERNAME` observado: `gateway_admin`.
- Volume `prospector-persistent-data`, 500 MB, montado em `/data` no serviço operacional. **Não exportado**.

A interface tem as variáveis `ACCESS_LINK_TOKEN`, `ACCESS_SESSION_KEY`, `UPSTREAM_ACCESS_TOKEN`, `UPSTREAM_PASSWORD`, `UPSTREAM_URL`, `UPSTREAM_USERNAME`. Valores sensíveis omitidos e sujeitos a rotação.

## 2. Projeto `thorough-youth`: Evolution API, Redis e PostgreSQL

**Snapshot fiel da estrutura e configurações sem credenciais:** [thorough-youth-production.snapshot.json](../infra/railway/thorough-youth-production.snapshot.json)

- **Evolution API**: imagem `evoapicloud/evolution-api:v2.3.7`, porta `8080`, `DATABASE_PROVIDER=postgresql`, `CACHE_REDIS_ENABLED=true`, 1 réplica na região `sfo`.
- **Redis**: imagem `redis:8.2.1`, porta interna `6379`, usuário `default`, rede interna `redis.railway.internal`; volume `redis-volume` de 500 MB em `/data`.
- **Postgres**: imagem `ghcr.io/railwayapp-templates/postgres-ssl:18`, porta interna `5432`, usuário `postgres`, base `railway`, `PGDATA=/var/lib/postgresql/data/pgdata`, `SSL_CERT_DAYS=820`, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=60` conforme captura; volume `postgres-volume` de 500 MB em `/var/lib/postgresql/data`.
- Domínio antigo Evolution API: `https://evolution-api-production-26f6.up.railway.app`; gerar/confirmar novo domínio depois de recriar.
- Redis e Postgres possuem proxies TCP configurados, mas as portas e endereços externos **não são garantidos** após migração.

### Referências recomendadas entre serviços na reinstalação

Em vez de reutilizar strings com senhas embutidas, configurar por variáveis referenciadas pelo Railway, **após criar os três serviços**:
- Na Evolution API: `CACHE_REDIS_URI` → referência à URL interna de Redis; `DATABASE_CONNECTION_URI` → referência à URL interna do Postgres. Confirmar sintaxe suportada no novo Railway e a compatibilidade da Evolution API.
- `AUTHENTICATION_API_KEY`: gerar chave nova; não reutilizar a chave que apareceu visível na captura.
- No Redis: gerar senha nova e manter as variáveis `REDIS_PASSWORD` e `REDISPASSWORD` consistentes, inclusive nas URLs de conexão.
- No Postgres: gerar senha nova e manter `PGPASSWORD` e `POSTGRES_PASSWORD` consistentes com `DATABASE_URL`.
- Priorizar URLs internas de Railway para comunicação entre serviços. Atualizar `SERVER_URL` para o domínio novo da Evolution API.

**Importante:** a captura da interface do Railway e as capturas da Evolution API, Redis e Postgres exibiam senhas, tokens e URLs autenticadas. Esses **valores não foram inseridos no GitHub público**. Recomenda-se **rotacionar todas essas credenciais** antes de colocar qualquer aplicação novamente no ar.

## 3. Dados que NÃO foram copiados

| Recurso | Local | Estado do backup |
|---|---|---|
| Leads, histórico de contatos, mídias e sessão Baileys do Prospector | `prospector-persistent-data` | **Não exportado** |
| Estado Redis da Evolution API | `redis-volume` | **Não exportado** |
| Banco PostgreSQL da Evolution API | `postgres-volume` | **Não exportado** |
| Senhas e tokens Railway | Variáveis dos serviços | **Somente nomes preservados; valores não exportados** |

Os serviços estavam offline por assinatura de teste expirada. Um snapshot de configuração no GitHub **não salva os dados destes três volumes**. Excluir os projetos ou a conta antes de exportá-los pode resultar em perda definitiva. Antes da exclusão, considerar restabelecer o acesso à conta antiga e fazer uma cópia privada verificável de cada volume (incluindo um dump consistente do PostgreSQL); dados privados não devem ser enviados para este repositório público.

## 4. Ordem recomendada para recriar

1. Exportar e verificar os dados dos três volumes antigos **antes de excluir a conta**.
2. Criar a conta nova e conectar o Railway ao ChatGPT.
3. Recriar os projetos separados `prospector-consecom` e `thorough-youth`.
4. Recriar serviços e volumes com imagens, portas, mounts e configurações dos dois snapshots.
5. Restaurar os bancos e sessões de forma segura; só então gerar variáveis e segredos novos e configurar referências.
6. Publicar os serviços e verificar health checks, logs, acesso protegido, conectividade interna Redis/Postgres e endpoints Evolution.
7. Validar as permissões e o histórico de contatos antes de ligar qualquer envio automático.

**Nenhum serviço foi recriado nem dado de produção foi alterado na elaboração deste inventário.**
