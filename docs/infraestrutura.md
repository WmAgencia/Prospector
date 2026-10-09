# Estrutura do Prospector

**GitHub:** WmAgencia/Prospector — código-fonte.
**Railway:** projeto prospector-consecom — apenas demonstração visual por enquanto.
**Supabase:** usar projeto separado no acesso paidogame.ny@gmail.com; não reaproveitar Tracecom.

## Banco PostgreSQL
O arquivo database/postgres-schema.sql é um esquema PREPARADO, NÃO executado. O motor atual continua usando SQLite.
Somente aplique o SQL após confirmar um projeto Supabase exclusivo para Prospector, com custos autorizados e migração planejada.
O schema prospector é privado, habilita RLS e não concede acesso aos papéis anon/authenticated.
Não exponha URL ou chaves de serviço ao frontend.

## Faltando antes da produção
- Adaptador PostgreSQL transacional com testes de idempotência; migração do histórico SQLite.
- Autenticação do painel antes de publicar APIs.
- Sessão WhatsApp persistente em volume protegido e um único worker.
- Storage privado para mídia.
- Conexão verificada do Supabase, variáveis privadas no Railway, e testes completos.
- Permissão explícita de contatos e validação de opt-out.

Não confundir a prévia fictícia na Railway com o bot funcionando em produção.