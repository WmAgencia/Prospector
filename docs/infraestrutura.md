# Infraestrutura ativa do Prospector — verificada em 29/10/2026

**Código:** [WmAgencia/Prospector](https://github.com/WmAgencia/Prospector), branch `main`.

**Railway correto:** conexão do ChatGPT identificada como **`paidogame`**, pertencente à conta validada diretamente na Railway. Não usar a conexão antiga do ChatGPT intitulada `Prospector`, associada a uma conta Railway excluída. O e-mail da conta não é reproduzido neste repositório público.

**Projeto de produção:** `prospector-consecom`, ID `e19a1205-b641-47a5-a949-675e968e11ad`, ambiente `production` (`26087698-4648-4d84-afd4-945f91306105`).

## Serviços efetivos
- `prospector-operacional`: backend Node.js do repositório, porta 3000, healthcheck `/health`, SQLite e arquivos persistentes em volume de 500 MB montado em `/data`. Domínio: `prospector-operacional-production.up.railway.app`.
- `prospector-ui`: interface/gateway privado de acesso com sessão e proxy para o backend. Domínio: `prospector-ui-production.up.railway.app`. Não é apenas demonstração fictícia.
- `wa-akg`: gateway WhatsApp, repositório `mrifqidaffaaditya/WA-AKG`, volume de 500 MB em `/app/data`.
- `wa-akg-mysql`: banco MySQL do gateway, volume de 500 MB em `/var/lib/mysql`.

Os quatro serviços apresentavam deploy `SUCCESS` na verificação de 29/10/2026. `SUCCESS` não substitui testes funcionais com uma sessão WhatsApp real.

## Proteção de identidade
Os PRs [#45](https://github.com/WmAgencia/Prospector/pull/45) e [#46](https://github.com/WmAgencia/Prospector/pull/46) foram incorporados ao `main`. O código distingue `OWNER` (telefone completo autenticado pela sessão selecionada), `EXISTING_CLIENT` (comprovação do operador ou venda concluída), `PROSPECT_APPROACHED` (primeira abordagem enviada confirmada) e `INBOUND_NEW` (sem abordagem confirmada). Identidades inválidas são `UNVERIFIED` e não recebem ferramentas administrativas. Clientes existentes continuam elegíveis a atendimento, sem nova qualificação comercial fria.

A suíte GitHub Actions de testes e o smoke de acesso privado passaram no commit `1cd6cb33ceddbadf019d8df93f5165cf826af8b2`. As filas de abordagem estavam **pausadas** e não devem ser reativadas apenas pela conclusão do deploy.

## Dados, segurança e pendências
- O banco operacional é **SQLite**, não Supabase/PostgreSQL. `database/postgres-schema.sql` é somente um esquema de referência, ainda não migrado.
- A instalação Railway atual não deve ser confundida com os volumes antigos: os backups históricos dos volumes **não foram restaurados** por este repositório.
- Credenciais, tokens, senhas, conversas e telefones de clientes ficam fora do GitHub e da documentação pública.
- Antes de liberar novas abordagens, validar opt-in/opt-out e classificação real de owner, clientes e prospects; conferir sessão ativa, encaminhamento de notificações, canais texto/áudio e ausência de duplicação.
- Um deploy ou teste sintético bem-sucedido não comprova entrega de mensagens nem autoriza contato em massa.

Para a configuração operacional, consulte [railway-operational.md](railway-operational.md).
